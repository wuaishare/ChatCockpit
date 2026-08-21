import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { DeviceChannelHub } from "../src/devices/device-channel.js";
import {
  buildDeviceChannelOpenProof,
  buildDeviceEnrollmentProof
} from "../src/devices/device-registry.js";
import {
  DeviceAgentTransportError,
  HttpDeviceAgentTransport,
  type DeviceAgentChannelEvent
} from "../src/devices/device-agent-transport.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function sign(privateKey: crypto.KeyObject, message: Buffer): string {
  return crypto.sign(null, message, privateKey).toString("base64url");
}

function sessionCookie(headers: Record<string, string | string[] | undefined>): string {
  const value = headers["set-cookie"];
  const selected = Array.isArray(value) ? value[0] : value;
  assert.ok(selected);
  return selected.split(";", 1)[0]!;
}

async function nextEventOfType(
  iterator: AsyncIterator<DeviceAgentChannelEvent>,
  type: DeviceAgentChannelEvent["type"],
  timeoutMs = 2_000
): Promise<DeviceAgentChannelEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), remaining)
      )
    ]);
    if (result.done) throw new Error(`Device channel closed before ${type}`);
    if (result.value.type === type) return result.value;
  }
  throw new Error(`Timed out waiting for ${type}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-channel-"));
const paths = buildFixturePaths(root);
ensureWorkspaceDirs(paths);
fs.writeFileSync(path.join(root, "README.md"), "# Device channel fixture\n", "utf8");
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
updateAccessPolicy(paths, { consolePathPrefix: "/ops-device-channel" });

const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
const operatorService = new OperatorService({ store: operatorStore });
await operatorService.setOwnerPassword({ username: "owner", password: "test-password-device-channel" });
const loginGate = operatorService.createSecureLoginGate().gateSecret;
operatorStore.close();

const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
let currentNow = "2026-08-21T19:00:00.000Z";
const channelHub = new DeviceChannelHub();
const app = buildServer(paths, {
  deviceNow: () => currentNow,
  deviceChannelHub: channelHub,
  deviceChannelPingIntervalMs: 20
});

try {
  const deniedNetworkPeer = await app.inject({
    method: "GET",
    url: "/api/devices/channel",
    headers: {
      host: "198.51.100.10",
      "x-chatcockpit-device-id": "cc_device_abcdefghijklmnopqrstuvwx",
      "x-chatcockpit-channel-sequence": "1",
      "x-chatcockpit-channel-nonce": "abcdefghijklmnopqrstuvwx",
      "x-chatcockpit-channel-signature": "invalid"
    },
    remoteAddress: "198.51.100.7"
  });
  assert.equal(deniedNetworkPeer.statusCode, 404, deniedNetworkPeer.body);

  const login = await app.inject({
    method: "POST",
    url: "/api/operator/login",
    headers: { "x-chatcockpit-login-gate": loginGate },
    payload: { username: "owner", password: "test-password-device-channel" }
  });
  assert.equal(login.statusCode, 200, login.body);
  const owner = login.json() as { csrfToken: string };
  const cookie = sessionCookie(login.headers);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeySpki = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64url");
  const enrollmentInput = {
    displayName: "Outbound Channel Mac",
    platform: "darwin",
    architecture: "arm64",
    publicKey: publicKeySpki,
    requestNonce: crypto.randomBytes(18).toString("base64url")
  };
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/devices/enrollment-requests",
    payload: {
      ...enrollmentInput,
      signature: sign(privateKey, buildDeviceEnrollmentProof(enrollmentInput))
    }
  });
  assert.equal(enrollment.statusCode, 201, enrollment.body);
  const enrollmentId = (enrollment.json() as { enrollment: { id: string } }).enrollment.id;
  const approved = await app.inject({
    method: "POST",
    url: `/api/devices/enrollment-requests/${enrollmentId}/decision`,
    headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
    payload: { decision: "approve" }
  });
  assert.equal(approved.statusCode, 200, approved.body);
  const deviceId = (approved.json() as { device: { id: string } }).device.id;

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport = new HttpDeviceAgentTransport();

  const invalidNonce = crypto.randomBytes(18).toString("base64url");
  await assert.rejects(
    transport.openChannel(origin, {
      deviceId,
      sequence: 1,
      channelNonce: invalidNonce,
      signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 1, crypto.randomBytes(18).toString("base64url")))
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_SIGNATURE_INVALID" &&
      error.statusCode === 401
  );

  const nonce1 = crypto.randomBytes(18).toString("base64url");
  const channel1 = await transport.openChannel(origin, {
    deviceId,
    sequence: 1,
    channelNonce: nonce1,
    signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 1, nonce1))
  });
  const iterator1 = channel1.events[Symbol.asyncIterator]();
  const ready1 = await nextEventOfType(iterator1, "channel.ready");
  assert.equal(ready1.type, "channel.ready");
  if (ready1.type === "channel.ready") {
    assert.equal(ready1.deviceId, deviceId);
    assert.equal(ready1.acceptedSequence, 1);
    assert.equal(ready1.protocolVersion, 1);
  }
  assert.equal(channelHub.isActive(deviceId), true);
  assert.equal(
    channelHub.isCapabilityRpcAvailable(deviceId),
    false,
    "v1 compatibility channel must remain presence-only"
  );
  await nextEventOfType(iterator1, "channel.ping");

  currentNow = "2026-08-21T19:05:00.000Z";
  const listedWhileChannelActive = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie }
  });
  const activeProjection = (listedWhileChannelActive.json() as {
    devices: Array<{ id: string; presence: string }>;
  }).devices.find((device) => device.id === deviceId);
  assert.equal(activeProjection?.presence, "online", "active outbound channel must keep presence online");

  const nonce2 = crypto.randomBytes(18).toString("base64url");
  const channel2 = await transport.openChannel(origin, {
    deviceId,
    sequence: 2,
    channelNonce: nonce2,
    signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 2, nonce2))
  });
  const iterator2 = channel2.events[Symbol.asyncIterator]();
  const ready2 = await nextEventOfType(iterator2, "channel.ready");
  assert.equal(ready2.type, "channel.ready");
  const superseded = await nextEventOfType(iterator1, "channel.close");
  assert.deepEqual(superseded, { type: "channel.close", reason: "superseded" });
  assert.equal(channelHub.isActive(deviceId), true);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), false);

  await assert.rejects(
    transport.openChannel(origin, {
      deviceId,
      sequence: 2,
      channelNonce: nonce2,
      signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 2, nonce2))
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CHANNEL_REPLAYED" &&
      error.statusCode === 409
  );

  const revoked = await app.inject({
    method: "DELETE",
    url: `/api/devices/${deviceId}`,
    headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  const revokedClose = await nextEventOfType(iterator2, "channel.close");
  assert.deepEqual(revokedClose, { type: "channel.close", reason: "revoked" });
  assert.equal(channelHub.isActive(deviceId), false);

  const nonce3 = crypto.randomBytes(18).toString("base64url");
  await assert.rejects(
    transport.openChannel(origin, {
      deviceId,
      sequence: 3,
      channelNonce: nonce3,
      signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 3, nonce3))
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_NOT_TRUSTED" &&
      error.statusCode === 401
  );

  channel1.close();
  channel2.close();
  process.stdout.write("VERIFY_DEVICE_OUTBOUND_CHANNEL_OK\n");
} finally {
  await app.close();
  if (originalConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
  fs.rmSync(root, { recursive: true, force: true });
}
