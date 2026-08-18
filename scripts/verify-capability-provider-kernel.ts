import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.js";
import {
  CapabilityProviderRegistry,
  CapabilityProviderRegistryError,
  normalizeCapabilityProviderDescriptor,
  type CapabilityProviderDescriptor,
  type CapabilityProviderSource
} from "../src/capabilities/provider.js";
import {
  createDirectExecutorCapabilityProviderSource,
  projectDirectExecutorProvider
} from "../src/capabilities/direct-executor-provider.js";
import { createRuntimeProfileCapabilityProviderSource } from "../src/capabilities/runtime-profile-provider.js";
import type { DirectExecutorDescriptor } from "../src/direct/capability-broker.js";

const normalized = normalizeCapabilityProviderDescriptor({
  id: "provider-b",
  providerKind: "fixture",
  protocolKind: "fixture-protocol",
  displayName: "Fixture Provider",
  compatibilityStatus: "ready",
  authStatus: "not-applicable",
  capabilities: ["shell.exec", "files.read", "files.read"],
  publicReason: null
});
assert.deepEqual(normalized.capabilities, ["files.read", "shell.exec"]);

const directDescriptor: DirectExecutorDescriptor = {
  id: "downstream-mcp:fixture",
  kind: "downstream-mcp",
  displayName: "Fixture MCP",
  health: "degraded",
  scopes: ["host"],
  capabilities: [
    { id: "shell.exec", scopes: ["host"], access: ["read", "write"] },
    { id: "files.read", scopes: ["host"], access: ["read"] }
  ]
};
const directProvider = projectDirectExecutorProvider(directDescriptor);
assert.deepEqual(directProvider, {
  id: "downstream-mcp:fixture",
  providerKind: "downstream-mcp",
  protocolKind: "chatcockpit-direct",
  displayName: "Fixture MCP",
  compatibilityStatus: "degraded",
  authStatus: "not-applicable",
  capabilities: ["files.read", "shell.exec"],
  publicReason: "Direct executor health is degraded"
});

const runtimeProfile: RuntimeProfileDescriptor = {
  id: "runtime-profile-fixture",
  providerKind: "codex",
  protocolKind: "app-server-v2",
  displayName: "Codex Fixture",
  executableSource: "bundled",
  executableVersion: "1.0.0",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["thread/read"],
  publicReason: null
};
const providerShape: CapabilityProviderDescriptor = runtimeProfile;
assert.equal(providerShape.id, runtimeProfile.id);
assert.equal(providerShape.providerKind, "codex");

const source = (
  sourceKind: string,
  providers: CapabilityProviderDescriptor[] | Error
): CapabilityProviderSource => ({
  sourceKind,
  async listProviders() {
    if (providers instanceof Error) throw providers;
    return providers;
  }
});

const sourceErrors: string[] = [];
const registry = new CapabilityProviderRegistry(
  [
    createRuntimeProfileCapabilityProviderSource({
      listProfiles: async () => [runtimeProfile]
    }),
    createDirectExecutorCapabilityProviderSource({
      catalog: () => [directDescriptor]
    }),
    source("optional-unavailable", new Error("fixture unavailable"))
  ],
  (sourceKind) => sourceErrors.push(sourceKind)
);
const providers = await registry.listProviders();
assert.deepEqual(
  providers.map((provider) => provider.id),
  ["runtime-profile-fixture", "downstream-mcp:fixture"]
);
assert.deepEqual(sourceErrors, ["optional-unavailable"]);
assert.equal((await registry.getProvider("runtime-profile-fixture")).displayName, "Codex Fixture");

await assert.rejects(
  () => registry.getProvider("missing-provider"),
  (error: unknown) =>
    error instanceof CapabilityProviderRegistryError &&
    error.code === "CAPABILITY_PROVIDER_NOT_FOUND"
);

const duplicateRegistry = new CapabilityProviderRegistry([
  source("a", [normalized]),
  source("b", [{ ...normalized, displayName: "Duplicate" }])
]);
await assert.rejects(
  () => duplicateRegistry.listProviders(),
  (error: unknown) =>
    error instanceof CapabilityProviderRegistryError &&
    error.code === "CAPABILITY_PROVIDER_CONFLICT"
);

const runtimeTypesSource = fs.readFileSync(
  path.resolve("src/application/runtime-resource-types.ts"),
  "utf8"
);
assert.match(runtimeTypesSource, /CapabilityProviderDescriptor/);
assert.match(runtimeTypesSource, /extends CapabilityProviderDescriptor/);

process.stdout.write("VERIFY_CAPABILITY_PROVIDER_KERNEL_OK\n");
