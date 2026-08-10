import assert from "node:assert/strict";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import { runCodexResourceInventoryLiveProof } from "./probe-codex-resource-inventory-live.ts";

const profile: RuntimeProfileDescriptor = {
  id: buildRuntimeProfileId({
    providerKind: "codex",
    protocolKind: "native-app-server",
    instanceIdentity: "live-harness"
  }),
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex Harness",
  executableSource: "bundled",
  executableVersion: "codex-harness-1.0.0",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.skills", "resources.mcp", "resources.plugins"],
  publicReason: null
};

const summary = await runCodexResourceInventoryLiveProof({
  workspaceRoot: process.cwd(),
  createRuntime: async (_repositories, workspaceId) => ({
    profile,
    runtime: {
      listCodexSkills: async (input) => {
        assert.equal(input.workspaceId, workspaceId);
        assert.equal(input.forceReload, true);
        return [
          {
            name: "live-harness-skill",
            description: "Harness Skill",
            scope: "workspace",
            enabled: true,
            displayName: "Harness Skill",
            shortDescription: "Deterministic live-proof harness skill",
            brandColor: null
          }
        ];
      },
      listCodexMcpServers: async () => [
        {
          name: "live-harness-mcp",
          title: "Harness MCP",
          version: "1.0.0",
          authStatus: "unsupported",
          toolCount: 2,
          readOnlyToolCount: 2,
          mutatingToolCount: 0
        }
      ],
      listCodexPlugins: async (input) => {
        assert.equal(input?.workspaceId, workspaceId);
        return [
          {
            id: "live-harness-plugin@fixture",
            marketplaceName: "fixture",
            name: "live-harness-plugin",
            displayName: "Harness Plugin",
            description: "Deterministic live-proof harness plugin",
            version: "1.0.0",
            availableVersion: "1.0.0",
            installed: true,
            enabled: true,
            availability: "AVAILABLE",
            authPolicy: null,
            category: "Engineering",
            capabilities: ["Read"]
          }
        ];
      },
      readCodexResourceConfigSummary: async () => ({
        loaded: true,
        modelProviderConfigured: true,
        sandboxModeConfigured: true,
        desktopConfigPresent: true
      })
    },
    close: async () => undefined
  })
});

assert.equal(summary.ok, true);
assert.equal(summary.snapshotStatus, "ready");
assert.equal(summary.skillCount, 1);
assert.equal(summary.mcpServerCount, 1);
assert.equal(summary.pluginCount, 1);
assert.equal(summary.adapterCount, 0);
assert.equal(summary.agentCount, 0);
assert.deepEqual(summary.diagnosticsDegraded, []);
assert.deepEqual(summary.diagnosticsFailed, []);
assert.deepEqual(summary.diagnosticsReady, [
  "codex-config",
  "codex-mcp",
  "codex-plugins",
  "codex-skills"
]);
assert.deepEqual(summary.readSurfacesObserved, [
  "config/read",
  "mcpServerStatus/list",
  "plugin/list",
  "skills/list"
]);
assert.equal(summary.turnStartObserved, false);
assert.equal(summary.privateWorkspacePathProjected, false);

process.stdout.write("VERIFY_CODEX_RESOURCE_INVENTORY_LIVE_HARNESS_OK\n");
