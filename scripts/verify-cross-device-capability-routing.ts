import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import { DeviceTargetService } from "../src/application/device-target-service.js";
import { TargetedCapabilityRouterService } from "../src/application/targeted-capability-router-service.js";
import {
  capabilityRouterInspectSchema,
  capabilityRouterListSchema,
  capabilityRouterMutationPrepareSchema,
  capabilityRouterReadInvokeSchema
} from "../src/contracts/capability-router.js";
import { DeviceCapabilityRpc } from "../src/devices/device-capability-rpc.js";
import { DeviceChannelHub } from "../src/devices/device-channel.js";
import type {
  ManagedDeviceProjection,
  ManagedDeviceRecord
} from "../src/devices/device-registry.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";
import { resolveMcpToolDeviceTarget } from "../src/mcp/device-target-policy.js";

const now = "2026-08-22T02:20:00.000Z";
const remoteId = `cc_device_${"R".repeat(24)}`;
const unavailableId = `cc_device_${"U".repeat(24)}`;
const revokedId = `cc_device_${"V".repeat(24)}`;
const missingId = `cc_device_${"M".repeat(24)}`;

function record(id: string, displayName: string, revokedAt: string | null = null): ManagedDeviceRecord {
  return {
    id,
    displayName,
    platform: "darwin",
    architecture: "arm64",
    publicKeySpki: `private-${id}`,
    publicKeyFingerprint: `fingerprint-${id}`,
    pairedAt: "2026-08-21T22:00:00.000Z",
    lastSeenAt: "2026-08-22T02:19:55.000Z",
    revokedAt,
    lastSequence: 9,
    revision: revokedAt ? 2 : 1
  };
}

class FakeRegistry {
  private readonly records = new Map<string, ManagedDeviceRecord>([
    [remoteId, record(remoteId, "Remote Read Mac")],
    [unavailableId, record(unavailableId, "Offline Mac")],
    [revokedId, record(revokedId, "Revoked Mac", "2026-08-22T02:00:00.000Z")]
  ]);

  getDevice(deviceId: string): ManagedDeviceRecord | null {
    const found = this.records.get(deviceId);
    return found ? { ...found } : null;
  }

  listDevices(_at: string): ManagedDeviceProjection[] {
    return [...this.records.values()].map((device) => ({
      id: device.id,
      kind: "device" as const,
      locality: "remote" as const,
      displayName: device.displayName,
      platform: device.platform,
      architecture: device.architecture,
      publicKeyFingerprint: device.publicKeyFingerprint,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt,
      revokedAt: device.revokedAt,
      revision: device.revision,
      trust: device.revokedAt ? "revoked" as const : "paired" as const,
      presence: device.revokedAt
        ? "revoked" as const
        : device.id === remoteId
          ? "online" as const
          : "offline" as const,
      management: { heartbeat: true as const, remoteControl: false as const }
    }));
  }
}

const channels = new DeviceChannelHub();
const targets = new DeviceTargetService(
  new FakeRegistry(),
  { isActive: (deviceId) => deviceId === remoteId },
  null
);
const rpc = new DeviceCapabilityRpc(channels, {
  requestTimeoutMs: 1000,
  now: () => now
});

let localListCalls = 0;
let localInspectCalls = 0;
let localReadCalls = 0;
const localCatalog = {
  list(input: { executorId?: string }) {
    localListCalls += 1;
    return {
      target: {
        id: LOCAL_DEVICE_TARGET_ID,
        kind: "device",
        locality: "local",
        platform: "darwin",
        architecture: "arm64"
      },
      providers: [{ executorId: input.executorId ?? "local-provider" }]
    };
  },
  inspect(input: { executorId: string; toolName: string }) {
    localInspectCalls += 1;
    return { ...input, mode: "read", status: "ready" };
  }
};
const localReads = {
  async invoke(input: { executorId: string; toolName: string; arguments: Record<string, unknown> }) {
    localReadCalls += 1;
    return { ...input, text: "local text", structuredContent: null };
  }
};

let registration: ReturnType<DeviceChannelHub["register"]>;
const dispatched: Array<{ operation: string; payload: unknown }> = [];
registration = channels.register(remoteId, () => undefined, {
  protocolVersion: 2,
  send: (_event, raw) => {
    const envelope = raw as {
      requestId: string;
      operation: string;
      payload: unknown;
    };
    dispatched.push({ operation: envelope.operation, payload: structuredClone(envelope.payload) });
    const results: Record<string, unknown> = {
      "capabilities.list": {
        target: { id: LOCAL_DEVICE_TARGET_ID, kind: "device", locality: "local" },
        providers: [{ executorId: "remote-provider", tools: [] }]
      },
      "capabilities.inspect": {
        executorId: "remote-provider",
        toolName: "read_file",
        mode: "read",
        status: "ready"
      },
      "capabilities.read.invoke": {
        executorId: "remote-provider",
        toolName: "read_file",
        text: "remote text",
        structuredContent: { count: 1 },
        isError: false,
        truncated: false,
        omittedContentBlocks: 0
      }
    };
    queueMicrotask(() => {
      rpc.acceptResult({
        deviceId: remoteId,
        channelId: registration.channelId,
        body: {
          requestId: envelope.requestId,
          outcome: "ok",
          result: results[envelope.operation]
        }
      });
    });
    return true;
  }
});

const service = new TargetedCapabilityRouterService(
  localCatalog as never,
  localReads as never,
  targets,
  rpc
);
const context = buildOperationContext({
  requestId: "cross-device-routing",
  actorType: "remote-mcp",
  authorizationGrantId: "cc_grant_cross_device_routing_123456",
  publicProjection: true,
  now
});

