import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import {
  buildDeviceEnrollmentProof,
  buildDeviceEnrollmentStatusProof,
  buildDeviceHeartbeatProof
} from "../src/devices/device-registry.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function sign(privateKey: crypto.KeyObject, message: Buffer): string {
  return crypto.sign(null, message, privateKey).toString("base64url");
}

function publicKeySpki(publicKey: crypto.KeyObject): string {
  return (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64url");
}

function sessionCookie(headers: Record<string, string | string[] | undefined>): string {
  const value = headers["set-cookie"];
  const selected = Array.isArray(value) ? value[0] : value;
  assert.ok(selected, "Owner login must set a session cookie");
  return selected.split(";", 1)[0]!;
}

interface EnrollmentIdentity {
  publicKey: string;
  privateKey: crypto.KeyObject;
  displayName: string;
  platform: string;
  architecture: string;
  requestNonce: string;
}

function enrollmentIdentity(displayName: string): EnrollmentIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKeySpki(publicKey),
    privateKey,
    displayName,
    platform: "darwin",
    architecture: "arm64",
    requestNonce: crypto.randomBytes(18).toString("base64url")
  };
}

function enrollmentPayload(identity: EnrollmentIdentity) {
  return {
    displayName: identity.displayName,
    platform: identity.platform,
    architecture: identity.architecture,
    publicKey: identity.publicKey,
    requestNonce: identity.requestNonce,
    signature: sign(
      identity.privateKey,
      buildDeviceEnrollmentProof({
        publicKey: identity.publicKey,
        displayName: identity.displayName,
        platform: identity.platform,
        architecture: identity.architecture,
        requestNonce: identity.requestNonce
      })
    )
  };
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-registry-v1-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(root, "README.md"), "# Device registry v1 fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"),
    path.join(root, "openapi/chatcockpit.openapi.yaml")
  );
  const configPath = path.join(paths.runtimeDir, "fixture-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceAllowlist: [root],
      repoMappings: { primary: { path: root } }
    }),
    "utf8"
  );

  updateAccessPolicy(paths, { consolePathPrefix: "/ops-device-registry-v1" });
  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-device-registry-v1"
  });
  const loginGate = operatorService.createSecureLoginGate().gateSecret;
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    apiToken: process.env.CHATCOCKPIT_API_TOKEN,
    host: process.env.CHATCOCKPIT_HOST,
    port: process.env.CHATCOCKPIT_PORT,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-device-registry-v1";
  process.env.CHATCOCKPIT_HOST = "0.0.0.0";
  process.env.CHATCOCKPIT_PORT = "5123";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  let currentNow = "2026-08-21T08:30:00.000Z";
  const app = buildServer(paths, { deviceNow: () => currentNow });

  try {
    const anonymousList = await app.inject({ method: "GET", url: "/api/devices" });
    assert.equal(anonymousList.statusCode, 401, anonymousList.body);

    const machineList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { authorization: "Bearer test-token-device-registry-v1" }
    });
    assert.equal(machineList.statusCode, 401, machineList.body);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      headers: { "x-chatcockpit-login-gate": loginGate },
      payload: { username: "owner", password: "test-password-device-registry-v1" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const owner = login.json() as { csrfToken: string };
    const cookie = sessionCookie(login.headers);

    const initialList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    assert.equal(initialList.statusCode, 200, initialList.body);
    const initialDevices = (initialList.json() as { devices: Array<Record<string, unknown>> }).devices;
    assert.equal(initialDevices.length, 1);
    assert.equal(initialDevices[0]?.id, "local-device");
    assert.equal(initialDevices[0]?.presence, "online");
    assert.equal(initialDevices[0]?.locality, "local");

    const anonymousPending = await app.inject({
      method: "GET",
      url: "/api/devices/enrollment-requests"
    });
    assert.equal(anonymousPending.statusCode, 401, anonymousPending.body);

    const identity = enrollmentIdentity("MacBook Pro");
    const payload = enrollmentPayload(identity);
    const invalidSignature = await app.inject({
      method: "POST",
      url: "/api/devices/enrollment-requests",
      payload: { ...payload, signature: payload.signature.slice(0, -2) + "xx" }
    });
    assert.equal(invalidSignature.statusCode, 401, invalidSignature.body);

    const enrollment = await app.inject({
      method: "POST",
      url: "/api/devices/enrollment-requests",
      payload
    });
    assert.equal(enrollment.statusCode, 201, enrollment.body);
    const enrollmentBody = enrollment.json() as {
      enrollment: {
        id: string;
        verificationCode: string;
        displayName: string;
        expiresAt: string;
        pollAfterSeconds: number;
      };
    };
    assert.match(enrollmentBody.enrollment.id, /^cc_enroll_[A-Za-z0-9_-]{20,80}$/);
    assert.match(enrollmentBody.enrollment.verificationCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(enrollmentBody.enrollment.displayName, "MacBook Pro");
    assert.equal(enrollmentBody.enrollment.pollAfterSeconds >= 2, true);
    assert.equal(enrollment.body.includes(identity.publicKey), false);
    assert.equal(enrollment.body.includes(payload.signature), false);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/devices/enrollment-requests",
      payload
    });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal(
      (duplicate.json() as { enrollment: { id: string } }).enrollment.id,
      enrollmentBody.enrollment.id
    );

    const pendingStatusSignature = sign(
      identity.privateKey,
      buildDeviceEnrollmentStatusProof(enrollmentBody.enrollment.id)
    );
    const badStatus = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollmentBody.enrollment.id}/status`,
      payload: { signature: enrollmentBody.enrollment.verificationCode }
    });
    assert.equal(badStatus.statusCode, 401, badStatus.body);

    const pendingStatus = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollmentBody.enrollment.id}/status`,
      payload: { signature: pendingStatusSignature }
    });
    assert.equal(pendingStatus.statusCode, 200, pendingStatus.body);
    assert.equal((pendingStatus.json() as { enrollment: { status: string } }).enrollment.status, "pending");

    const pendingList = await app.inject({
      method: "GET",
      url: "/api/devices/enrollment-requests",
      headers: { cookie }
    });
    assert.equal(pendingList.statusCode, 200, pendingList.body);
    const pendingProjection = (pendingList.json() as {
      enrollmentRequests: Array<{
        id: string;
        publicKeyFingerprint: string;
        verificationCode: string;
      }>;
    }).enrollmentRequests;
    assert.equal(pendingProjection.length, 1);
    assert.equal(pendingProjection[0]?.id, enrollmentBody.enrollment.id);
    assert.equal(pendingList.body.includes(identity.publicKey), false);
    assert.equal(pendingList.body.includes(payload.signature), false);

    const approveWithoutCsrf = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollmentBody.enrollment.id}/decision`,
      headers: { cookie },
      payload: { decision: "approve" }
    });
    assert.equal(approveWithoutCsrf.statusCode, 403, approveWithoutCsrf.body);

    const approved = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollmentBody.enrollment.id}/decision`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
      payload: { decision: "approve" }
    });
    assert.equal(approved.statusCode, 200, approved.body);
    const approvedDevice = (approved.json() as {
      device: { id: string; publicKeyFingerprint: string; displayName: string };
    }).device;
    assert.match(approvedDevice.id, /^cc_device_[A-Za-z0-9_-]{20,80}$/);
    assert.equal(approvedDevice.displayName, "MacBook Pro");
    assert.ok(approvedDevice.publicKeyFingerprint.length > 30);

    const replayDecision = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollmentBody.enrollment.id}/decision`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
      payload: { decision: "approve" }
    });
    assert.equal(replayDecision.statusCode, 409, replayDecision.body);

    const approvedStatus = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollmentBody.enrollment.id}/status`,
      payload: { signature: pendingStatusSignature }
    });
    assert.equal(approvedStatus.statusCode, 200, approvedStatus.body);
    const approvedStatusBody = approvedStatus.json() as {
      enrollment: { status: string; deviceId: string | null };
    };
    assert.equal(approvedStatusBody.enrollment.status, "approved");
    assert.equal(approvedStatusBody.enrollment.deviceId, approvedDevice.id);

    const heartbeat1 = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: {
        deviceId: approvedDevice.id,
        sequence: 1,
        signature: sign(
          identity.privateKey,
          buildDeviceHeartbeatProof(approvedDevice.id, 1)
        )
      }
    });
    assert.equal(heartbeat1.statusCode, 200, heartbeat1.body);

    const replayHeartbeat = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: {
        deviceId: approvedDevice.id,
        sequence: 1,
        signature: sign(
          identity.privateKey,
          buildDeviceHeartbeatProof(approvedDevice.id, 1)
        )
      }
    });
    assert.equal(replayHeartbeat.statusCode, 409, replayHeartbeat.body);

    const onlineList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    const onlineRemote = (onlineList.json() as {
      devices: Array<{ id: string; presence: string; trust: string; lastSeenAt: string | null }>;
    }).devices.find((device) => device.id === approvedDevice.id)!;
    assert.equal(onlineRemote.presence, "online");
    assert.equal(onlineRemote.trust, "paired");
    assert.equal(onlineRemote.lastSeenAt, currentNow);

    currentNow = "2026-08-21T08:32:00.000Z";
    const offlineList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    const offlineRemote = (offlineList.json() as {
      devices: Array<{ id: string; presence: string }>;
    }).devices.find((device) => device.id === approvedDevice.id)!;
    assert.equal(offlineRemote.presence, "offline");

    const heartbeat2 = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: {
        deviceId: approvedDevice.id,
        sequence: 2,
        signature: sign(
          identity.privateKey,
          buildDeviceHeartbeatProof(approvedDevice.id, 2)
        )
      }
    });
    assert.equal(heartbeat2.statusCode, 200, heartbeat2.body);

    const revokeWithoutCsrf = await app.inject({
      method: "DELETE",
      url: `/api/devices/${approvedDevice.id}`,
      headers: { cookie }
    });
    assert.equal(revokeWithoutCsrf.statusCode, 403, revokeWithoutCsrf.body);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/devices/${approvedDevice.id}`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken }
    });
    assert.equal(revoked.statusCode, 200, revoked.body);

    const heartbeatAfterRevoke = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: {
        deviceId: approvedDevice.id,
        sequence: 3,
        signature: sign(
          identity.privateKey,
          buildDeviceHeartbeatProof(approvedDevice.id, 3)
        )
      }
    });
    assert.equal(heartbeatAfterRevoke.statusCode, 401, heartbeatAfterRevoke.body);

    const reenrollIdentity: EnrollmentIdentity = {
      ...identity,
      requestNonce: crypto.randomBytes(18).toString("base64url")
    };
    const reenroll = await app.inject({
      method: "POST",
      url: "/api/devices/enrollment-requests",
      payload: enrollmentPayload(reenrollIdentity)
    });
    assert.equal(reenroll.statusCode, 409, reenroll.body);

    currentNow = "2026-08-21T08:33:00.000Z";
    const deniedIdentity = enrollmentIdentity("Denied Mac");
    const deniedCreate = await app.inject({
      method: "POST",
      url: "/api/devices/enrollment-requests",
      payload: enrollmentPayload(deniedIdentity)
    });
    assert.equal(deniedCreate.statusCode, 201, deniedCreate.body);
    const deniedId = (deniedCreate.json() as { enrollment: { id: string } }).enrollment.id;
    const deniedDecision = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${deniedId}/decision`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
      payload: { decision: "deny" }
    });
    assert.equal(deniedDecision.statusCode, 200, deniedDecision.body);
    const deniedStatus = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${deniedId}/status`,
      payload: {
        signature: sign(deniedIdentity.privateKey, buildDeviceEnrollmentStatusProof(deniedId))
      }
    });
    assert.equal(deniedStatus.statusCode, 200, deniedStatus.body);
    assert.equal((deniedStatus.json() as { enrollment: { status: string } }).enrollment.status, "denied");

    const expiringIdentity = enrollmentIdentity("Expiring Mac");
    const expiringCreate = await app.inject({
      method: "POST",
      url: "/api/devices/enrollment-requests",
      payload: enrollmentPayload(expiringIdentity)
    });
    assert.equal(expiringCreate.statusCode, 201, expiringCreate.body);
    const expiringId = (expiringCreate.json() as { enrollment: { id: string } }).enrollment.id;
    currentNow = "2026-08-21T08:39:00.000Z";
    const expiredStatus = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${expiringId}/status`,
      payload: {
        signature: sign(expiringIdentity.privateKey, buildDeviceEnrollmentStatusProof(expiringId))
      }
    });
    assert.equal(expiredStatus.statusCode, 200, expiredStatus.body);
    assert.equal((expiredStatus.json() as { enrollment: { status: string } }).enrollment.status, "expired");
    const expiredApprove = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${expiringId}/decision`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
      payload: { decision: "approve" }
    });
    assert.equal(expiredApprove.statusCode, 409, expiredApprove.body);

    const finalList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    assert.equal(finalList.statusCode, 200, finalList.body);
    assert.equal(finalList.body.includes(identity.publicKey), false);
    assert.equal(finalList.body.includes(payload.signature), false);
  } finally {
    await app.close();
    const restore = (name: keyof typeof original, envName: string) => {
      const value = original[name];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    };
    restore("configPath", "CHATCOCKPIT_CONFIG_PATH");
    restore("apiToken", "CHATCOCKPIT_API_TOKEN");
    restore("host", "CHATCOCKPIT_HOST");
    restore("port", "CHATCOCKPIT_PORT");
    restore("exposed", "CHATCOCKPIT_EXPOSED");
    restore("publicBaseUrl", "CHATCOCKPIT_PUBLIC_BASE_URL");
    fs.rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write("VERIFY_DEVICE_REGISTRY_V1_OK\n");
}

await main();
