import assert from "node:assert/strict";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import { runtimeResourceDescriptorSchema } from "../src/contracts/runtime-resources.ts";
import type { RuntimePluginProjection } from "../src/runtime/codex/runtime-adapter.ts";
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

function fixturePlugin(
  overrides: Partial<RuntimePluginProjection> = {}
): RuntimePluginProjection {
  return {
    id: "fixture-plugin@fixture-marketplace",
    marketplaceName: "fixture-marketplace",
    sourceIdentityHash: "a".repeat(64),
    sourceType: "local",
    name: "fixture-plugin",
    displayName: "Fixture Plugin",
    description: "Fixture plugin",
    version: "1.0.0",
    availableVersion: "1.1.0",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    installPolicy: "AVAILABLE",
    installPolicySource: "WORKSPACE_SETTING",
    mustShowInstallationInterstitial: false,
    authPolicy: "ON_USE",
    category: "Engineering",
    capabilities: ["Write", "Read"],
    observedBy: ["catalog", "installed"],
    ...overrides
  };
}

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
  listCodexPlugins: async () => [fixturePlugin()],
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
assert.deepEqual(plugin.capabilities, [
  "plugin:auth-policy:on-use",
  "plugin:install-policy-source:workspace-setting",
  "plugin:install-policy:available",
  "plugin:installation-interstitial:false",
  "plugin:observed:catalog",
  "plugin:observed:installed",
  "plugin:read",
  "plugin:source:local",
  "plugin:write"
]);
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

const scopedSkillAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [
    {
      name: "shared-name",
      description: "User scoped fixture",
      scope: "user",
      enabled: true,
      displayName: "Shared Skill",
      shortDescription: null,
      brandColor: null
    },
    {
      name: "shared-name",
      description: "Workspace scoped fixture",
      scope: "workspace",
      enabled: true,
      displayName: "Shared Skill",
      shortDescription: null,
      brandColor: null
    }
  ],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => []
});
const scopedSkills = await scopedSkillAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
assert.equal(scopedSkills.resources.length, 2);
assert.equal(new Set(scopedSkills.resources.map((resource) => resource.id)).size, 2);
assert.deepEqual(
  scopedSkills.resources.map((resource) => resource.externalId).sort(),
  ["skill:user:shared-name", "skill:workspace:shared-name"]
);

const sourceIdentityAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [
    {
      name: "same-scope-name",
      description: "First source",
      scope: "user",
      sourceIdentityHash: "1".repeat(64),
      enabled: false,
      displayName: "Same Scope Skill",
      shortDescription: null,
      brandColor: null
    },
    {
      name: "same-scope-name",
      description: "Second source",
      scope: "user",
      sourceIdentityHash: "2".repeat(64),
      enabled: true,
      displayName: "Same Scope Skill",
      shortDescription: null,
      brandColor: null
    }
  ],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => []
});
const sourceIdentitySkills = await sourceIdentityAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
assert.equal(sourceIdentitySkills.resources.length, 2);
assert.equal(new Set(sourceIdentitySkills.resources.map((resource) => resource.id)).size, 2);
assert.deepEqual(
  sourceIdentitySkills.resources.map((resource) => resource.externalId),
  ["skill:user:same-scope-name", "skill:user:same-scope-name"]
);
assert.equal(JSON.stringify(sourceIdentitySkills).includes("1".repeat(64)), false);
assert.equal(JSON.stringify(sourceIdentitySkills).includes("2".repeat(64)), false);

const duplicateSkill = {
  name: "duplicate-skill",
  description: "Identical duplicate fixture",
  scope: "user",
  enabled: true,
  displayName: "Duplicate Skill",
  shortDescription: null,
  brandColor: null
};
const duplicateSkillAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [duplicateSkill, { ...duplicateSkill }],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => []
});
const duplicateSkills = await duplicateSkillAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
assert.equal(duplicateSkills.resources.length, 1);
assert.equal(
  duplicateSkills.diagnostics.some(
    (entry) =>
      entry.source === "codex-resource-deduplication" &&
      entry.status === "degraded" &&
      entry.code === "RUNTIME_RESOURCE_DUPLICATE_COALESCED"
  ),
  true
);

const conflictingSkillAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [
    duplicateSkill,
    { ...duplicateSkill, description: "Conflicting duplicate fixture" }
  ],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => []
});
await assert.rejects(
  () =>
    conflictingSkillAdapter.inventory({
      profile,
      workspaceId: "workspace_fixture"
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_RESOURCE_DUPLICATE"
);

const pluginFingerprintBaseAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => [fixturePlugin()]
});
const pluginFingerprintBase = await pluginFingerprintBaseAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
const pluginFingerprintBaseResource = pluginFingerprintBase.resources[0];
assert.ok(pluginFingerprintBaseResource?.kind === "plugin");
const sourceIdentityDriftAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => [
    fixturePlugin({ sourceIdentityHash: "b".repeat(64) })
  ]
});
const sourceIdentityDriftInventory = await sourceIdentityDriftAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
const sourceIdentityDriftResource = sourceIdentityDriftInventory.resources[0];
assert.ok(sourceIdentityDriftResource?.kind === "plugin");
assert.notEqual(
  sourceIdentityDriftResource.id,
  pluginFingerprintBaseResource.id,
  "Plugin source identity drift must change the opaque Resource ID"
);
assert.equal(
  sourceIdentityDriftResource.externalId,
  pluginFingerprintBaseResource.externalId,
  "Plugin source identity hash must not leak through public externalId"
);

