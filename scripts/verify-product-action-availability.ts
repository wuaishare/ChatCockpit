import assert from "node:assert/strict";

import { DeviceTargetService } from "../src/application/device-target-service.js";
import {
  PRODUCT_ACTION_IDS,
  ProductActionAvailabilityService
} from "../src/application/product-action-availability-service.js";
import type {
  ManagedDeviceProjection,
  ManagedDeviceRecord
} from "../src/devices/device-registry.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";

const now = "2026-09-01T10:00:00.000Z";
const capableId = `cc_device_${"A".repeat(24)}`;
const readOnlyId = `cc_device_${"B".repeat(24)}`;
const offlineId = `cc_device_${"C".repeat(24)}`;
const pausedId = `cc_device_${"D".repeat(24)}`;

function record(id: string, displayName: string, pausedAt: string | null = null): ManagedDeviceRecord {
  return {
    id,
    displayName,
    platform: "darwin",
    architecture: "arm64",
    publicKeySpki: `private-${id}`,
    publicKeyFingerprint: `fingerprint-${id}`,
    pairedAt: now,
    lastSeenAt: now,
    revokedAt: null,
    pausedAt,
    executionPolicyRevision: 1,
    lastSequence: 1,
    revision: 1
  };
}

class FakeRegistry {
  private readonly records = new Map<string, ManagedDeviceRecord>([
    [capableId, record(capableId, "Capable Mac")],
    [readOnlyId, record(readOnlyId, "Read-only Mac")],
    [offlineId, record(offlineId, "Offline Mac")],
    [pausedId, record(pausedId, "Paused Mac", now)]
  ]);

  getDevice(deviceId: string): ManagedDeviceRecord | null {
    const value = this.records.get(deviceId);
    return value ? { ...value } : null;
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
      revokedAt: null,
      pausedAt: device.pausedAt,
      executionPolicyRevision: device.executionPolicyRevision,
      revision: device.revision,
      trust: "paired" as const,
      presence: device.id === offlineId ? "offline" as const : "online" as const,
      executionPolicy: device.pausedAt ? "paused" as const : "active" as const,
      management: {
        heartbeat: true as const,
        remoteControl: false as const
      }
    }));
  }
}

class FakeChannels {
  isActive(deviceId: string): boolean {
    return deviceId !== offlineId;
  }

  isCapabilityRpcAvailable(deviceId: string): boolean {
    return deviceId === capableId || deviceId === readOnlyId || deviceId === pausedId;
  }

  isRuntimeLifecycleRpcAvailable(deviceId: string): boolean {
    return deviceId === capableId || deviceId === pausedId;
  }
}

const channels = new FakeChannels();
const targets = new DeviceTargetService(new FakeRegistry(), channels, null);
const service = new ProductActionAvailabilityService(targets, channels);

function target(
  projection: ReturnType<ProductActionAvailabilityService["list"]>,
  actionId: (typeof PRODUCT_ACTION_IDS)[number],
  deviceId: string
) {
  const action = projection.actions.find((candidate) => candidate.id === actionId);
  assert.ok(action, `missing action ${actionId}`);
  const value = action.targets.find((candidate) => candidate.deviceId === deviceId);
  assert.ok(value, `missing target ${deviceId} for ${actionId}`);
  return value;
}

const remoteBrowser = service.list({ machineLocalRequest: false, now });
assert.deepEqual(remoteBrowser.actions.map((action) => action.id), PRODUCT_ACTION_IDS);
assert.equal(remoteBrowser.schemaVersion, 1);
assert.equal(remoteBrowser.audience, "operator");

assert.equal(
  target(remoteBrowser, "project.root.manage", LOCAL_DEVICE_TARGET_ID).availability,
  "requires-local-host",
  "public/remote browser must not pretend it can mutate the local filesystem"
);
assert.equal(
  target(remoteBrowser, "runtime.lifecycle", LOCAL_DEVICE_TARGET_ID).availability,
  "requires-local-host",
  "local Runtime lifecycle must remain unavailable until a real local-host executor/bridge is attested"
);
assert.equal(
  target(remoteBrowser, "workspace.read", LOCAL_DEVICE_TARGET_ID).availability,
  "available-local"
);
assert.equal(
  target(remoteBrowser, "capability.read", capableId).availability,
  "available-targeted"
);
assert.equal(
  target(remoteBrowser, "runtime.lifecycle", capableId).availability,
  "available-targeted"
);
assert.equal(
  target(remoteBrowser, "runtime.lifecycle", readOnlyId).availability,
  "unsupported",
  "protocol-v2 style remote read must not imply Runtime lifecycle support"
);
assert.equal(
  target(remoteBrowser, "project.root.manage", capableId).availability,
  "unsupported",
  "current Device Agent does not yet expose Project Root mutation RPC"
);
assert.equal(
  target(remoteBrowser, "project.root.manage", capableId).reason,
  "target-capability-not-implemented",
  "an unimplemented Product Action must not be misreported as an Agent upgrade problem"
);
assert.equal(
  target(remoteBrowser, "workspace.read", offlineId).availability,
  "offline"
);
assert.equal(
  target(remoteBrowser, "workspace.read", pausedId).availability,
  "available-targeted",
  "pausing AI execution must not block operator read capability"
);
assert.equal(
  target(remoteBrowser, "runtime.lifecycle", pausedId).availability,
  "available-targeted",
  "pausing AI execution must not block operator Runtime management when lifecycle RPC is available"
);

const loopbackBrowser = service.list({ machineLocalRequest: true, now });
assert.equal(
  target(loopbackBrowser, "project.root.manage", LOCAL_DEVICE_TARGET_ID).availability,
  "available-local"
);
assert.equal(
  target(loopbackBrowser, "project.discovery", LOCAL_DEVICE_TARGET_ID).executionMode,
  "local-runtime"
);
assert.equal(
  target(loopbackBrowser, "runtime.lifecycle", LOCAL_DEVICE_TARGET_ID).availability,
  "requires-local-host",
  "machine-local HTTP context is not evidence that a native lifecycle bridge exists"
);

for (const action of remoteBrowser.actions) {
  for (const item of action.targets) {
    assert.equal("publicKeyFingerprint" in item, false);
    assert.equal("path" in item, false);
    assert.equal("address" in item, false);
  }
}

process.stdout.write("VERIFY_PRODUCT_ACTION_AVAILABILITY_OK\n");
