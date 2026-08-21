import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildDeviceHeartbeatProof,
  buildDevicePairingProof
} from "../src/devices/device-registry.js";
import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function sign(privateKey: crypto.KeyObject, message: Buffer): string {
  return crypto.sign(null, message, privateKey).toString("base64url");
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-registry-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(root, "README.md"), "# Device registry fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"),
    path.join(root, "openapi/chatcockpit.openapi.yaml")
  );
  const configPath = path.join(paths.runtimeDir, "fixture-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [root],
    repoMappings: { primary: { path: root } }
  }), "utf8");

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-device-registry"
  });
  operatorStore.close();

  const original = { ...process.env };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-device-registry";
  process.env.CHATCOCKPIT_HOST = "0.0.0.0";
  process.env.CHATCOCKPIT_PORT = "5123";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  let currentNow = "2026-08-21T02:50:00.000Z";
  const app = buildServer(paths, { deviceNow: () => currentNow });
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/devices" });
    assert.equal(anonymous.statusCode, 401, anonymous.body);

    const machine = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { authorization: "Bearer test-token-device-registry" }
    });
    assert.equal(machine.statusCode, 401, machine.body);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-device-registry" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const session = login.json() as { csrfToken: string };
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0];

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

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/devices/pairings",
      headers: { cookie },
      payload: { displayName: "MacBook Pro" }
    });
    assert.equal(missingCsrf.statusCode, 403, missingCsrf.body);

    const prepared = await app.inject({
      method: "POST",
      url: "/api/devices/pairings",
      headers: { cookie, "x-chatcockpit-csrf": session.csrfToken },
      payload: { displayName: "MacBook Pro" }
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    const pairing = (prepared.json() as {
      pairing: { id: string; code: string; displayName: string; expiresAt: string };
    }).pairing;
    assert.match(pairing.id, /^cc_pairing_/);
    assert.match(pairing.code, /^cc_pair_/);
    assert.equal(pairing.displayName, "MacBook Pro");

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyEncoded = (publicKey.export({ format: "der", type: "spki" }) as Buffer)
      .toString("base64url");
    const platform = "darwin";
    const architecture = "arm64";
    const pairingSignature = sign(
      privateKey,
      buildDevicePairingProof({
        pairingId: pairing.id,
        publicKey: publicKeyEncoded,
        platform,
        architecture
      })
    );

    const badClaim = await app.inject({
      method: "POST",
      url: "/api/devices/pairings/claim",
      payload: {
        pairingId: pairing.id,
        code: `${pairing.code}x`,
        publicKey: publicKeyEncoded,
        platform,
        architecture,
        signature: pairingSignature
      }
    });
    assert.equal(badClaim.statusCode, 401, badClaim.body);

    const claim = await app.inject({
      method: "POST",
      url: "/api/devices/pairings/claim",
      payload: {
        pairingId: pairing.id,
        code: pairing.code,
        publicKey: publicKeyEncoded,
        platform,
        architecture,
        signature: pairingSignature
      }
    });
    assert.equal(claim.statusCode, 201, claim.body);
    const pairedDevice = (claim.json() as {
      device: { id: string; displayName: string; publicKeyFingerprint: string };
    }).device;
    assert.match(pairedDevice.id, /^cc_device_/);
    assert.equal(pairedDevice.displayName, "MacBook Pro");
    assert.ok(pairedDevice.publicKeyFingerprint.length > 30);
    assert.equal(claim.body.includes(pairing.code), false);
    assert.equal(claim.body.includes(publicKeyEncoded), false);

    const replayClaim = await app.inject({
      method: "POST",
      url: "/api/devices/pairings/claim",
      payload: {
        pairingId: pairing.id,
        code: pairing.code,
        publicKey: publicKeyEncoded,
        platform,
        architecture,
        signature: pairingSignature
      }
    });
    assert.equal(replayClaim.statusCode, 401, replayClaim.body);

    const heartbeat1Signature = sign(
      privateKey,
      buildDeviceHeartbeatProof(pairedDevice.id, 1)
    );
    const heartbeat1 = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: { deviceId: pairedDevice.id, sequence: 1, signature: heartbeat1Signature }
    });
    assert.equal(heartbeat1.statusCode, 200, heartbeat1.body);

    const replayHeartbeat = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: { deviceId: pairedDevice.id, sequence: 1, signature: heartbeat1Signature }
    });
    assert.equal(replayHeartbeat.statusCode, 409, replayHeartbeat.body);

    const onlineList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    const onlineDevices = (onlineList.json() as {
      devices: Array<{ id: string; presence: string; trust: string; lastSeenAt: string | null }>;
    }).devices;
    const onlineRemote = onlineDevices.find((device) => device.id === pairedDevice.id)!;
    assert.equal(onlineRemote.presence, "online");
    assert.equal(onlineRemote.trust, "paired");
    assert.equal(onlineRemote.lastSeenAt, currentNow);

    currentNow = "2026-08-21T02:52:00.000Z";
    const offlineList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    const offlineRemote = (offlineList.json() as {
      devices: Array<{ id: string; presence: string }>;
    }).devices.find((device) => device.id === pairedDevice.id)!;
    assert.equal(offlineRemote.presence, "offline");

    const heartbeat2Signature = sign(
      privateKey,
      buildDeviceHeartbeatProof(pairedDevice.id, 2)
    );
    const heartbeat2 = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: { deviceId: pairedDevice.id, sequence: 2, signature: heartbeat2Signature }
    });
    assert.equal(heartbeat2.statusCode, 200, heartbeat2.body);

    const revokeWithoutCsrf = await app.inject({
      method: "DELETE",
      url: `/api/devices/${pairedDevice.id}`,
      headers: { cookie }
    });
    assert.equal(revokeWithoutCsrf.statusCode, 403, revokeWithoutCsrf.body);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/devices/${pairedDevice.id}`,
      headers: { cookie, "x-chatcockpit-csrf": session.csrfToken }
    });
    assert.equal(revoked.statusCode, 200, revoked.body);

    const heartbeat3Signature = sign(
      privateKey,
      buildDeviceHeartbeatProof(pairedDevice.id, 3)
    );
    const afterRevokeHeartbeat = await app.inject({
      method: "POST",
      url: "/api/devices/heartbeat",
      payload: { deviceId: pairedDevice.id, sequence: 3, signature: heartbeat3Signature }
    });
    assert.equal(afterRevokeHeartbeat.statusCode, 401, afterRevokeHeartbeat.body);

    const revokedList = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    const revokedRemote = (revokedList.json() as {
      devices: Array<{ id: string; presence: string; trust: string }>;
    }).devices.find((device) => device.id === pairedDevice.id)!;
    assert.equal(revokedRemote.presence, "revoked");
    assert.equal(revokedRemote.trust, "revoked");
    assert.equal(revokedList.body.includes("public_key_spki"), false);
    assert.equal(revokedList.body.includes(publicKeyEncoded), false);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write("VERIFY_DEVICE_REGISTRY_OK\n");
}

await main();
