import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import type { WorkspaceRepository } from "../src/continuity/repositories/workspace-repository.ts";
import type { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import { CodexResourceInventoryAdapter } from "../src/runtime/resources/codex-resource-inventory-adapter.ts";
import { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";

const privateWorkspacePath = "/private/tokenpilot-runtime-sentinel/workspace";
const firstSkillPath = `${privateWorkspacePath}/first/SKILL.md`;
const secondSkillPath = `${privateWorkspacePath}/second/SKILL.md`;

const profile: RuntimeProfileDescriptor = {
  id: buildRuntimeProfileId({
    providerKind: "codex",
    protocolKind: "native-app-server",
    instanceIdentity: "mutation-fixture"
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
  capabilities: ["resources.skills"],
  publicReason: null
};

const projections = [firstSkillPath, secondSkillPath].map((skillPath, index) => ({
  name: "duplicate-skill",
  description: `Fixture description ${index + 1}`,
  scope: "user",
  sourceIdentityHash: createHash("sha256").update(skillPath, "utf8").digest("hex"),
  enabled: true,
  displayName: `Duplicate Skill ${index + 1}`,
  shortDescription: `Short description ${index + 1}`,
  brandColor: null
}));

const inventoryAdapter = new CodexResourceInventoryAdapter({
  listCodexSkills: async () => projections,
  listCodexMcpServers: async () => [],
  listCodexPlugins: async () => [],
  readCodexResourceConfigSummary: async () => ({
    loaded: true,
    modelProviderConfigured: true,
    sandboxModeConfigured: true,
    desktopConfigPresent: false
  })
});
const inventory = await inventoryAdapter.inventory({
  profile,
  workspaceId: "workspace_fixture"
});
const skills = inventory.resources.filter((resource) => resource.kind === "skill");
assert.equal(skills.length, 2);
assert.notEqual(skills[0]!.id, skills[1]!.id);
const selected = skills.find((resource) => resource.displayName === "Duplicate Skill 2");
assert.ok(selected);

const observedMethods: string[] = [];
const writeParams: Record<string, unknown>[] = [];
let effectiveEnabled = true;
const fakeClient = {
  request: async (method: string, params: unknown) => {
    observedMethods.push(method);
    if (method === "skills/list") {
      return {
        data: [
          {
            cwd: privateWorkspacePath,
            skills: [
              {
                name: "duplicate-skill",
                description: "Fixture description 1",
                path: firstSkillPath,
                scope: "user",
                enabled: true,
                interface: {
                  displayName: "Duplicate Skill 1",
                  shortDescription: "Short description 1"
                }
              },
              {
                name: "duplicate-skill",
                description: "Fixture description 2",
                path: secondSkillPath,
                scope: "user",
                enabled: effectiveEnabled,
                interface: {
                  displayName: "Duplicate Skill 2",
                  shortDescription: "Short description 2"
                }
              }
            ],
            errors: []
          }
        ]
      };
    }
    if (method === "skills/config/write") {
      const record = params as Record<string, unknown>;
      writeParams.push(record);
      assert.equal(record.path, secondSkillPath);
      assert.equal(record.enabled, false);
      effectiveEnabled = false;
      return { effectiveEnabled: false };
    }
    throw new Error(`unexpected method ${method}`);
  },
  close: async () => undefined
} as unknown as CodexAppServerClient;

const workspaces = {
  getPrivate: (id: string) => {
    assert.equal(id, "workspace_fixture");
    return { id, privatePath: privateWorkspacePath };
  }
} as unknown as WorkspaceRepository;

const adapter = new CodexSkillMutationAdapter({
  workspaces,
  resolveBinary: () => ({
    command: "codex-fixture",
    source: "configured",
    version: "codex-cli fixture",
    attempts: []
  }),
  createClient: () => fakeClient
});

const result = await adapter.setEnabled({
  profile,
  workspaceId: "workspace_fixture",
  resourceId: selected.id,
  expectedFingerprint: selected.fingerprint,
  desiredEnabled: false
});
assert.deepEqual(result, { effectiveEnabled: false });
assert.deepEqual(observedMethods, ["skills/list", "skills/config/write"]);
assert.equal(writeParams.length, 1);
assert.equal(JSON.stringify(result).includes(privateWorkspacePath), false);
assert.equal(observedMethods.includes("turn/start"), false);

const staleClient = {
  ...fakeClient,
  request: async (method: string, params: unknown) => {
    if (method === "skills/list") {
      return {
        data: [
          {
            cwd: privateWorkspacePath,
            skills: [
              {
                name: "duplicate-skill",
                description: "Changed after approval",
                path: secondSkillPath,
                scope: "user",
                enabled: true,
                interface: {
                  displayName: "Duplicate Skill 2",
                  shortDescription: "Changed after approval"
                }
              }
            ],
            errors: []
          }
        ]
      };
    }
    throw new Error(`mutation should not be called for stale target: ${String(params)}`);
  }
} as unknown as CodexAppServerClient;
const staleAdapter = new CodexSkillMutationAdapter({
  workspaces,
  resolveBinary: () => ({
    command: "codex-fixture",
    source: "configured",
    version: "codex-cli fixture",
    attempts: []
  }),
  createClient: () => staleClient
});
await assert.rejects(
  () =>
    staleAdapter.setEnabled({
      profile,
      workspaceId: "workspace_fixture",
      resourceId: selected.id,
      expectedFingerprint: selected.fingerprint,
      desiredEnabled: false
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_RESOURCE_MUTATION_STALE"
);

process.stdout.write("VERIFY_CODEX_SKILL_MUTATION_ADAPTER_OK\n");
