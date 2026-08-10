import assert from "node:assert/strict";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import type { RuntimePluginProjection } from "../src/runtime/codex/runtime-adapter.ts";
import { runCodexPluginInventoryLiveProof } from "./probe-codex-plugin-inventory-live.ts";

const profile: RuntimeProfileDescriptor = {
  id: buildRuntimeProfileId({
    providerKind: "codex",
    protocolKind: "native-app-server",
    instanceIdentity: "plugin-live-harness"
  }),
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex Plugin Harness",
  executableSource: "bundled",
  executableVersion: "codex-plugin-harness-1.0.0",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.plugins"],
  publicReason: null
};

function plugin(
  index: number,
  installed: boolean
): RuntimePluginProjection {
  const idPrefix = installed ? "installed" : "catalog";
  return {
    id: `${idPrefix}-${String(index).padStart(4, "0")}@fixture`,
    marketplaceName: "fixture-marketplace",
    sourceIdentityHash: `${installed ? "f" : "a"}${String(index).padStart(63, "0")}`.slice(0, 64),
    sourceType: installed ? "local" : "remote",
    name: `${idPrefix}-${index}`,
    displayName: `${installed ? "Z Installed" : "A Catalog"} ${String(index).padStart(4, "0")}`,
    description: "Deterministic Plugin live harness fixture",
    version: installed ? "2.0.0" : null,
    availableVersion: installed ? "2.0.0" : "1.0.0",
    installed,
    enabled: installed,
    availability: "AVAILABLE",
    installPolicy: "AVAILABLE",
    authPolicy: installed ? "ON_USE" : "ON_INSTALL",
    category: "Engineering",
    capabilities: ["Read"],
    observedBy: installed ? ["installed"] : ["catalog"]
  };
}

const observedProviderMethods = new Set<string>();
const summary = await runCodexPluginInventoryLiveProof({
  workspaceRoot: process.cwd(),
  createRuntime: async (_repositories, workspaceId) => ({
    profile,
    observedProviderMethods,
    runtime: {
      listCodexSkills: async (input) => {
        assert.equal(input.workspaceId, workspaceId);
        observedProviderMethods.add("skills/list");
        return [
          {
            name: "plugin-harness-skill",
            description: "Harness Skill",
            scope: "workspace",
            sourceIdentityHash: "9".repeat(64),
            enabled: true,
            displayName: "Plugin Harness Skill",
            shortDescription: "Deterministic harness Skill",
            brandColor: null
          }
        ];
      },
      listCodexMcpServers: async () => {
        observedProviderMethods.add("mcpServerStatus/list");
        return [
          {
            name: "plugin-harness-mcp",
            title: "Plugin Harness MCP",
            version: "1.0.0",
            authStatus: "unsupported",
            toolCount: 1,
            readOnlyToolCount: 1,
            mutatingToolCount: 0
          }
        ];
      },
      listCodexPlugins: async (input) => {
        assert.equal(input?.workspaceId, workspaceId);
        observedProviderMethods.add("plugin/installed");
        observedProviderMethods.add("plugin/list");
        return [
          ...Array.from({ length: 1200 }, (_, index) => plugin(index, false)),
          ...Array.from({ length: 26 }, (_, index) => plugin(index, true))
        ];
      },
      readCodexResourceConfigSummary: async () => {
        observedProviderMethods.add("config/read");
        return {
          loaded: true as const,
          modelProviderConfigured: true,
          sandboxModeConfigured: true,
          desktopConfigPresent: true
        };
      }
    },
    close: async () => undefined
  })
});

assert.equal(summary.ok, true);
assert.equal(summary.providerInstalledUniqueCount, 26);
assert.equal(summary.authoritativeInstalledResourceCount, 26);
assert.equal(summary.authoritativePluginResourceCount, 998);
assert.equal(summary.missingInstalledResourceCount, 0);
assert.deepEqual(summary.diagnosticsFailed, []);
assert.deepEqual(summary.mutationMethodsObserved, []);
assert.equal(summary.turnStartObserved, false);
assert.equal(summary.privateWorkspacePathProjected, false);
assert.deepEqual(summary.observedProviderMethods, [
  "config/read",
  "mcpServerStatus/list",
  "plugin/installed",
  "plugin/list",
  "skills/list"
]);

process.stdout.write("VERIFY_CODEX_PLUGIN_INVENTORY_LIVE_HARNESS_OK\n");
