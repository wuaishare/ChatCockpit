import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { DeviceCapabilityRpc, DeviceCapabilityRpcError } from "../src/devices/device-capability-rpc.js";
import { DeviceChannelHub } from "../src/devices/device-channel.js";
import {
  buildDeviceChannelOpenProof,
  buildDeviceChannelResultProof,
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

async function nextEventOfType<T extends DeviceAgentChannelEvent["type"]>(
  iterator: AsyncIterator<DeviceAgentChannelEvent>,
  type: T,
  timeoutMs = 2_000
): Promise<Extract<DeviceAgentChannelEvent, { type: T }>> {
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
    if (result.value.type === type) {
      return result.value as Extract<DeviceAgentChannelEvent, { type: T }>;
    }
  }
  throw new Error(`Timed out waiting for ${type}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-capability-rpc-"));
const paths = buildFixturePaths(root);
ensureWorkspaceDirs(paths);
fs.writeFileSync(path.join(root, "README.md"), "# Device capability RPC fixture\n", "utf8");
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
updateAccessPolicy(paths, { consolePathPrefix: "/ops-device-capability-rpc" });

const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
const operatorService = new OperatorService({ store: operatorStore });
await operatorService.setOwnerPassword({ username: "owner", password: "test-password-device-capability-rpc" });
const loginGate = operatorService.createSecureLoginGate().gateSecret;
operatorStore.close();

const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
const channelHub = new DeviceChannelHub();
const rpc = new DeviceCapabilityRpc(channelHub, { requestTimeoutMs: 250 });
const app = buildServer(paths, {
  deviceChannelHub: channelHub,
  deviceCapabilityRpc: rpc,
  deviceChannelPingIntervalMs: 5_000
});

try {
  const login = await app.inject({
    method: "POST",
    url: "/api/operator/login",
    headers: { "x-chatcockpit-login-gate": loginGate },
    payload: { username: "owner", password: "test-password-device-capability-rpc" }
  });
  assert.equal(login.statusCode, 200, login.body);
  const owner = login.json() as { csrfToken: string };
  const cookie = sessionCookie(login.headers);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeySpki = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64url");
  const enrollmentInput = {
    displayName: "Capability RPC Mac",
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

  const v1Nonce = crypto.randomBytes(18).toString("base64url");
  const v1 = await transport.openChannel(origin, {
    deviceId,
    sequence: 1,
    channelNonce: v1Nonce,
    signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 1, v1Nonce))
  });
  const v1Iterator = v1.events[Symbol.asyncIterator]();
  const v1Ready = await nextEventOfType(v1Iterator, "channel.ready");
  assert.equal(v1Ready.protocolVersion, 1);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), false);
  await assert.rejects(
    rpc.request(deviceId, "capabilities.list", {}),
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_CHANNEL_RPC_UNSUPPORTED"
  );

  const tamperedV2Nonce = crypto.randomBytes(18).toString("base64url");
  await assert.rejects(
    transport.openChannel(origin, {
      deviceId,
      sequence: 2,
      channelNonce: tamperedV2Nonce,
      protocolVersion: 2,
      signature: sign(
        privateKey,
        buildDeviceChannelOpenProof(deviceId, 2, tamperedV2Nonce, 1)
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_SIGNATURE_INVALID" &&
      error.statusCode === 401
  );

  const v2Nonce = crypto.randomBytes(18).toString("base64url");
  const v2 = await transport.openChannel(origin, {
    deviceId,
    sequence: 2,
    channelNonce: v2Nonce,
    protocolVersion: 2,
    signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 2, v2Nonce, 2))
  });
  const v2Iterator = v2.events[Symbol.asyncIterator]();
  const v2Ready = await nextEventOfType(v2Iterator, "channel.ready");
  assert.equal(v2Ready.protocolVersion, 2);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), true);
  const devicesWithV2 = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie }
  });
  assert.equal(devicesWithV2.statusCode, 200, devicesWithV2.body);
  const v2DeviceProjection = (devicesWithV2.json() as {
    devices: Array<{ id: string; management: { remoteRead?: boolean } }>;
  }).devices.find((device) => device.id === deviceId);
  assert.equal(v2DeviceProjection?.management.remoteRead, true);
  const v1Closed = await nextEventOfType(v1Iterator, "channel.close");
  assert.equal(v1Closed.reason, "superseded");

  const firstPending = rpc.request(deviceId, "capabilities.list", {});
  const firstRequest = await nextEventOfType(v2Iterator, "capability.request");
  assert.equal(firstRequest.operation, "capabilities.list");
  assert.deepEqual(firstRequest.payload, {});
  const firstBody = {
    requestId: firstRequest.requestId,
    outcome: "ok" as const,
    result: { ok: true, providers: [] }
  };
  const extraFieldBody = { ...firstBody, unexpected: true };
  await assert.rejects(
    transport.submitChannelResult(origin, {
      deviceId,
      channelId: v2Ready.channelId,
      sequence: 3,
      body: extraFieldBody,
      signature: sign(
        privateKey,
        buildDeviceChannelResultProof(
          deviceId,
          v2Ready.channelId,
          3,
          extraFieldBody
        )
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CAPABILITY_RESULT_INVALID" &&
      error.statusCode === 400
  );

  const firstSubmit = await transport.submitChannelResult(origin, {
    deviceId,
    channelId: v2Ready.channelId,
    sequence: 3,
    body: firstBody,
    signature: sign(
      privateKey,
      buildDeviceChannelResultProof(deviceId, v2Ready.channelId, 3, firstBody)
    )
  });
  assert.deepEqual(firstSubmit, { ok: true, acceptedSequence: 3 });
  assert.deepEqual(await firstPending, firstBody);

  await assert.rejects(
    transport.submitChannelResult(origin, {
      deviceId,
      channelId: v2Ready.channelId,
      sequence: 4,
      body: firstBody,
      signature: sign(
        privateKey,
        buildDeviceChannelResultProof(deviceId, v2Ready.channelId, 4, firstBody)
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CAPABILITY_REQUEST_UNKNOWN" &&
      error.statusCode === 409
  );

  const secondPending = rpc.request(deviceId, "capabilities.inspect", {
    executorId: "fixture",
    toolName: "read"
  });
  const secondRequest = await nextEventOfType(v2Iterator, "capability.request");
  const secondBody = {
    requestId: secondRequest.requestId,
    outcome: "ok" as const,
    result: { ok: true, tool: { name: "read" } }
  };
  await assert.rejects(
    transport.submitChannelResult(origin, {
      deviceId,
      channelId: v2Ready.channelId,
      sequence: 4,
      body: secondBody,
      signature: sign(privateKey, Buffer.from("forged-result-proof", "utf8"))
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_SIGNATURE_INVALID" &&
      error.statusCode === 401
  );
  assert.throws(
    () =>
      rpc.assertExpectedResult({
        deviceId: "cc_device_wrongdevicexxxxxxxxxxx",
        channelId: v2Ready.channelId,
        body: secondBody
      }),
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_CAPABILITY_DEVICE_MISMATCH"
  );

  const wrongChannelId = "cc_channel_wrongchannelxxxxxxxx";
  await assert.rejects(
    transport.submitChannelResult(origin, {
      deviceId,
      channelId: wrongChannelId,
      sequence: 4,
      body: secondBody,
      signature: sign(
        privateKey,
        buildDeviceChannelResultProof(deviceId, wrongChannelId, 4, secondBody)
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CAPABILITY_CHANNEL_MISMATCH" &&
      error.statusCode === 409
  );
  await transport.submitChannelResult(origin, {
    deviceId,
    channelId: v2Ready.channelId,
    sequence: 4,
    body: secondBody,
    signature: sign(
      privateKey,
      buildDeviceChannelResultProof(deviceId, v2Ready.channelId, 4, secondBody)
    )
  });
  assert.deepEqual(await secondPending, secondBody);

  const replayPending = rpc.request(deviceId, "capabilities.list", {});
  const replayRequest = await nextEventOfType(v2Iterator, "capability.request");
  const replayBody = {
    requestId: replayRequest.requestId,
    outcome: "ok" as const,
    result: { ok: true, providers: [] }
  };
  await assert.rejects(
    transport.submitChannelResult(origin, {
      deviceId,
      channelId: v2Ready.channelId,
      sequence: 4,
      body: replayBody,
      signature: sign(
        privateKey,
        buildDeviceChannelResultProof(deviceId, v2Ready.channelId, 4, replayBody)
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CHANNEL_REPLAYED" &&
      error.statusCode === 409
  );
  await transport.submitChannelResult(origin, {
    deviceId,
    channelId: v2Ready.channelId,
    sequence: 5,
    body: replayBody,
    signature: sign(
      privateKey,
      buildDeviceChannelResultProof(deviceId, v2Ready.channelId, 5, replayBody)
    )
  });
  await replayPending;

  const oversizedPending = rpc.request(deviceId, "capabilities.list", {});
  const oversizedRequest = await nextEventOfType(v2Iterator, "capability.request");
  const oversizedBody = {
    requestId: oversizedRequest.requestId,
    outcome: "ok" as const,
    result: { data: "x".repeat(270 * 1024) }
  };
  await assert.rejects(
    transport.submitChannelResult(origin, {
      deviceId,
      channelId: v2Ready.channelId,
      sequence: 6,
      body: oversizedBody,
      signature: sign(
        privateKey,
        buildDeviceChannelResultProof(deviceId, v2Ready.channelId, 6, oversizedBody)
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CAPABILITY_RESULT_TOO_LARGE" &&
      error.statusCode === 413
  );
  const boundedBody = {
    requestId: oversizedRequest.requestId,
    outcome: "ok" as const,
    result: { ok: true }
  };
  await transport.submitChannelResult(origin, {
    deviceId,
    channelId: v2Ready.channelId,
    sequence: 6,
    body: boundedBody,
    signature: sign(
      privateKey,
      buildDeviceChannelResultProof(deviceId, v2Ready.channelId, 6, boundedBody)
    )
  });
  assert.deepEqual(await oversizedPending, boundedBody);

  await assert.rejects(
    rpc.request(deviceId, "capabilities.read.invoke", {
      data: "x".repeat(70 * 1024)
    }),
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_CAPABILITY_REQUEST_TOO_LARGE"
  );

  const timeoutPending = rpc.request(deviceId, "capabilities.list", {});
  await nextEventOfType(v2Iterator, "capability.request");
  await assert.rejects(
    timeoutPending,
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_CAPABILITY_REQUEST_TIMEOUT"
  );

  const closedPending = rpc.request(deviceId, "capabilities.list", {});
  const closedPendingRejected = assert.rejects(
    closedPending,
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_CAPABILITY_CHANNEL_CLOSED"
  );
  await nextEventOfType(v2Iterator, "capability.request");
  const v2Nonce2 = crypto.randomBytes(18).toString("base64url");
  const v2Replacement = await transport.openChannel(origin, {
    deviceId,
    sequence: 7,
    channelNonce: v2Nonce2,
    protocolVersion: 3,
    signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 7, v2Nonce2, 3))
  });
  const replacementIterator = v2Replacement.events[Symbol.asyncIterator]();
  const replacementReady = await nextEventOfType(replacementIterator, "channel.ready");
  assert.equal(replacementReady.protocolVersion, 3);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), true);
  assert.equal(channelHub.isRuntimeLifecycleRpcAvailable(deviceId), true);
  await closedPendingRejected;
  await assert.rejects(
    rpc.request(deviceId, "workspace.read.invoke", {
      action: "workspaces.list",
      params: {}
    }),
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_WORKSPACE_RPC_UNSUPPORTED"
  );

  const v4Nonce = crypto.randomBytes(18).toString("base64url");
  const v4 = await transport.openChannel(origin, {
    deviceId,
    sequence: 8,
    channelNonce: v4Nonce,
    protocolVersion: 4,
    signature: sign(privateKey, buildDeviceChannelOpenProof(deviceId, 8, v4Nonce, 4))
  });
  const v4Iterator = v4.events[Symbol.asyncIterator]();
  const v4Ready = await nextEventOfType(v4Iterator, "channel.ready");
  assert.equal(v4Ready.protocolVersion, 4);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), true);
  assert.equal(channelHub.isRuntimeLifecycleRpcAvailable(deviceId), true);
  const v3Closed = await nextEventOfType(replacementIterator, "channel.close");
  assert.equal(v3Closed.reason, "superseded");

  const workspacePending = rpc.request(deviceId, "workspace.read.invoke", {
    action: "workspaces.list",
    params: {}
  });
  const workspaceRequest = await nextEventOfType(v4Iterator, "capability.request");
  assert.equal(workspaceRequest.operation, "workspace.read.invoke");
  assert.deepEqual(workspaceRequest.payload, {
    action: "workspaces.list",
    params: {}
  });
  const workspaceBody = {
    requestId: workspaceRequest.requestId,
    outcome: "ok" as const,
    result: {
      ok: true,
      pathVisibility: "hidden",
      workspaces: [{ repoId: "primary", pathVisibility: "hidden" }]
    }
  };
  await transport.submitChannelResult(origin, {
    deviceId,
    channelId: v4Ready.channelId,
    sequence: 9,
    body: workspaceBody,
    signature: sign(
      privateKey,
      buildDeviceChannelResultProof(deviceId, v4Ready.channelId, 9, workspaceBody)
    )
  });
  assert.deepEqual(await workspacePending, workspaceBody);

  const v5Nonce = crypto.randomBytes(18).toString("base64url");
  await assert.rejects(
    transport.openChannel(origin, {
      deviceId,
      sequence: 10,
      channelNonce: v5Nonce,
      protocolVersion: 5,
      signature: sign(
        privateKey,
        buildDeviceChannelOpenProof(deviceId, 10, v5Nonce, 5, [])
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CHANNEL_CAPABILITY_ATTESTATION_REQUIRED" &&
      error.statusCode === 400
  );

  await assert.rejects(
    transport.openChannel(origin, {
      deviceId,
      sequence: 10,
      channelNonce: v5Nonce,
      protocolVersion: 5,
      capabilities: ["capability-rpc"],
      signature: sign(
        privateKey,
        buildDeviceChannelOpenProof(
          deviceId,
          10,
          v5Nonce,
          5,
          ["capability-rpc", "workspace-rpc"]
        )
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_SIGNATURE_INVALID" &&
      error.statusCode === 401
  );

  const v5 = await transport.openChannel(origin, {
    deviceId,
    sequence: 10,
    channelNonce: v5Nonce,
    protocolVersion: 5,
    capabilities: ["capability-rpc", "workspace-rpc"],
    signature: sign(
      privateKey,
      buildDeviceChannelOpenProof(
        deviceId,
        10,
        v5Nonce,
        5,
        ["capability-rpc", "workspace-rpc"]
      )
    )
  });
  const v5Iterator = v5.events[Symbol.asyncIterator]();
  const v5Ready = await nextEventOfType(v5Iterator, "channel.ready");
  assert.equal(v5Ready.protocolVersion, 5);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), true);
  assert.equal(channelHub.isWorkspaceRpcAvailable(deviceId), true);
  assert.equal(
    channelHub.isRuntimeLifecycleRpcAvailable(deviceId),
    false,
    "signed v5 capability attestation must not infer Runtime lifecycle from Workspace RPC"
  );
  const v4Closed = await nextEventOfType(v4Iterator, "channel.close");
  assert.equal(v4Closed.reason, "superseded");

  const revokedPending = rpc.request(deviceId, "capabilities.list", {});
  const revokedPendingRejected = assert.rejects(
    revokedPending,
    (error: unknown) =>
      error instanceof DeviceCapabilityRpcError &&
      error.code === "DEVICE_CAPABILITY_CHANNEL_CLOSED"
  );
  await nextEventOfType(v5Iterator, "capability.request");
  const revoked = await app.inject({
    method: "DELETE",
    url: `/api/devices/${deviceId}`,
    headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  await revokedPendingRejected;
  const revokedClose = await nextEventOfType(v5Iterator, "channel.close");
  assert.equal(revokedClose.reason, "revoked");
  assert.equal(channelHub.isActive(deviceId), false);

  v1.close();
  v2.close();
  v2Replacement.close();
  v4.close();
  process.stdout.write("VERIFY_DEVICE_CAPABILITY_RPC_OK\n");
} finally {
  rpc.close();
  await app.close();
  if (originalConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
  fs.rmSync(root, { recursive: true, force: true });
}
