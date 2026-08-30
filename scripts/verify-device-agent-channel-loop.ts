import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";
import {
  DeviceAgentProtocolError,
  DeviceAgentService
} from "../src/devices/device-agent.js";
import {
  DeviceAgentTransportError,
  type DeviceAgentChannelConnection,
  type DeviceAgentChannelEvent,
  type DeviceAgentChannelOpenInput,
  type DeviceAgentTransport
} from "../src/devices/device-agent-transport.js";
import type {
  DeviceRuntimeLifecycleRequestEnvelope,
  DeviceRuntimeLifecycleResultBody
} from "../src/devices/device-runtime-lifecycle-rpc.js";
import {
  createHubIdentity,
  projectHubIdentity
} from "../src/devices/hub-identity.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-channel-loop-"));
const hub = projectHubIdentity(createHubIdentity(path.join(root, "hub"), "2026-08-21T19:10:00.000Z"));
const hubResponse = {
  ok: true,
  hub: {
    schemaVersion: 1,
    hubId: hub.hubId,
    algorithm: "Ed25519",
    publicKey: hub.publicKeySpki,
    publicKeyFingerprint: hub.publicKeyFingerprint,
    createdAt: hub.createdAt
  }
};

async function withTimeout<T>(label: string, promise: Promise<T>, milliseconds = 5_000): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
    close: () => {
      closed = true;
    }
  };
}

function ready(input: DeviceAgentChannelOpenInput, channelId: string): DeviceAgentChannelEvent {
  return {
    type: "channel.ready",
    channelId,
    deviceId: input.deviceId,
    acceptedSequence: input.sequence,
    protocolVersion: input.protocolVersion ?? 1
  };
}

function makeTransport(
  openChannel: (origin: string, input: DeviceAgentChannelOpenInput) => Promise<DeviceAgentChannelConnection>
): DeviceAgentTransport {
  return {
    getHubIdentity: async () => hubResponse,
    proveHubIdentity: async () => ({ ok: true }),
    createEnrollment: async () => ({ ok: true }),
    pollEnrollment: async () => ({ ok: true }),
    heartbeat: async () => ({ ok: true }),
    openChannel
  };
}

function connectedRuntime(name: string): string {
  const runtimeDir = path.join(root, name);
  createDeviceAgentState({
    runtimeDir,
    hubOrigin: "https://hub.example.com",
    displayName: name,
    platform: "darwin",
    architecture: "arm64",
    now: "2026-08-21T19:11:00.000Z"
  });
  completeDeviceAgentEnrollment(
    runtimeDir,
    `cc_device_${name.replace(/[^A-Za-z0-9_-]/g, "_").padEnd(24, "x").slice(0, 24)}`,
    "2026-08-21T19:12:00.000Z"
  );
  return runtimeDir;
}

