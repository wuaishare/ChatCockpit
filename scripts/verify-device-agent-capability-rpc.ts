import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CapabilityRouterCatalogService } from "../src/application/capability-router-catalog-service.js";
import { CapabilityRouterReadInvocationService } from "../src/application/capability-router-read-invocation-service.js";
import { DeviceAgentCapabilityService } from "../src/devices/device-agent-capability-service.js";
import {
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";
import { DeviceAgentService } from "../src/devices/device-agent.js";
import {
  DeviceAgentTransportError,
  type DeviceAgentChannelConnection,
  type DeviceAgentChannelEvent,
  type DeviceAgentChannelOpenInput,
  type DeviceAgentChannelResultInput,
  type DeviceAgentTransport
} from "../src/devices/device-agent-transport.js";
import type { DeviceCapabilityRequestEnvelope } from "../src/devices/device-capability-rpc.js";
import { buildDeviceChannelResultProof } from "../src/devices/device-registry.js";
import { createHubIdentity, projectHubIdentity } from "../src/devices/hub-identity.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";
import type {
  DownstreamMcpCapabilitySnapshot,
  DownstreamMcpClient
} from "../src/direct/downstream-mcp-types.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-capability-"));
const runtimeDir = path.join(root, "runtime");
const configPath = path.join(root, "direct-executors.json");
const executorId = "downstream-mcp:remote-read-fixture";
const now = "2026-08-22T02:00:00.000Z";

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      executors: [
        {
          id: executorId,
          displayName: "Remote Read Fixture",
          transport: {
            kind: "streamable-http",
            url: "https://private-provider.example.invalid/mcp",
            timeoutMs: 1000
          },
          mappings: [
            {
              capability: "files.read",
              toolName: "read_fixture",
              scopes: ["host"],
              access: ["read"]
            }
          ],
          router: {
            enabled: true,
            tools: [
              { toolName: "read_fixture", mode: "read" },
              { toolName: "write_fixture", mode: "mutation" }
            ]
          }
        }
      ]
    },
    null,
    2
  )}\n`,
  "utf8"
);

const inputSchema = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
  additionalProperties: false
};
const readAnnotations = { readOnlyHint: true, destructiveHint: false };
const snapshot: DownstreamMcpCapabilitySnapshot = {
  schemaVersion: 1,
  executorId,
  displayName: "Remote Read Fixture",
  protocolFamily: "mcp-streamable-http",
  protocolVersion: "2025-03-26",
  serverName: "remote-read-server",
  serverVersion: "1.0.0",
  probedAt: now,
  health: "ready",
  toolsObserved: ["read_fixture", "write_fixture"],
  toolCatalog: [
    {
      name: "read_fixture",
      description: "Read a fixture",
      inputSchema,
      outputSchema: null,
      annotations: readAnnotations,
      metadataStatus: "ready"
    },
    {
      name: "write_fixture",
      description: "Write a fixture",
      inputSchema: { type: "object" },
      outputSchema: null,
      annotations: { destructiveHint: true },
      metadataStatus: "ready"
    }
  ],
  mappings: [
    {
      capability: "files.read",
      toolName: "read_fixture",
      scopes: ["host"],
      access: ["read"],
      status: "verified",
      errorCode: null
    }
  ]
};
new DownstreamMcpCapabilityStore(runtimeDir).write(snapshot);

let calls = 0;
let drift = false;
const client: DownstreamMcpClient = {
  async initialize() {
    return {
      name: "remote-read-server",
      version: "1.0.0",
      protocolVersion: "2025-03-26"
    };
  },
  async listTools() {
    return {
      server: await this.initialize(),
      tools: [
        {
          name: "read_fixture",
          description: "Read a fixture",
          inputSchema: drift ? { type: "object" } : inputSchema,
          annotations: readAnnotations
        },
        {
          name: "write_fixture",
          description: "Write a fixture",
          inputSchema: { type: "object" },
          annotations: { destructiveHint: true }
        }
      ]
    };
  },
  async callTool(name, args) {
    calls += 1;
    assert.equal(name, "read_fixture");
    assert.deepEqual(args, { path: "README.md" });
    return {
      content: [{ type: "text", text: "remote fixture text" }],
      structuredContent: { count: 1 },
      isError: false
    };
  },
  async close() {}
};

function request(
  operation: DeviceCapabilityRequestEnvelope["operation"],
  payload: unknown,
  overrides: Partial<DeviceCapabilityRequestEnvelope> = {}
): DeviceCapabilityRequestEnvelope {
  return {
    protocolVersion: 1,
    requestId: "cc_device_request_abcdefghijklmnopqrstuvwx",
    operation,
    issuedAt: "2026-08-22T01:59:59.000Z",
    expiresAt: "2026-08-22T02:00:30.000Z",
    payload,
    ...overrides
  };
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

function ready(
  input: DeviceAgentChannelOpenInput,
  channelId: string
): Extract<DeviceAgentChannelEvent, { type: "channel.ready" }> {
  return {
    type: "channel.ready",
    channelId,
    deviceId: input.deviceId,
    acceptedSequence: input.sequence,
    protocolVersion: input.protocolVersion ?? 1
  };
}

function capabilityEvent(
  requestId: string
): Extract<DeviceAgentChannelEvent, { type: "capability.request" }> {
  return {
    type: "capability.request",
    protocolVersion: 1,
    requestId,
    operation: "capabilities.read.invoke",
    issuedAt: "2026-08-22T01:59:59.000Z",
    expiresAt: "2026-08-22T02:00:30.000Z",
    payload: {
      executorId,
      toolName: "read_fixture",
      arguments: { path: "README.md" }
    }
  };
}

function connectedAgentRuntime(name: string): { runtimeDir: string; deviceId: string } {
  const agentRuntime = path.join(root, name);
  createDeviceAgentState({
    runtimeDir: agentRuntime,
    hubOrigin: "https://hub.example.com",
    displayName: name,
    platform: "darwin",
    architecture: "arm64",
    now
  });
  const deviceId = `cc_device_${name.replace(/[^A-Za-z0-9_-]/g, "_").padEnd(24, "x").slice(0, 24)}`;
  completeDeviceAgentEnrollment(agentRuntime, deviceId, now);
  return { runtimeDir: agentRuntime, deviceId };
}

function verifySubmittedResultSignature(
  runtimeDir: string,
  input: DeviceAgentChannelResultInput
): void {
  const state = readDeviceAgentState(runtimeDir);
  assert.ok(state);
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(state.publicKeySpki, "base64url"),
    format: "der",
    type: "spki"
  });
  assert.equal(
    crypto.verify(
      null,
      buildDeviceChannelResultProof(
        input.deviceId,
        input.channelId,
        input.sequence,
        input.body
      ),
      publicKey,
      Buffer.from(input.signature, "base64url")
    ),
    true,
    "Agent must sign capability results with its enrolled device identity"
  );
}

try {
  const catalog = new CapabilityRouterCatalogService(runtimeDir, configPath);
  const reads = new CapabilityRouterReadInvocationService(
    runtimeDir,
    configPath,
    () => client
  );
  const service = new DeviceAgentCapabilityService({
    runtimeDir,
    configPath,
    catalog,
    reads,
    now: () => now
  });

  const listed = await service.execute(request("capabilities.list", {}));
  assert.equal(listed.outcome, "ok");
  if (listed.outcome === "ok") {
    const result = listed.result as {
      providers: Array<{ tools: Array<{ toolName: string; mode: string }> }>;
    };
    assert.deepEqual(
      result.providers.flatMap((provider) => provider.tools.map((tool) => tool.toolName)),
      ["read_fixture"],
      "remote catalog must not advertise mutation exposures"
    );
  }

  const inspected = await service.execute(
    request("capabilities.inspect", { executorId, toolName: "read_fixture" })
  );
  assert.equal(inspected.outcome, "ok");
  if (inspected.outcome === "ok") {
    assert.equal((inspected.result as { toolName?: string }).toolName, "read_fixture");
  }

  const mutationInspect = await service.execute(
    request("capabilities.inspect", { executorId, toolName: "write_fixture" })
  );
  assert.deepEqual(mutationInspect, {
    requestId: "cc_device_request_abcdefghijklmnopqrstuvwx",
    outcome: "error",
    error: {
      code: "DEVICE_CAPABILITY_MUTATION_UNAVAILABLE",
      message: "Remote device capability mutations are unavailable"
    }
  });

  const invalidArguments = await service.execute(
    request("capabilities.read.invoke", {
      executorId,
      toolName: "read_fixture",
      arguments: { path: 42 }
    })
  );
  assert.equal(invalidArguments.outcome, "error");
  if (invalidArguments.outcome === "error") {
    assert.equal(invalidArguments.error.code, "CAPABILITY_ROUTER_ARGUMENTS_INVALID");
  }
  assert.equal(calls, 0);

  const mutationInvoke = await service.execute(
    request("capabilities.read.invoke", {
      executorId,
      toolName: "write_fixture",
      arguments: {}
    })
  );
  assert.equal(mutationInvoke.outcome, "error");
  if (mutationInvoke.outcome === "error") {
    assert.equal(mutationInvoke.error.code, "DEVICE_CAPABILITY_MUTATION_UNAVAILABLE");
  }
  assert.equal(calls, 0);

  const invoked = await service.execute(
    request("capabilities.read.invoke", {
      executorId,
      toolName: "read_fixture",
      arguments: { path: "README.md" }
    })
  );
  assert.equal(invoked.outcome, "ok");
  if (invoked.outcome === "ok") {
    const result = invoked.result as {
      text?: string;
      structuredContent?: Record<string, unknown> | null;
      omittedContentBlocks?: number;
    };
    assert.equal(result.text, "remote fixture text");
    assert.deepEqual(result.structuredContent, { count: 1 });
    assert.equal(result.omittedContentBlocks, 0);
  }
  assert.equal(calls, 1);

  drift = true;
  const drifted = await service.execute(
    request("capabilities.read.invoke", {
      executorId,
      toolName: "read_fixture",
      arguments: { path: "README.md" }
    })
  );
  assert.equal(drifted.outcome, "error");
  if (drifted.outcome === "error") {
    assert.equal(drifted.error.code, "CAPABILITY_ROUTER_PROVIDER_METADATA_CHANGED");
  }
  assert.equal(calls, 1, "metadata drift must fail before provider execution");
  drift = false;

  const expired = await service.execute(
    request("capabilities.list", {}, { expiresAt: "2026-08-22T01:59:59.999Z" })
  );
  assert.equal(expired.outcome, "error");
  if (expired.outcome === "error") {
    assert.equal(expired.error.code, "DEVICE_CAPABILITY_REQUEST_EXPIRED");
  }

  const invalidEnvelope = await service.execute(
    request("capabilities.list", {}, {
      protocolVersion: 2 as never,
      issuedAt: "not-a-time"
    })
  );
  assert.equal(invalidEnvelope.outcome, "error");
  if (invalidEnvelope.outcome === "error") {
    assert.equal(invalidEnvelope.error.code, "DEVICE_CAPABILITY_REQUEST_INVALID");
  }

  const invalidPayload = await service.execute(
    request("capabilities.inspect", { executorId, toolName: "read_fixture", mutation: true })
  );
  assert.equal(invalidPayload.outcome, "error");
  if (invalidPayload.outcome === "error") {
    assert.equal(invalidPayload.error.code, "DEVICE_CAPABILITY_ARGUMENTS_INVALID");
  }

  const projection = JSON.stringify({ listed, inspected, invoked, drifted });
  for (const marker of [
    "private-provider.example.invalid",
    configPath,
    "stack",
    "transport"
  ]) {
    assert.equal(projection.includes(marker), false, `remote capability result leaked ${marker}`);
  }

  const hub = projectHubIdentity(
    createHubIdentity(path.join(root, "channel-hub"), "2026-08-22T01:58:00.000Z")
  );
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

  const successAgent = connectedAgentRuntime("agent-capability-success");
  const successController = new AbortController();
  const successChannelId = "cc_channel_agentcapabilitysuccess";
  let successSubmitted: DeviceAgentChannelResultInput | null = null;
  const successTransport: DeviceAgentTransport = {
    getHubIdentity: async () => hubResponse,
    proveHubIdentity: async () => ({ ok: true }),
    getLanTlsIdentity: async () => ({ ok: true }),
    proveLanTlsIdentity: async () => ({ ok: true }),
    createEnrollment: async () => ({ ok: true }),
    pollEnrollment: async () => ({ ok: true }),
    heartbeat: async () => ({ ok: true }),
    openChannel: async (_origin, input) => {
      assert.equal(input.protocolVersion, 2);
      return connection([
        ready(input, successChannelId),
        capabilityEvent("cc_device_request_agentcapabilitysuccess")
      ]);
    },
    submitChannelResult: async (_origin, input) => {
      verifySubmittedResultSignature(successAgent.runtimeDir, input);
      successSubmitted = structuredClone(input);
      return { ok: true, acceptedSequence: input.sequence };
    }
  };
  const callsBeforeSuccessLoop = calls;
  const successDiagnosticEvents: string[] = [];
  const successLoopService = new DeviceAgentService({
    runtimeDir: successAgent.runtimeDir,
    transport: successTransport,
    capabilityService: service,
    now: () => now,
    sleep: async () => undefined
  });
  await successLoopService.runOutboundChannelLoop({
    signal: successController.signal,
    onEvent: (event) => {
      successDiagnosticEvents.push(event.type);
      if (event.type === "capability.request") {
        assert.ok(successSubmitted, "diagnostic hook must run only after result submission succeeds");
        successController.abort();
      }
    }
  });
  assert.equal(calls, callsBeforeSuccessLoop + 1);
  assert.ok(successSubmitted);
  assert.equal(successSubmitted.channelId, successChannelId);
  assert.equal(successSubmitted.body.outcome, "ok");
  assert.deepEqual(successDiagnosticEvents, ["channel.ready", "capability.request"]);

  const retryAgent = connectedAgentRuntime("agent-capability-no-replay");
  const retryController = new AbortController();
  let retryOpenCount = 0;
  let retrySubmitCount = 0;
  const retryChannelIds = [
    "cc_channel_agentcapabilityretryone",
    "cc_channel_agentcapabilityretrytwo"
  ] as const;
  const retryTransport: DeviceAgentTransport = {
    getHubIdentity: async () => hubResponse,
    proveHubIdentity: async () => ({ ok: true }),
    getLanTlsIdentity: async () => ({ ok: true }),
    proveLanTlsIdentity: async () => ({ ok: true }),
    createEnrollment: async () => ({ ok: true }),
    pollEnrollment: async () => ({ ok: true }),
    heartbeat: async () => ({ ok: true }),
    openChannel: async (_origin, input) => {
      const channelId = retryChannelIds[Math.min(retryOpenCount, retryChannelIds.length - 1)]!;
      retryOpenCount += 1;
      if (retryOpenCount === 1) {
        return connection([
          ready(input, channelId),
          capabilityEvent("cc_device_request_agentcapabilitynoreplay")
        ]);
      }
      return connection([
        ready(input, channelId),
        { type: "channel.ping", at: now }
      ]);
    },
    submitChannelResult: async (_origin, input) => {
      retrySubmitCount += 1;
      verifySubmittedResultSignature(retryAgent.runtimeDir, input);
      throw new DeviceAgentTransportError(
        null,
        "DEVICE_AGENT_NETWORK_ERROR",
        "fixture result upload failed"
      );
    }
  };
  const callsBeforeRetryLoop = calls;
  const retryDiagnostics: string[] = [];
  const retryLoopService = new DeviceAgentService({
    runtimeDir: retryAgent.runtimeDir,
    transport: retryTransport,
    capabilityService: service,
    now: () => now,
    random: () => 0.5,
    sleep: async () => undefined
  });
  await retryLoopService.runOutboundChannelLoop({
    signal: retryController.signal,
    onEvent: (event) => {
      retryDiagnostics.push(event.type);
      if (event.type === "channel.ping") retryController.abort();
    }
  });
  assert.equal(retryOpenCount, 2, "result upload failure should reconnect the channel");
  assert.equal(retrySubmitCount, 1);
  assert.equal(
    calls,
    callsBeforeRetryLoop + 1,
    "provider execution must not be replayed after result upload failure"
  );
  assert.deepEqual(
    retryDiagnostics,
    ["channel.ready", "channel.ready", "channel.ping"],
    "failed result submission must not expose a completed capability event to diagnostic hooks"
  );

  process.stdout.write("VERIFY_DEVICE_AGENT_CAPABILITY_RPC_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
