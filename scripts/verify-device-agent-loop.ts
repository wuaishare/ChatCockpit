import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEVICE_AGENT_MAX_INTERVAL_MS,
  DEVICE_AGENT_MIN_INTERVAL_MS,
  DeviceAgentProtocolError,
  DeviceAgentService
} from "../src/devices/device-agent.js";
import {
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const { publicKey: hubPublicKey } = crypto.generateKeyPairSync("ed25519");
const hubPublicDer = hubPublicKey.export({ format: "der", type: "spki" }) as Buffer;
const hubPublicKeySpki = hubPublicDer.toString("base64url");
const hubPublicKeyFingerprint = crypto.createHash("sha256").update(hubPublicDer).digest("base64url");
const hubIdentityResponse = {
  ok: true,
  hub: {
    schemaVersion: 1,
    hubId: `cc_hub_${hubPublicKeyFingerprint}`,
    algorithm: "Ed25519",
    publicKey: hubPublicKeySpki,
    publicKeyFingerprint: hubPublicKeyFingerprint,
    createdAt: "2026-08-21T10:59:00.000Z"
  }
};

function isHubIdentityRequest(input: string | URL | Request): boolean {
  const raw = input instanceof Request ? input.url : String(input);
  return new URL(raw).pathname === "/api/hub/identity";
}

function connectedRuntime(root: string, name: string): string {
  const runtimeDir = path.join(root, name);
  createDeviceAgentState({
    runtimeDir,
    hubOrigin: "http://127.0.0.1:4318",
    displayName: name,
    platform: "darwin",
    architecture: "arm64",
    now: "2026-08-21T11:00:00.000Z"
  });
  completeDeviceAgentEnrollment(
    runtimeDir,
    `cc_device_${name.replace(/[^A-Za-z0-9]/g, "").padEnd(24, "x").slice(0, 24)}`,
    "2026-08-21T11:00:01.000Z"
  );
  return runtimeDir;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-loop-"));

try {
  const retryRuntime = connectedRuntime(root, "retry-device");
  const retryDelays: number[] = [];
  const retryAttempts: number[] = [];
  const sequences: number[] = [];
  let fetchCount = 0;
  const abortController = new AbortController();
  const retryAgent = new DeviceAgentService({
    runtimeDir: retryRuntime,
    random: () => 0.5,
    now: () => "2026-08-21T11:01:00.000Z",
    sleep: async (milliseconds, signal) => {
      retryDelays.push(milliseconds);
      if (signal?.aborted) {
        throw new DeviceAgentProtocolError(null, "DEVICE_AGENT_ABORTED", "cancelled");
      }
    },
    fetchImpl: async (input, init) => {
      if (isHubIdentityRequest(input)) return jsonResponse(200, hubIdentityResponse);
      fetchCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { deviceId: string; sequence: number };
      sequences.push(body.sequence);
      if (fetchCount === 1) throw new Error("temporary network failure");
      return jsonResponse(200, {
        ok: true,
        deviceId: body.deviceId,
        acceptedSequence: body.sequence,
        revision: fetchCount
      });
    }
  });
  const retryResult = await retryAgent.runHeartbeatLoop({
    intervalMs: DEVICE_AGENT_MIN_INTERVAL_MS,
    signal: abortController.signal,
    onRetry: ({ attempt, delayMs, error }) => {
      retryAttempts.push(attempt);
      assert.equal(error.code, "DEVICE_AGENT_NETWORK_ERROR");
      assert.equal(delayMs, 1_000, "random=0.5 should produce neutral jitter");
    },
    onHeartbeat: () => abortController.abort()
  });
  assert.equal(retryResult.state, "connected");
  assert.deepEqual(sequences, [1, 2], "failed send may skip sequence but must never reuse it");
  assert.deepEqual(retryAttempts, [1]);
  assert.deepEqual(retryDelays, [1_000, DEVICE_AGENT_MIN_INTERVAL_MS]);
  assert.equal(readDeviceAgentState(retryRuntime)?.nextSequence, 3);
  assert.equal(readDeviceAgentState(retryRuntime)?.lastHeartbeatAt, "2026-08-21T11:01:00.000Z");

  const replayRuntime = connectedRuntime(root, "replay-device");
  let replayRetryCount = 0;
  const replayAgent = new DeviceAgentService({
    runtimeDir: replayRuntime,
    sleep: async () => undefined,
    fetchImpl: async (input) => isHubIdentityRequest(input)
      ? jsonResponse(200, hubIdentityResponse)
      : jsonResponse(409, {
          ok: false,
          error: { code: "DEVICE_HEARTBEAT_REPLAYED", message: "sequence already consumed" }
        })
  });
  await assert.rejects(
    replayAgent.runHeartbeatLoop({
      intervalMs: DEVICE_AGENT_MIN_INTERVAL_MS,
      onRetry: () => {
        replayRetryCount += 1;
      }
    }),
    (error: unknown) => error instanceof DeviceAgentProtocolError && error.code === "DEVICE_HEARTBEAT_REPLAYED"
  );
  assert.equal(replayRetryCount, 0, "replay conflicts must stop rather than busy-retrying");
  assert.equal(readDeviceAgentState(replayRuntime)?.nextSequence, 2);

  const revokedRuntime = connectedRuntime(root, "revoked-device");
  const revokedAgent = new DeviceAgentService({
    runtimeDir: revokedRuntime,
    sleep: async () => undefined,
    fetchImpl: async (input) => isHubIdentityRequest(input)
      ? jsonResponse(200, hubIdentityResponse)
      : jsonResponse(401, {
          ok: false,
          error: { code: "DEVICE_NOT_TRUSTED", message: "unknown or revoked" }
        })
  });
  await assert.rejects(
    revokedAgent.runHeartbeatLoop({ intervalMs: DEVICE_AGENT_MIN_INTERVAL_MS }),
    (error: unknown) => error instanceof DeviceAgentProtocolError && error.code === "DEVICE_NOT_TRUSTED"
  );
  assert.equal(readDeviceAgentState(revokedRuntime)?.revokedAt !== null, true);

  const invalidRuntime = connectedRuntime(root, "invalid-interval-device");
  const invalidAgent = new DeviceAgentService({
    runtimeDir: invalidRuntime,
    fetchImpl: async () => {
      throw new Error("must not send");
    }
  });
  await assert.rejects(
    invalidAgent.runHeartbeatLoop({ intervalMs: DEVICE_AGENT_MIN_INTERVAL_MS - 1 }),
    (error: unknown) => error instanceof DeviceAgentProtocolError && error.code === "DEVICE_AGENT_INTERVAL_INVALID"
  );
  await assert.rejects(
    invalidAgent.runHeartbeatLoop({ intervalMs: DEVICE_AGENT_MAX_INTERVAL_MS + 1 }),
    (error: unknown) => error instanceof DeviceAgentProtocolError && error.code === "DEVICE_AGENT_INTERVAL_INVALID"
  );

  process.stdout.write("VERIFY_DEVICE_AGENT_LOOP_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