try {
  const localList = await service.list(context, { executorId: "local-provider" });
  assert.deepEqual(localList, {
    target: {
      id: LOCAL_DEVICE_TARGET_ID,
      kind: "device",
      locality: "local",
      platform: "darwin",
      architecture: "arm64"
    },
    providers: [{ executorId: "local-provider" }]
  });
  assert.equal(localListCalls, 1);
  assert.equal(dispatched.length, 0);

  const localInspect = await service.inspect(context, {
    executorId: "local-provider",
    toolName: "read_file"
  });
  assert.deepEqual(localInspect, {
    executorId: "local-provider",
    toolName: "read_file",
    mode: "read",
    status: "ready"
  });
  const localRead = await service.invokeRead(context, {
    executorId: "local-provider",
    toolName: "read_file",
    arguments: { path: "README.md" }
  });
  assert.equal((localRead as { text?: string }).text, "local text");
  assert.equal(localInspectCalls, 1);
  assert.equal(localReadCalls, 1);

  const explicitLocal = await service.inspect(context, {
    targetDevice: LOCAL_DEVICE_TARGET_ID,
    executorId: "local-provider",
    toolName: "read_file"
  }) as Record<string, unknown>;
  assert.equal((explicitLocal.target as { id?: string }).id, LOCAL_DEVICE_TARGET_ID);

  const remoteList = await service.list(context, {
    targetDevice: remoteId,
    executorId: "remote-provider"
  }) as Record<string, unknown>;
  assert.equal((remoteList.target as { id?: string }).id, remoteId);
  assert.equal((remoteList.target as { displayName?: string }).displayName, "Remote Read Mac");
  assert.equal(JSON.stringify(remoteList).includes("local-device"), false);

  const remoteInspect = await service.inspect(context, {
    targetDevice: remoteId,
    executorId: "remote-provider",
    toolName: "read_file"
  }) as Record<string, unknown>;
  assert.equal((remoteInspect.target as { id?: string }).id, remoteId);
  assert.equal(remoteInspect.toolName, "read_file");

  const remoteRead = await service.invokeRead(context, {
    targetDevice: remoteId,
    executorId: "remote-provider",
    toolName: "read_file",
    arguments: { path: "README.md" }
  }) as Record<string, unknown>;
  assert.equal((remoteRead.target as { id?: string }).id, remoteId);
  assert.equal(remoteRead.text, "remote text");

  assert.deepEqual(
    dispatched.map((entry) => entry.operation),
    ["capabilities.list", "capabilities.inspect", "capabilities.read.invoke"]
  );
  for (const entry of dispatched) {
    assert.equal(
      Boolean(entry.payload && typeof entry.payload === "object" && "targetDevice" in (entry.payload as object)),
      false,
      "Hub target selection must not be forwarded into the target Agent payload"
    );
  }

  await assert.rejects(
    service.list(context, { targetDevice: unavailableId }),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_TARGET_UNAVAILABLE"
  );
  await assert.rejects(
    service.list(context, { targetDevice: revokedId }),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_TARGET_REVOKED"
  );
  await assert.rejects(
    service.list(context, { targetDevice: missingId }),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_TARGET_NOT_FOUND"
  );

  assert.equal(capabilityRouterListSchema.safeParse({ targetDevice: remoteId }).success, true);
  assert.equal(
    capabilityRouterInspectSchema.safeParse({
      targetDevice: remoteId,
      executorId: "remote-provider",
      toolName: "read_file"
    }).success,
    true
  );
  assert.equal(
    capabilityRouterReadInvokeSchema.safeParse({
      targetDevice: remoteId,
      executorId: "remote-provider",
      toolName: "read_file",
      arguments: {}
    }).success,
    true
  );
  assert.equal(
    capabilityRouterReadInvokeSchema.safeParse({
      targetDevice: "Remote Read Mac",
      executorId: "remote-provider",
      toolName: "read_file",
      arguments: {}
    }).success,
    false,
    "display-name routing must remain unsupported"
  );
  assert.equal(
    capabilityRouterMutationPrepareSchema.safeParse({
      targetDevice: remoteId,
      idempotencyKey: "mutation-123",
      executorId: "remote-provider",
      toolName: "write_file",
      arguments: {}
    }).success,
    false,
    "mutation schemas must stay local-device only in Phase 8"
  );

  assert.equal(
    resolveMcpToolDeviceTarget("chatcockpit.capabilities.list", { targetDevice: remoteId }),
    remoteId
  );
  assert.equal(
    resolveMcpToolDeviceTarget("chatcockpit.capabilities.inspect", { targetDevice: remoteId }),
    remoteId
  );
  assert.equal(
    resolveMcpToolDeviceTarget("chatcockpit.capabilities.read.invoke", { targetDevice: remoteId }),
    remoteId
  );
  assert.equal(
    resolveMcpToolDeviceTarget("chatcockpit.capabilities.read.invoke", {}),
    LOCAL_DEVICE_TARGET_ID
  );
  assert.equal(
    resolveMcpToolDeviceTarget("chatcockpit.capabilities.mutation.prepare", { targetDevice: remoteId }),
    LOCAL_DEVICE_TARGET_ID
  );

  process.stdout.write("VERIFY_CROSS_DEVICE_CAPABILITY_ROUTING_OK\n");
} finally {
  registration.dispose();
  rpc.close();
  channels.closeAll();
}