try {
  const cleanRuntime = connectedRuntime("channel-clean");
  const cleanController = new AbortController();
  let cleanOpen: DeviceAgentChannelOpenInput | null = null;
  const cleanService = new DeviceAgentService({
    runtimeDir: cleanRuntime,
    transport: makeTransport(async (_origin, input) => {
      cleanOpen = input;
      return connection([
        ready(input, "cc_channel_abcdefghijklmnopqrstuvwx"),
        { type: "channel.ping", at: "2026-08-21T19:13:00.000Z" }
      ]);
    })
  });
  const cleanEvents: string[] = [];
  process.stderr.write("CHANNEL_LOOP_STAGE clean\n");
  const cleanResult = await withTimeout("clean channel loop", cleanService.runOutboundChannelLoop({
    signal: cleanController.signal,
    onEvent: (event) => {
      cleanEvents.push(event.type);
      if (event.type === "channel.ping") cleanController.abort();
    }
  }));
  assert.ok(cleanOpen);
  assert.equal(cleanOpen.protocolVersion, 2);
  assert.deepEqual(cleanEvents, ["channel.ready", "channel.ping"]);
  assert.equal(cleanResult.state, "connected");
  assert.equal(cleanResult.hubId, hub.hubId);
  assert.equal(readDeviceAgentState(cleanRuntime)?.nextSequence, 2);

  const workspacePaths = buildFixturePaths(root);
  const workspaceOnlyRuntime = connectedRuntime("channel-workspace-only");
  const workspaceOnlyController = new AbortController();
  let workspaceOnlyOpen: DeviceAgentChannelOpenInput | null = null;
  const workspaceOnlyService = new DeviceAgentService({
    runtimeDir: workspaceOnlyRuntime,
    paths: workspacePaths,
    transport: makeTransport(async (_origin, input) => {
      workspaceOnlyOpen = input;
      return connection([
        ready(input, "cc_channel_workspaceonlyxxxxxxxx"),
        { type: "channel.ping", at: "2026-08-21T19:13:20.000Z" }
      ]);
    })
  });
  process.stderr.write("CHANNEL_LOOP_STAGE workspace-only-v2\n");
  await withTimeout("workspace-only v2 channel loop", workspaceOnlyService.runOutboundChannelLoop({
    signal: workspaceOnlyController.signal,
    onEvent: (event) => {
      if (event.type === "channel.ping") workspaceOnlyController.abort();
    }
  }));
  assert.ok(workspaceOnlyOpen);
  assert.equal(workspaceOnlyOpen.protocolVersion, 2);

  const workspaceRuntime = connectedRuntime("channel-workspace-v4");
  const workspaceController = new AbortController();
  let workspaceOpen: DeviceAgentChannelOpenInput | null = null;
  const workspaceService = new DeviceAgentService({
    runtimeDir: workspaceRuntime,
    paths: workspacePaths,
    runtimeLifecycleService: {
      execute: async (
        request: DeviceRuntimeLifecycleRequestEnvelope
      ): Promise<DeviceRuntimeLifecycleResultBody> => ({
        operationId: request.operationId,
        outcome: "error",
        error: { code: "TEST_UNUSED", message: "Runtime lifecycle request was not expected" }
      })
    },
    transport: makeTransport(async (_origin, input) => {
      workspaceOpen = input;
      return connection([
        ready(input, "cc_channel_workspacev4xxxxxxxxxx"),
        { type: "channel.ping", at: "2026-08-21T19:13:30.000Z" }
      ]);
    })
  });
  process.stderr.write("CHANNEL_LOOP_STAGE workspace-v4\n");
  await withTimeout("workspace v4 channel loop", workspaceService.runOutboundChannelLoop({
    signal: workspaceController.signal,
    onEvent: (event) => {
      if (event.type === "channel.ping") workspaceController.abort();
    }
  }));
  assert.ok(workspaceOpen);
  assert.equal(workspaceOpen.protocolVersion, 4);

  const retryRuntime = connectedRuntime("channel-retry");
  const retryController = new AbortController();
  let openCount = 0;
  const retrySequences: number[] = [];
  const retryDelays: number[] = [];
  const retryService = new DeviceAgentService({
    runtimeDir: retryRuntime,
    random: () => 0.5,
    sleep: async () => undefined,
    transport: makeTransport(async (_origin, input) => {
      openCount += 1;
      retrySequences.push(input.sequence);
      if (openCount === 1) {
        return connection([
          ready(input, "cc_channel_retryfirstxxxxxxxxxx"),
          { type: "channel.close", reason: "server-shutdown" }
        ]);
      }
      return connection([
        ready(input, "cc_channel_retrysecondxxxxxxxxx"),
        { type: "channel.ping", at: "2026-08-21T19:14:00.000Z" }
      ]);
    })
  });
  process.stderr.write("CHANNEL_LOOP_STAGE retry\n");
  await withTimeout("retry channel loop", retryService.runOutboundChannelLoop({
    signal: retryController.signal,
    onRetry: ({ delayMs }) => retryDelays.push(delayMs),
    onEvent: (event) => {
      if (openCount === 2 && event.type === "channel.ping") retryController.abort();
    }
  }));
  assert.deepEqual(retrySequences, [1, 2]);
  assert.equal(retryDelays.length, 1);
  assert.equal(retryDelays[0], 1000);
  assert.equal(readDeviceAgentState(retryRuntime)?.nextSequence, 3);

  const networkRuntime = connectedRuntime("channel-network");
  const networkController = new AbortController();
  let networkOpen = 0;
  const networkSequences: number[] = [];
  const networkService = new DeviceAgentService({
    runtimeDir: networkRuntime,
    random: () => 0.5,
    sleep: async () => undefined,
    transport: makeTransport(async (_origin, input) => {
      networkOpen += 1;
      networkSequences.push(input.sequence);
      if (networkOpen === 1) {
        throw new DeviceAgentTransportError(null, "DEVICE_AGENT_NETWORK_ERROR", "offline");
      }
      return connection([
        ready(input, "cc_channel_networkxxxxxxxxxxxx"),
        { type: "channel.ping", at: "2026-08-21T19:15:00.000Z" }
      ]);
    })
  });
  process.stderr.write("CHANNEL_LOOP_STAGE network\n");
  await withTimeout("network channel loop", networkService.runOutboundChannelLoop({
    signal: networkController.signal,
    onEvent: (event) => {
      if (event.type === "channel.ping") networkController.abort();
    }
  }));
  assert.deepEqual(networkSequences, [1, 2], "failed channel open must not reuse a reserved sequence");

  const supersededRuntime = connectedRuntime("channel-superseded");
  const supersededService = new DeviceAgentService({
    runtimeDir: supersededRuntime,
    transport: makeTransport(async (_origin, input) => connection([
      ready(input, "cc_channel_supersededxxxxxxxxx"),
      { type: "channel.close", reason: "superseded" }
    ]))
  });
  process.stderr.write("CHANNEL_LOOP_STAGE superseded\n");
  await assert.rejects(
    withTimeout("superseded channel loop", supersededService.runOutboundChannelLoop()),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_CHANNEL_SUPERSEDED"
  );

  const revokedRuntime = connectedRuntime("channel-revoked");
  const revokedService = new DeviceAgentService({
    runtimeDir: revokedRuntime,
    transport: makeTransport(async (_origin, input) => connection([
      ready(input, "cc_channel_revokedxxxxxxxxxxxx"),
      { type: "channel.close", reason: "revoked" }
    ]))
  });
  process.stderr.write("CHANNEL_LOOP_STAGE revoked\n");
  await assert.rejects(
    withTimeout("revoked channel loop", revokedService.runOutboundChannelLoop()),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_REVOKED"
  );
  assert.ok(readDeviceAgentState(revokedRuntime)?.revokedAt);

  const invalidReadyRuntime = connectedRuntime("channel-invalid-ready");
  const invalidReadyService = new DeviceAgentService({
    runtimeDir: invalidReadyRuntime,
    transport: makeTransport(async (_origin, input) => connection([{
      ...ready(input, "cc_channel_invalidreadyxxxxxxxx"),
      acceptedSequence: input.sequence + 1
    }]))
  });
  process.stderr.write("CHANNEL_LOOP_STAGE invalid-ready\n");
  await assert.rejects(
    withTimeout("invalid-ready channel loop", invalidReadyService.runOutboundChannelLoop()),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_CHANNEL_INVALID"
  );

  process.stdout.write("VERIFY_DEVICE_AGENT_CHANNEL_LOOP_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
