import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DeviceAgentRuntimeLifecycleService
} from "../src/devices/device-agent-runtime-lifecycle-service.js";
import {
  DeviceRuntimeOperationStore
} from "../src/devices/device-runtime-operation-store.js";
import {
  type DeviceRuntimeConditions
} from "../src/devices/device-runtime-lifecycle.js";
import type {
  DeviceRuntimeLifecycleRequestEnvelope
} from "../src/devices/device-runtime-lifecycle-rpc.js";
import {
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";
import { DeviceAgentService } from "../src/devices/device-agent.js";
import type {
  DeviceAgentChannelConnection,
  DeviceAgentChannelEvent,
  DeviceAgentChannelOpenInput,
  DeviceAgentRuntimeLifecycleResultInput,
  DeviceAgentTransport
} from "../src/devices/device-agent-transport.js";
import { createHubIdentity, projectHubIdentity } from "../src/devices/hub-identity.js";

function operationId(label: string): string {
  return `cc_device_runtime_op_${label}_${"x".repeat(24)}`;
}
function request(
  label: string,
  action: DeviceRuntimeLifecycleRequestEnvelope["action"]
): DeviceRuntimeLifecycleRequestEnvelope {
  return {
    protocolVersion: 1,
    operationId: operationId(label),
    action,
    issuedAt: "2026-08-23T15:00:00.000Z",
    expiresAt: "2026-08-23T15:10:00.000Z"
  };
}

const running = (): DeviceRuntimeConditions => ({
  schemaVersion: 1,
  support: "managed-macos",
  controlPlane: "running",
  runner: "registered",
  processSupervisor: "ready",
  observedAt: "2026-08-23T15:00:01.000Z"
});
class FixtureAdapter {
  startCalls = 0;
  stopCalls = 0;
  restartCalls = 0;
  conditions: DeviceRuntimeConditions = running();

  async status(): Promise<DeviceRuntimeConditions> {
    return this.conditions;
  }

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }

  async restart(): Promise<void> {
    this.restartCalls += 1;
  }
}

