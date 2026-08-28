import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import { DeviceTargetService } from "../src/application/device-target-service.js";
import { buildDeviceTargetMcpTools } from "../src/mcp/tools/device-targets.js";
import { resolveMcpToolDeviceTarget } from "../src/mcp/device-target-policy.js";
import type {
  ManagedDeviceProjection,
  ManagedDeviceRecord
} from "../src/devices/device-registry.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";

const now = "2026-08-22T01:30:00.000Z";
const allowedRemoteId = `cc_device_${"A".repeat(24)}`;
const blockedRemoteId = `cc_device_${"B".repeat(24)}`;
const pausedRemoteId = `cc_device_${"P".repeat(24)}`;
const revokedRemoteId = `cc_device_${"C".repeat(24)}`;
const missingRemoteId = `cc_device_${"D".repeat(24)}`;
const localAndRemoteGrant = "cc_grant_target_selection_local_remote_123456";
const remoteOnlyGrant = "cc_grant_target_selection_remote_only_123456";

function record(
  id: string,
  displayName: string,
  revokedAt: string | null = null,
  pausedAt: string | null = null
): ManagedDeviceRecord {
  return {
    id,
    displayName,
    platform: "darwin",
    architecture: "arm64",
    publicKeySpki: `private-projection-fixture-${id}`,
    publicKeyFingerprint: `fingerprint-${id}`,
    pairedAt: "2026-08-21T22:00:00.000Z",
    lastSeenAt: "2026-08-22T01:29:30.000Z",
    revokedAt,
    pausedAt,
    executionPolicyRevision: 1,
    lastSequence: 8,
    revision: revokedAt ? 2 : 1
  };
}

class FakeRegistry {
  private readonly records = new Map<string, ManagedDeviceRecord>([
    [allowedRemoteId, record(allowedRemoteId, "Remote Mac")],
    [blockedRemoteId, record(blockedRemoteId, "Build Mac")],
    [pausedRemoteId, record(pausedRemoteId, "Paused Mac", null, "2026-08-22T01:00:00.000Z")],
    [revokedRemoteId, record(revokedRemoteId, "Revoked Mac", "2026-08-22T00:00:00.000Z")]
  ]);

  getDevice(deviceId: string): ManagedDeviceRecord | null {
    const device = this.records.get(deviceId);
    return device ? { ...device } : null;
  }

  listDevices(_at: string): ManagedDeviceProjection[] {
    return [...this.records.values()].map((device) => {
      const revoked = device.revokedAt !== null;
      return {
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
        pausedAt: device.pausedAt,
        executionPolicyRevision: device.executionPolicyRevision,
        revision: device.revision,
        trust: revoked ? "revoked" as const : "paired" as const,
        presence: "offline" as const,
        executionPolicy: device.pausedAt ? "paused" as const : "active" as const,
        management: { heartbeat: true as const, remoteControl: false as const }
      };
    });
  }
}

class FakeChannels {
  isActive(deviceId: string): boolean {
    return deviceId === allowedRemoteId || deviceId === pausedRemoteId;
  }

  isCapabilityRpcAvailable(deviceId: string): boolean {
    return deviceId === allowedRemoteId || deviceId === pausedRemoteId;
  }
}

class FakeAccessPolicy {
  allowsDevice(grantId: string, deviceId: string): boolean {
    if (grantId === localAndRemoteGrant) {
      return deviceId === LOCAL_DEVICE_TARGET_ID || deviceId === allowedRemoteId;
    }
    if (grantId === remoteOnlyGrant) {
      return deviceId === allowedRemoteId;
    }
    return false;
  }
}

const service = new DeviceTargetService(
  new FakeRegistry(),
  new FakeChannels(),
  new FakeAccessPolicy()
);

const local = service.resolve(LOCAL_DEVICE_TARGET_ID, now);
assert.equal(local.id, LOCAL_DEVICE_TARGET_ID);
assert.equal(local.locality, "local");
assert.equal(local.displayName, "This device");
assert.equal(local.presence, "online");
assert.equal(local.executionAvailable, true);

const remote = service.resolve(allowedRemoteId, now);
assert.equal(remote.id, allowedRemoteId);
assert.equal(remote.displayName, "Remote Mac");
assert.equal(remote.presence, "online", "active channel should upgrade bounded presence");
assert.equal(remote.executionPolicy, "active");
assert.equal(remote.executionAvailable, true);
assert.equal("publicKeyFingerprint" in remote, false);
assert.equal("publicKeySpki" in remote, false);
assert.equal("address" in remote, false);
assert.equal("route" in remote, false);

