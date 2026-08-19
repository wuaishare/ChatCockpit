import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CapabilityProviderProjectionService } from "../src/application/capability-provider-projection-service.js";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.js";
import { buildLocalDeviceTarget } from "../src/devices/local-device.js";

const profile: RuntimeProfileDescriptor = {
  id: "runtime-profile-fixture",
  providerKind: "downstream-mcp",
  protocolKind: "mcp-legacy-stdio",
  displayName: "Desktop Commander Fixture",
  executableSource: null,
  executableVersion: "0.0.0-fixture",
  protocolVersion: "2025-03-26",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "not-applicable",
  capabilities: ["shell.exec", "files.read"],
  publicReason: null
};

let listCalls = 0;
const service = new CapabilityProviderProjectionService(
  {
    async listProfiles() {
      listCalls += 1;
      return [profile];
    }
  },
  buildLocalDeviceTarget({ platform: "darwin", architecture: "arm64" })
);

const projection = await service.snapshot();
assert.equal(listCalls, 1, "provider projection must not probe Runtime Profiles twice");
assert.deepEqual(projection.target, {
  id: "local-device",
  kind: "device",
  locality: "local",
  platform: "darwin",
  architecture: "arm64"
});
assert.equal(projection.profiles.length, 1);
assert.deepEqual(projection.profiles[0], profile);
assert.deepEqual(projection.providers, [
  {
    id: "runtime-profile-fixture",
    providerKind: "downstream-mcp",
    protocolKind: "mcp-legacy-stdio",
    displayName: "Desktop Commander Fixture",
    compatibilityStatus: "ready",
    authStatus: "not-applicable",
    capabilities: ["files.read", "shell.exec"],
    publicReason: null
  }
]);
assert.equal("executableVersion" in projection.providers[0]!, false);

const routes = fs.readFileSync(
  path.resolve("src/server/runtime-resource-routes.ts"),
  "utf8"
);
assert.match(routes, /services\.providers\.snapshot\(\)/);
assert.match(routes, /target:\s*projection\.target/);
assert.match(routes, /providers:\s*projection\.providers/);
assert.match(routes, /profiles:\s*projection\.profiles/);
assert.match(routes, /management:\s*services\.management\.snapshot\(projection\.profiles\)/);
assert.match(routes, /\/api\/resources\/providers/);
assert.match(routes, /\.\.\.services\.management\.snapshot\(projection\.profiles\)/);

const webTypes = fs.readFileSync(path.resolve("web/src/types.ts"), "utf8");
assert.match(webTypes, /interface DeviceTargetDescriptor/);
assert.match(webTypes, /interface CapabilityProviderDescriptor/);
assert.match(webTypes, /target: DeviceTargetDescriptor/);
assert.match(webTypes, /providers: CapabilityProviderDescriptor\[\]/);
assert.match(webTypes, /interface CapabilityProviderManagementDescriptor/);
assert.match(webTypes, /management: CapabilityProviderManagementProjection/);

process.stdout.write("VERIFY_RESOURCE_PROVIDER_PROJECTION_OK\n");
