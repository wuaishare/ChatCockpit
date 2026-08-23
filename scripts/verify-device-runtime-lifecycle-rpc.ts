import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { DeviceCapabilityRpc } from "../src/devices/device-capability-rpc.js";
import { DeviceChannelHub } from "../src/devices/device-channel.js";
import {
  DeviceRuntimeLifecycleRpc,
  DeviceRuntimeLifecycleRpcError,
  type DeviceRuntimeLifecycleResultBody
} from "../src/devices/device-runtime-lifecycle-rpc.js";
import {
  buildDeviceChannelOpenProof,
  buildDeviceEnrollmentProof,
  buildDeviceRuntimeLifecycleResultProof
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

function operationId(label: string): string {
  return `cc_device_runtime_op_${label}_${"x".repeat(24)}`;
}

const proofDevice = "cc_device_abcdefghijklmnopqrstuvwx";
const proofNonce = "abcdefghijklmnopqrstuvwx";
assert.equal(
  buildDeviceChannelOpenProof(proofDevice, 7, proofNonce, 1).toString("utf8"),
  ["chatcockpit-device-channel-open-v1", proofDevice, "7", proofNonce].join("\n"),
  "v1 channel-open proof bytes must remain unchanged"
);
assert.equal(
  buildDeviceChannelOpenProof(proofDevice, 7, proofNonce, 2).toString("utf8"),
  ["chatcockpit-device-channel-open-v2", proofDevice, "7", proofNonce, "2"].join("\n"),
  "v2 channel-open proof bytes must remain unchanged"
);
assert.equal(
  buildDeviceChannelOpenProof(proofDevice, 7, proofNonce, 3).toString("utf8"),
  ["chatcockpit-device-channel-open-v3", proofDevice, "7", proofNonce, "3"].join("\n"),
  "v3 channel-open proof must use a new signature domain"
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-runtime-lifecycle-rpc-"));
const paths = buildFixturePaths(root);
ensureWorkspaceDirs(paths);
fs.writeFileSync(path.join(root, "README.md"), "# Runtime lifecycle RPC fixture\n", "utf8");
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
updateAccessPolicy(paths, { consolePathPrefix: "/ops-device-runtime-lifecycle-rpc" });

const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
const operatorService = new OperatorService({ store: operatorStore });
await operatorService.setOwnerPassword({
  username: "owner",
  password: "test-password-device-runtime-lifecycle-rpc"
});
const loginGate = operatorService.createSecureLoginGate().gateSecret;
operatorStore.close();

const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
const channelHub = new DeviceChannelHub();
const capabilityRpc = new DeviceCapabilityRpc(channelHub, { requestTimeoutMs: 250 });
const lifecycleRpc = new DeviceRuntimeLifecycleRpc(channelHub, { requestTimeoutMs: 1_000 });
const app = buildServer(paths, {
  deviceChannelHub: channelHub,
  deviceCapabilityRpc: capabilityRpc,
  deviceRuntimeLifecycleRpc: lifecycleRpc,
  deviceChannelPingIntervalMs: 5_000
});

try {
  const login = await app.inject({
    method: "POST",
    url: "/api/operator/login",
    headers: { "x-chatcockpit-login-gate": loginGate },
    payload: { username: "owner", password: "test-password-device-runtime-lifecycle-rpc" }
  });
  assert.equal(login.statusCode, 200, login.body);
  const owner = login.json() as { csrfToken: string };
  const cookie = sessionCookie(login.headers);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeySpki = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64url");
  const enrollmentInput = {
    displayName: "Runtime Lifecycle RPC Mac",
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

  const open = async (protocolVersion: 1 | 2 | 3, sequence: number) => {
    const nonce = crypto.randomBytes(18).toString("base64url");
    const connection = await transport.openChannel(origin, {
      deviceId,
      sequence,
      channelNonce: nonce,
      protocolVersion,
      signature: sign(
        privateKey,
        buildDeviceChannelOpenProof(deviceId, sequence, nonce, protocolVersion)
      )
    });
    const iterator = connection.events[Symbol.asyncIterator]();
    const ready = await nextEventOfType(iterator, "channel.ready");
    assert.equal(ready.protocolVersion, protocolVersion);
    return { connection, iterator, ready };
  };

  const v1 = await open(1, 1);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), false);
  assert.equal(channelHub.isRuntimeLifecycleRpcAvailable(deviceId), false);
  v1.connection.close();

  const v2 = await open(2, 2);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), true);
  assert.equal(channelHub.isRuntimeLifecycleRpcAvailable(deviceId), false);
  await assert.rejects(
    lifecycleRpc.request(deviceId, {
      operationId: operationId("v2"),
      action: "status"
    }),
    (error: unknown) =>
      error instanceof DeviceRuntimeLifecycleRpcError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_UNSUPPORTED"
  );
  v2.connection.close();

  const v3 = await open(3, 3);
  assert.equal(channelHub.isCapabilityRpcAvailable(deviceId), true);
  assert.equal(channelHub.isRuntimeLifecycleRpcAvailable(deviceId), true);

  const firstOp = operationId("first");
  const firstPending = lifecycleRpc.request(deviceId, {
    operationId: firstOp,
    action: "status",
    expectedStateRevision: 4
  });
  const firstRequest = await nextEventOfType(v3.iterator, "runtime.lifecycle.request");
  assert.deepEqual(firstRequest, {
    type: "runtime.lifecycle.request",
    protocolVersion: 1,
    operationId: firstOp,
    action: "status",
    issuedAt: firstRequest.issuedAt,
    expiresAt: firstRequest.expiresAt,
    expectedStateRevision: 4
  });

  const firstBody: DeviceRuntimeLifecycleResultBody = {
    operationId: firstOp,
    outcome: "ok",
    result: {
      schemaVersion: 1,
      support: "managed-macos",
      controlPlane: "running",
      runner: "registered",
      processSupervisor: "ready",
      observedAt: "2026-08-23T00:00:00.000Z"
    }
  };

  assert.equal(
    buildDeviceRuntimeLifecycleResultProof(
      deviceId,
      v3.ready.channelId,
      4,
      firstBody
    ).toString("utf8").split("\n", 1)[0],
    "chatcockpit-device-runtime-lifecycle-result-v1",
    "Runtime lifecycle results must use an independent signature domain"
  );

  await assert.rejects(
    transport.submitRuntimeLifecycleResult(origin, {
      deviceId,
      channelId: v3.ready.channelId,
      sequence: 4,
      body: firstBody,
      signature: sign(privateKey, Buffer.from("forged-lifecycle-result", "utf8"))
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_SIGNATURE_INVALID" &&
      error.statusCode === 401
  );

  const firstAck = await transport.submitRuntimeLifecycleResult(origin, {
    deviceId,
    channelId: v3.ready.channelId,
    sequence: 4,
    body: firstBody,
    signature: sign(
      privateKey,
      buildDeviceRuntimeLifecycleResultProof(
        deviceId,
        v3.ready.channelId,
        4,
        firstBody
      )
    )
  });
  assert.deepEqual(firstAck, { ok: true, acceptedSequence: 4 });
  assert.deepEqual(await firstPending, firstBody);

  await assert.rejects(
    transport.submitRuntimeLifecycleResult(origin, {
      deviceId,
      channelId: v3.ready.channelId,
      sequence: 5,
      body: firstBody,
      signature: sign(
        privateKey,
        buildDeviceRuntimeLifecycleResultProof(
          deviceId,
          v3.ready.channelId,
          5,
          firstBody
        )
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_OPERATION_UNKNOWN" &&
      error.statusCode === 409
  );

  const wrongChannelOp = operationId("wrong-channel");
  const wrongChannelPending = lifecycleRpc.request(deviceId, {
    operationId: wrongChannelOp,
    action: "status"
  });
  await nextEventOfType(v3.iterator, "runtime.lifecycle.request");
  const wrongChannelBody: DeviceRuntimeLifecycleResultBody = {
    operationId: wrongChannelOp,
    outcome: "ok",
    result: { ok: true }
  };
  const wrongChannelId = "cc_channel_wrongchannelxxxxxxxx";
  await assert.rejects(
    transport.submitRuntimeLifecycleResult(origin, {
      deviceId,
      channelId: wrongChannelId,
      sequence: 5,
      body: wrongChannelBody,
      signature: sign(
        privateKey,
        buildDeviceRuntimeLifecycleResultProof(
          deviceId,
          wrongChannelId,
          5,
          wrongChannelBody
        )
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_MISMATCH" &&
      error.statusCode === 409
  );
  await transport.submitRuntimeLifecycleResult(origin, {
    deviceId,
    channelId: v3.ready.channelId,
    sequence: 5,
    body: wrongChannelBody,
    signature: sign(
      privateKey,
      buildDeviceRuntimeLifecycleResultProof(
        deviceId,
        v3.ready.channelId,
        5,
        wrongChannelBody
      )
    )
  });
  await wrongChannelPending;

  const replayOp = operationId("replay");
  const replayPending = lifecycleRpc.request(deviceId, {
    operationId: replayOp,
    action: "status"
  });
  await nextEventOfType(v3.iterator, "runtime.lifecycle.request");
  const replayBody: DeviceRuntimeLifecycleResultBody = {
    operationId: replayOp,
    outcome: "ok",
    result: { ok: true }
  };
  await assert.rejects(
    transport.submitRuntimeLifecycleResult(origin, {
      deviceId,
      channelId: v3.ready.channelId,
      sequence: 5,
      body: replayBody,
      signature: sign(
        privateKey,
        buildDeviceRuntimeLifecycleResultProof(
          deviceId,
          v3.ready.channelId,
          5,
          replayBody
        )
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_CHANNEL_REPLAYED" &&
      error.statusCode === 409
  );
  await transport.submitRuntimeLifecycleResult(origin, {
    deviceId,
    channelId: v3.ready.channelId,
    sequence: 6,
    body: replayBody,
    signature: sign(
      privateKey,
      buildDeviceRuntimeLifecycleResultProof(
        deviceId,
        v3.ready.channelId,
        6,
        replayBody
      )
    )
  });
  await replayPending;

  const oversizedOp = operationId("oversized");
  const oversizedPending = lifecycleRpc.request(deviceId, {
    operationId: oversizedOp,
    action: "status"
  });
  await nextEventOfType(v3.iterator, "runtime.lifecycle.request");
  const oversizedBody = {
    operationId: oversizedOp,
    outcome: "ok" as const,
    result: { data: "x".repeat(96 * 1024) }
  };
  await assert.rejects(
    transport.submitRuntimeLifecycleResult(origin, {
      deviceId,
      channelId: v3.ready.channelId,
      sequence: 7,
      body: oversizedBody,
      signature: sign(
        privateKey,
        buildDeviceRuntimeLifecycleResultProof(
          deviceId,
          v3.ready.channelId,
          7,
          oversizedBody
        )
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_RESULT_TOO_LARGE" &&
      error.statusCode === 413
  );
  const boundedBody: DeviceRuntimeLifecycleResultBody = {
    operationId: oversizedOp,
    outcome: "ok",
    result: { ok: true }
  };
  await transport.submitRuntimeLifecycleResult(origin, {
    deviceId,
    channelId: v3.ready.channelId,
    sequence: 7,
    body: boundedBody,
    signature: sign(
      privateKey,
      buildDeviceRuntimeLifecycleResultProof(
        deviceId,
        v3.ready.channelId,
        7,
        boundedBody
      )
    )
  });
  await oversizedPending;

  await assert.rejects(
    lifecycleRpc.request(deviceId, {
      operationId: `cc_device_runtime_op_${"x".repeat(400)}`,
      action: "status"
    }),
    (error: unknown) =>
      error instanceof DeviceRuntimeLifecycleRpcError &&
      (error.code === "DEVICE_RUNTIME_LIFECYCLE_OPERATION_ID_INVALID" ||
        error.code === "DEVICE_RUNTIME_LIFECYCLE_REQUEST_TOO_LARGE")
  );

  const timeoutOp = operationId("timeout");
  const timeoutPending = lifecycleRpc.request(deviceId, {
    operationId: timeoutOp,
    action: "status"
  });
  await nextEventOfType(v3.iterator, "runtime.lifecycle.request");
  await assert.rejects(
    timeoutPending,
    (error: unknown) =>
      error instanceof DeviceRuntimeLifecycleRpcError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_REQUEST_TIMEOUT"
  );
  const lateBody: DeviceRuntimeLifecycleResultBody = {
    operationId: timeoutOp,
    outcome: "ok",
    result: { ok: true }
  };
  await assert.rejects(
    transport.submitRuntimeLifecycleResult(origin, {
      deviceId,
      channelId: v3.ready.channelId,
      sequence: 8,
      body: lateBody,
      signature: sign(
        privateKey,
        buildDeviceRuntimeLifecycleResultProof(
          deviceId,
          v3.ready.channelId,
          8,
          lateBody
        )
      )
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_OPERATION_UNKNOWN" &&
      error.statusCode === 409
  );

  const supersededOp = operationId("superseded");
  const supersededPending = lifecycleRpc.request(deviceId, {
    operationId: supersededOp,
    action: "status"
  });
  const supersededRejected = assert.rejects(
    supersededPending,
    (error: unknown) =>
      error instanceof DeviceRuntimeLifecycleRpcError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_CLOSED"
  );
  await nextEventOfType(v3.iterator, "runtime.lifecycle.request");
  const replacement = await open(3, 8);
  await supersededRejected;
  const close = await nextEventOfType(v3.iterator, "channel.close");
  assert.equal(close.reason, "superseded");

  const disconnectedOp = operationId("disconnected");
  const disconnectedPending = lifecycleRpc.request(deviceId, {
    operationId: disconnectedOp,
    action: "status"
  });
  const disconnectedRejected = assert.rejects(
    disconnectedPending,
    (error: unknown) =>
      error instanceof DeviceRuntimeLifecycleRpcError &&
      error.code === "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_CLOSED"
  );
  await nextEventOfType(replacement.iterator, "runtime.lifecycle.request");
  replacement.connection.close();
  await disconnectedRejected;

  v3.connection.close();
  process.stdout.write("VERIFY_DEVICE_RUNTIME_LIFECYCLE_RPC_OK\n");
} finally {
  lifecycleRpc.close();
  capabilityRpc.close();
  await app.close();
  if (originalConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
  fs.rmSync(root, { recursive: true, force: true });
}
