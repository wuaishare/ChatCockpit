import assert from "node:assert/strict";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import { runtimeResourceDescriptorSchema } from "../src/contracts/runtime-resources.ts";
import { CodexResourceInventoryAdapter } from "../src/runtime/resources/codex-resource-inventory-adapter.ts";

const profile: RuntimeProfileDescriptor = {
  id: buildRuntimeProfileId({
    providerKind: "codex",
    protocolKind: "native-app-server",
    instanceIdentity: "default"
  }),
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex",
  executableSource: "bundled",
  executableVersion: "codex-cli fixture",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: [],
  publicReason: null
};

const runtime = {
  listCodexSkills: async () => [
    {
      name: "fixture-skill",
      description: "Fixture skill",
      scope: "user",
      enabled: true,
      displayName: "Fixture Skill",
      shortDescription: "Fixture skill short",
      brandColor: "#123456"
    }
  ],
  listCodexMcpServers: async () => [
    {
      name: "fixture-mcp",
      title: "Fixture MCP",
      version: "1.2.3",
      authStatus: "unsupported",
      toolCount: 4,
      readOnlyToolCount: 3,
      mutatingToolCount: 1
    }
  ],
  listCodexPlugins: async () => [
    {
      id: "fixture-plugin@fixture-marketplace",
      marketplaceName: "fixture-marketplace",
      name: "fixture-plugin",
      displayName: "Fixture Plugin",
      description: "Fixture plugin",
      version: "1.0.0",
      availableVersion: "1.1.0",
      installed: true,
      enabled: true,
      availability: "AVAILABLE",
      authPolicy: "ON_USE",
      category: "Engineering",
      capabilities: ["Write", "Read"]
    }
  ],
  readCodexResourceConfigSummary: async () => ({
    loaded: true as const,
    modelProviderConfigured: true,
    sandboxModeConfigured: true,
    desktopConfigPresent: true
  })
};

const adapter = new CodexResourceInventoryAdapter(runtime);
const inventory = await adapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
assert.equal(inventory.profile.id, profile.id);
assert.equal(inventory.resources.length, 3);
assert.deepEqual(
  inventory.resources.map((resource) => resource.kind).sort(),
  ["mcp-server", "plugin", "skill"]
);
assert.equal(inventory.diagnostics.every((entry) => entry.status === "ready"), true);

const skill = inventory.resources.find((resource) => resource.kind === "skill");
const mcp = inventory.resources.find((resource) => resource.kind === "mcp-server");
const plugin = inventory.resources.find((resource) => resource.kind === "plugin");
assert.ok(skill && mcp && plugin);
assert.equal(skill.displayName, "Fixture Skill");
assert.equal(skill.scope, "user");
assert.equal(mcp.authStatus, "unsupported");
assert.equal(mcp.description?.includes("4 tools"), true);
assert.equal(plugin.updateStatus, "update-available");
assert.deepEqual(plugin.capabilities, ["plugin:read", "plugin:write"]);
for (const resource of inventory.resources) {
  assert.equal(runtimeResourceDescriptorSchema.safeParse(resource).success, true);
  assert.equal(resource.runtimeProfileId, profile.id);
  assert.match(resource.fingerprint, /^[a-f0-9]{64}$/);
}

const publicJson = JSON.stringify(inventory);
for (const forbidden of [
  "/private/codex/home",
  "SKILL.md",
  "marketplace.json",
  "rawConfig",
  "inputSchema",
  "secret-auth-token"
]) {
  assert.equal(publicJson.includes(forbidden), false);
}

const partialAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexPlugins: async () => {
    throw new Error("fixture plugin inventory unavailable");
  }
});
const partial = await partialAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
assert.equal(partial.resources.some((resource) => resource.kind === "plugin"), false);
assert.equal(
  partial.diagnostics.some(
    (entry) => entry.source === "codex-plugins" && entry.status === "failed"
  ),
  true
);
assert.equal(
  partial.diagnostics.some(
    (entry) => entry.source === "codex-skills" && entry.status === "ready"
  ),
  true
);

await assert.rejects(
  () =>
    adapter.inventory({
      profile: { ...profile, providerKind: "runner" },
      workspaceId: "workspace_fixture"
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_PROFILE_MISMATCH"
);

process.stdout.write("VERIFY_CODEX_RESOURCE_INVENTORY_ADAPTER_OK\n");