for (const drift of [
  { sourceType: "remote" as const },
  { installPolicy: "INSTALLED_BY_DEFAULT" },
  { installPolicySource: "IMPLICIT_CANONICAL_APP" },
  { mustShowInstallationInterstitial: true },
  { mustShowInstallationInterstitial: null },
  { authPolicy: "ON_INSTALL" }
]) {
  const driftAdapter = new CodexResourceInventoryAdapter({
    ...runtime,
    listCodexSkills: async () => [],
    listCodexMcpServers: async () => [],
    listCodexPlugins: async () => [fixturePlugin(drift)]
  });
  const driftInventory = await driftAdapter.inventory({
    profile,
    workspaceId: "workspace_fixture"
  });
  const driftResource = driftInventory.resources[0];
  assert.ok(driftResource?.kind === "plugin");
  assert.equal(driftResource.id, pluginFingerprintBaseResource.id);
  assert.notEqual(
    driftResource.fingerprint,
    pluginFingerprintBaseResource.fingerprint,
    `Plugin fingerprint ignored drift ${JSON.stringify(Object.keys(drift))}`
  );
}

const conflictingPluginSourceAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => [
    fixturePlugin({ sourceIdentityHash: "1".repeat(64) }),
    fixturePlugin({ sourceIdentityHash: "2".repeat(64) })
  ]
});
await assert.rejects(
  () =>
    conflictingPluginSourceAdapter.inventory({
      profile,
      workspaceId: "workspace_fixture"
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_RESOURCE_DUPLICATE"
);

const installedFirstAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => [
    ...Array.from({ length: 1200 }, (_, index) =>
      fixturePlugin({
        id: `catalog-${String(index).padStart(4, "0")}@fixture`,
        name: `catalog-${index}`,
        displayName: `A Catalog ${String(index).padStart(4, "0")}`,
        sourceIdentityHash: `${index}`.padStart(64, "0").slice(-64),
        version: null,
        availableVersion: "1.0.0",
        installed: false,
        enabled: false,
        authPolicy: "ON_INSTALL",
        observedBy: ["catalog"]
      })
    ),
    ...Array.from({ length: 26 }, (_, index) =>
      fixturePlugin({
        id: `installed-${String(index).padStart(3, "0")}@fixture`,
        name: `installed-${index}`,
        displayName: `Z Installed ${String(index).padStart(3, "0")}`,
        sourceIdentityHash: `f${String(index).padStart(63, "0")}`.slice(0, 64),
        version: "2.0.0",
        availableVersion: "2.0.0",
        installed: true,
        enabled: true,
        observedBy: ["installed"]
      })
    )
  ]
});
const installedFirstInventory = await installedFirstAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
assert.equal(installedFirstInventory.resources.length, 1000);
assert.equal(
  installedFirstInventory.resources.filter(
    (resource) => resource.kind === "plugin" && resource.installed
  ).length,
  26,
  "Installed Plugin resources must survive catalog truncation"
);

const impossibleInstalledBudgetAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () => [],
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () =>
    Array.from({ length: 1001 }, (_, index) =>
      fixturePlugin({
        id: `installed-overflow-${String(index).padStart(4, "0")}@fixture`,
        name: `installed-overflow-${index}`,
        displayName: `Installed Overflow ${String(index).padStart(4, "0")}`,
        sourceIdentityHash: `${index}`.padStart(64, "0").slice(-64),
        installed: true,
        enabled: true,
        observedBy: ["installed"]
      })
    )
});
await assert.rejects(
  () =>
    impossibleInstalledBudgetAdapter.inventory({
      profile,
      workspaceId: "workspace_fixture"
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_RESOURCE_BUDGET_EXCEEDED"
);

const oversizedAdapter = new CodexResourceInventoryAdapter({
  ...runtime,
  listCodexSkills: async () =>
    Array.from({ length: 600 }, (_, index) => ({
      name: `skill-${String(index).padStart(4, "0")}`,
      description: "Fixture oversized skill",
      scope: "user",
      enabled: true,
      displayName: `Skill ${String(index).padStart(4, "0")}`,
      shortDescription: null,
      brandColor: null
    })),
  listCodexMcpServers: async () =>
    Array.from({ length: 20 }, (_, index) => ({
      name: `mcp-${String(index).padStart(3, "0")}`,
      title: `MCP ${String(index).padStart(3, "0")}`,
      version: "1.0.0",
      authStatus: "unsupported",
      toolCount: 1,
      readOnlyToolCount: 1,
      mutatingToolCount: 0
    })),
  listCodexPlugins: async () =>
    Array.from({ length: 1000 }, (_, index) => ({
      id: `plugin-${String(index).padStart(4, "0")}@fixture`,
      marketplaceName: "fixture",
      name: `plugin-${index}`,
      displayName: `Plugin ${String(index).padStart(4, "0")}`,
      description: "Fixture oversized plugin",
      version: null,
      availableVersion: "1.0.0",
      installed: false,
      enabled: false,
      availability: "AVAILABLE",
      authPolicy: null,
      category: "Engineering",
      capabilities: ["Read"]
    }))
});
const oversizedInventory = await oversizedAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
assert.equal(oversizedInventory.resources.length, 1000);
assert.equal(
  oversizedInventory.resources.some((resource) => resource.kind === "skill"),
  true
);
assert.equal(
  oversizedInventory.resources.some((resource) => resource.kind === "mcp-server"),
  true
);
assert.equal(
  oversizedInventory.resources.some((resource) => resource.kind === "plugin"),
  true
);
assert.equal(
  oversizedInventory.diagnostics.some(
    (entry) =>
      entry.source === "codex-resource-budget" &&
      entry.status === "degraded" &&
      entry.code === "RUNTIME_RESOURCE_TRUNCATED"
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