function connection(events: DeviceAgentChannelEvent[]): DeviceAgentChannelConnection {
  let closed = false;
  return {
    events: (async function* () {
      for (const event of events) {
        if (closed) return;
        yield event;
      }
    })(),
    close: () => { closed = true; }
  };
}

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "chatcockpit-device-agent-runtime-lifecycle-")
);
try {
  const adapter = new FixtureAdapter();
  const runtimeDir = path.join(root, "agent");
  const startRequest = request("start", "start");
  let service = new DeviceAgentRuntimeLifecycleService({
    runtimeDir,
    adapter,
    now: () => "2026-08-23T15:00:02.000Z"
  });

  const first = await service.execute(startRequest);
  assert.equal(first.outcome, "ok");
  assert.equal(adapter.startCalls, 1);
  assert.equal(service.operation(startRequest.operationId)?.state, "succeeded");
  service.close();

  service = new DeviceAgentRuntimeLifecycleService({
    runtimeDir,
    adapter,
    now: () => "2026-08-23T15:00:03.000Z"
  });
  const replayed = await service.execute(startRequest);
  assert.deepEqual(replayed, first);
  assert.equal(adapter.startCalls, 1);

  const mismatch = await service.execute({
    ...startRequest,
    action: "restart"
  });
  assert.equal(mismatch.outcome, "error");
  if (mismatch.outcome === "error") {
    assert.equal(
      mismatch.error.code,
      "DEVICE_RUNTIME_OPERATION_INTEGRITY_MISMATCH"
    );
  }
  assert.equal(adapter.restartCalls, 0);

  const expiredAdapter = new FixtureAdapter();
  const expiredService = new DeviceAgentRuntimeLifecycleService({
    runtimeDir: path.join(root, "expired"),
    adapter: expiredAdapter,
    now: () => "2026-08-23T16:00:00.000Z"
  });
  const expired = await expiredService.execute(request("expired", "restart"));
  assert.equal(expired.outcome, "error");
  if (expired.outcome === "error") {
    assert.equal(expired.error.code, "DEVICE_RUNTIME_LIFECYCLE_REQUEST_EXPIRED");
  }
  assert.equal(expiredAdapter.restartCalls, 0, "expired mutation must never execute");
  expiredService.close();

  const queried = await service.execute({
    ...startRequest,
    action: "operation.get"
  });
  assert.equal(queried.outcome, "ok");
  if (queried.outcome === "ok") {
    const projection = queried.result as { state?: unknown; action?: unknown };
    assert.equal(projection.state, "succeeded");
    assert.equal(projection.action, "start");
  }

  adapter.conditions = running();
  const stopRequest = request("stop-postflight", "stop");
  const failedStop = await service.execute(stopRequest);
  assert.equal(failedStop.outcome, "error");
  if (failedStop.outcome === "error") {
    assert.equal(failedStop.error.code, "DEVICE_RUNTIME_ACTION_FAILED");
  }
  assert.equal(adapter.stopCalls, 1);
  assert.deepEqual(await service.execute(stopRequest), failedStop);
  assert.equal(adapter.stopCalls, 1, "failed durable result must not replay stop");
  service.close();

  const store = new DeviceRuntimeOperationStore({
    runtimeDir: path.join(root, "store")
  });
  const prepared = store.prepare(
    request("ambiguous", "restart"),
    "2026-08-23T15:00:00.000Z"
  );
  store.markExecuting(
    prepared.operationId,
    "2026-08-23T15:00:01.000Z"
  );
  store.close();

  const recoveredAdapter = new FixtureAdapter();
  const recovered = new DeviceAgentRuntimeLifecycleService({
    runtimeDir: path.join(root, "store"),
    adapter: recoveredAdapter,
    now: () => "2026-08-23T15:00:05.000Z"
  });
  assert.equal(
    recovered.operation(prepared.operationId)?.state,
    "ambiguous"
  );
  const ambiguousReplay = await recovered.execute(request("ambiguous", "restart"));
  assert.equal(ambiguousReplay.outcome, "error");
  if (ambiguousReplay.outcome === "error") {
    assert.equal(ambiguousReplay.error.code, "DEVICE_RUNTIME_OPERATION_AMBIGUOUS");
  }
  assert.equal(recoveredAdapter.restartCalls, 0, "ambiguous mutation must never auto-replay");
  recovered.close();

  const channelRuntime = path.join(root, "channel-agent");
  createDeviceAgentState({
    runtimeDir: channelRuntime,
    hubOrigin: "https://hub.example.com",
    displayName: "runtime-agent",
    platform: "darwin",
    architecture: "arm64",
    now: "2026-08-23T15:20:00.000Z"
  });
  completeDeviceAgentEnrollment(
    channelRuntime,
    `cc_device_${"runtimeagent".padEnd(24, "x")}`,
    "2026-08-23T15:20:01.000Z"
  );
  const hub = projectHubIdentity(
    createHubIdentity(path.join(root, "hub"), "2026-08-23T15:19:00.000Z")
  );
  const hubResponse = {
    ok: true,
    hub: {
      schemaVersion: 1, hubId: hub.hubId, algorithm: "Ed25519",
      publicKey: hub.publicKeySpki, publicKeyFingerprint: hub.publicKeyFingerprint,
      createdAt: hub.createdAt
    }
  };
  const channelController = new AbortController();
  let channelOpen: DeviceAgentChannelOpenInput | null = null;
  let submitted: DeviceAgentRuntimeLifecycleResultInput | null = null;
  const transport: DeviceAgentTransport = {
    getHubIdentity: async () => hubResponse,
    proveHubIdentity: async () => ({ ok: true }),
    getLanTlsIdentity: async () => ({ ok: true }),
    proveLanTlsIdentity: async () => ({ ok: true }),
    createEnrollment: async () => ({ ok: true }),
    pollEnrollment: async () => ({ ok: true }),
    heartbeat: async () => ({ ok: true }),
    openChannel: async (_origin, input) => {
      channelOpen = input;
      return connection([
        {
          type: "channel.ready",
          channelId: "cc_channel_runtime_lifecycle_xxxx",
          deviceId: input.deviceId,
          acceptedSequence: input.sequence,
          protocolVersion: input.protocolVersion ?? 1
        },
        {
          type: "runtime.lifecycle.request",
          protocolVersion: 1,
          operationId: operationId("channel-restart"),
          action: "restart",
          issuedAt: "2026-08-23T15:20:02.000Z",
          expiresAt: "2026-08-23T15:21:02.000Z"
        }
      ]);
    },
    submitRuntimeLifecycleResult: async (_origin, input) => {
      submitted = input;
      channelController.abort();
      return { ok: true, acceptedSequence: input.sequence };
    }
  };
  const channelAdapter = new FixtureAdapter();
  const channelLifecycle = new DeviceAgentRuntimeLifecycleService({
    runtimeDir: channelRuntime,
    adapter: channelAdapter,
    now: () => "2026-08-23T15:20:03.000Z"
  });
  const agent = new DeviceAgentService({
    runtimeDir: channelRuntime,
    transport,
    runtimeLifecycleService: channelLifecycle
  });
  await agent.runOutboundChannelLoop({ signal: channelController.signal });
  assert.equal(channelOpen?.protocolVersion, 3);
  assert.equal(channelAdapter.restartCalls, 1);
  assert.ok(submitted);
  assert.equal(submitted.sequence, 2, "lifecycle result must reserve a fresh sequence");
  assert.equal(submitted.body.outcome, "ok");
  assert.match(submitted.signature, /^[A-Za-z0-9_-]+$/);
  assert.equal(readDeviceAgentState(channelRuntime)?.nextSequence, 3);
  channelLifecycle.close();

  process.stdout.write("VERIFY_DEVICE_AGENT_RUNTIME_LIFECYCLE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