const paused = service.resolve(pausedRemoteId, now);
assert.equal(paused.presence, "online", "Pause must not hide an active management channel");
assert.equal(paused.executionPolicy, "paused");
assert.equal(paused.executionAvailable, false, "paused target must not advertise AI execution readiness");
assert.throws(
  () => service.resolveForExecution(pausedRemoteId, now),
  (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_EXECUTION_PAUSED",
  "paused target must fail before remote transport"
);

assert.throws(
  () => service.resolve(missingRemoteId, now),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "DEVICE_TARGET_NOT_FOUND"
);
assert.throws(
  () => service.resolve(revokedRemoteId, now),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "DEVICE_TARGET_REVOKED"
);
assert.throws(
  () => service.resolve("not-a-device", now),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "DEVICE_ID_INVALID"
);

const visible = service.listTargets(localAndRemoteGrant, now);
assert.deepEqual(
  visible.map((target) => target.id),
  [LOCAL_DEVICE_TARGET_ID, allowedRemoteId],
  "OAuth target projection must exclude unauthorized and revoked devices"
);
assert.equal(visible[1]?.executionAvailable, true);

const remoteOnly = service.listTargets(remoteOnlyGrant, now);
assert.deepEqual(remoteOnly.map((target) => target.id), [allowedRemoteId]);
assert.equal(
  remoteOnly.some((target) => target.id === LOCAL_DEVICE_TARGET_ID),
  false,
  "remote-only grant must not regain local-device visibility"
);

const unrestricted = service.listTargets(null, now);
assert.deepEqual(
  unrestricted.map((target) => target.id),
  [LOCAL_DEVICE_TARGET_ID, allowedRemoteId, blockedRemoteId, pausedRemoteId],
  "non-OAuth local callers may inspect all non-revoked public-safe targets"
);
assert.equal(unrestricted.find((target) => target.id === blockedRemoteId)?.presence, "offline");
assert.equal(unrestricted.find((target) => target.id === pausedRemoteId)?.executionPolicy, "paused");
assert.equal(unrestricted.find((target) => target.id === pausedRemoteId)?.executionAvailable, false);

const failClosedService = new DeviceTargetService(
  new FakeRegistry(),
  new FakeChannels(),
  null
);
assert.throws(
  () => failClosedService.listTargets(localAndRemoteGrant, now),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "DEVICE_ACCESS_POLICY_UNAVAILABLE",
  "OAuth target discovery must fail closed when the grant policy is unavailable"
);

const localContext = buildOperationContext({
  requestId: "target-local-context",
  actorType: "local-ui"
});
assert.equal(localContext.authorizationGrantId, null);
const oauthContext = buildOperationContext({
  requestId: "target-oauth-context",
  actorType: "remote-mcp",
  actorId: localAndRemoteGrant,
  authorizationGrantId: localAndRemoteGrant,
  publicProjection: true,
  now
});
assert.equal(oauthContext.authorizationGrantId, localAndRemoteGrant);

const [listTool] = buildDeviceTargetMcpTools(service);
assert.ok(listTool);
assert.equal(listTool.name, "chatcockpit.devices.targets.list");
const toolResult = await listTool.execute(oauthContext, {});
assert.equal(toolResult.isError, undefined);
const projectedTargets = toolResult.structuredContent.targets as Array<Record<string, unknown>>;
assert.deepEqual(projectedTargets.map((target) => target.id), [LOCAL_DEVICE_TARGET_ID, allowedRemoteId]);
const projectionJson = JSON.stringify(toolResult.structuredContent);
for (const privateMarker of [
  "private-projection-fixture",
  "fingerprint-",
  "publicKey",
  "secureOrigin",
  "address",
  "route"
]) {
  assert.equal(projectionJson.includes(privateMarker), false, `projection leaked ${privateMarker}`);
}

assert.equal(
  resolveMcpToolDeviceTarget("chatcockpit.devices.targets.list", {}),
  null,
  "target discovery is control-plane metadata and must not require local-device authority"
);
assert.equal(
  resolveMcpToolDeviceTarget("chatcockpit.project.list", {}),
  LOCAL_DEVICE_TARGET_ID,
  "unmigrated tools must preserve Phase 7 local-device guard semantics"
);
assert.equal(
  resolveMcpToolDeviceTarget("chatcockpit.capabilities.read.invoke", {
    executorId: "fixture",
    toolName: "read",
    arguments: {}
  }),
  LOCAL_DEVICE_TARGET_ID,
  "Capability Router keeps local-device as the compatibility default"
);
assert.equal(
  resolveMcpToolDeviceTarget("chatcockpit.capabilities.read.invoke", {
    targetDevice: allowedRemoteId,
    executorId: "fixture",
    toolName: "read",
    arguments: {}
  }),
  allowedRemoteId,
  "Capability Router must authorize the explicit remote device target"
);
assert.equal(
  resolveMcpToolDeviceTarget("chatcockpit.capabilities.mutation.prepare", {
    targetDevice: allowedRemoteId
  }),
  LOCAL_DEVICE_TARGET_ID,
  "Capability Router mutations remain local-device governed in Phase 8"
);
assert.equal(
  resolveMcpToolDeviceTarget("chatcockpit.tools.invoke", {
    tool: "capabilities.read.invoke",
    input: {
      targetDevice: allowedRemoteId,
      executorId: "fixture",
      toolName: "read",
      arguments: {}
    }
  }),
  allowedRemoteId,
  "Deferred-tool invocation must preserve the nested specialist's explicit remote target"
);
assert.equal(
  resolveMcpToolDeviceTarget("chatcockpit.tools.invoke", {
    tool: "devices.runtime.status",
    input: { deviceId: allowedRemoteId }
  }),
  allowedRemoteId,
  "Deferred device-runtime invocation must authorize the nested deviceId"
);
assert.equal(
  resolveMcpToolDeviceTarget("tokenpilot.tools.invoke", {
    tool: "evidence.record",
    input: {}
  }),
  LOCAL_DEVICE_TARGET_ID,
  "Compatibility product prefixes must retain local-device authorization semantics"
);

process.stdout.write("VERIFY_DEVICE_TARGET_SELECTION_OK\n");
