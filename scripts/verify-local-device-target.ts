import assert from "node:assert/strict";

import {
  LOCAL_DEVICE_TARGET_ID,
  buildLocalDeviceTarget
} from "../src/devices/local-device.js";
import { CapabilityProviderRegistry } from "../src/capabilities/provider.js";

const target = buildLocalDeviceTarget({
  platform: "darwin",
  architecture: "arm64"
});
assert.deepEqual(target, {
  id: LOCAL_DEVICE_TARGET_ID,
  kind: "device",
  locality: "local",
  platform: "darwin",
  architecture: "arm64"
});
assert.equal("hostname" in target, false);
assert.equal("machineId" in target, false);
assert.equal("uuid" in target, false);

const registry = new CapabilityProviderRegistry([
  {
    sourceKind: "fixture",
    async listProviders() {
      return [
        {
          id: "fixture-provider",
          providerKind: "fixture",
          protocolKind: "fixture-protocol",
          displayName: "Fixture Provider",
          compatibilityStatus: "ready",
          authStatus: "not-applicable",
          capabilities: ["files.read"],
          publicReason: null
        }
      ];
    }
  }
]);
const snapshot = await registry.snapshot(target);
assert.deepEqual(snapshot.target, target);
assert.equal(snapshot.providers.length, 1);
assert.equal(snapshot.providers[0]?.id, "fixture-provider");
assert.notEqual(snapshot.target, target, "snapshot must clone the target projection");
assert.notEqual(snapshot.providers[0], undefined);

const native = buildLocalDeviceTarget();
assert.equal(native.id, LOCAL_DEVICE_TARGET_ID);
assert.equal(native.kind, "device");
assert.equal(native.locality, "local");
assert.equal(native.platform, process.platform);
assert.equal(native.architecture, process.arch);

process.stdout.write("VERIFY_LOCAL_DEVICE_TARGET_OK\n");
