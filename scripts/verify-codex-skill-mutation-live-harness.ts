import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import type { ContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type {
  RuntimeMcpServerProjection,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection
} from "../src/runtime/codex/runtime-adapter.ts";
import { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";
import {
  runCodexSkillMutationLiveProof,
  type CodexSkillMutationLiveRuntimeBundle
} from "./probe-codex-skill-mutation-live.ts";

const privateSkillPath = "/private/tokenpilot-runtime-sentinel/live-proof-skill/SKILL.md";
const sourceIdentityHash = createHash("sha256")
  .update(privateSkillPath, "utf8")
  .digest("hex");

const profile: RuntimeProfileDescriptor = {
  id: "runtime_profile_codex_skill_mutation_live_harness",
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex Harness",
  executableSource: "bundled",
  executableVersion: "codex-cli live-proof-harness",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.skills"],
  publicReason: null
};

interface HarnessState {
  enabled: boolean;
  providerWrites: number;
}

class FakeMutationClient extends CodexAppServerClient {
  constructor(
    private readonly state: HarnessState,
    private readonly observed: Set<string>
  ) {
    super({ command: process.execPath });
  }

  override async request<T = unknown>(
    method: string,
    params: unknown = {}
  ): Promise<T> {
    this.observed.add(method);
    if (method === "skills/list") {
      return {
        data: [
          {
            cwd: "/private/tokenpilot-runtime-sentinel/workspace",
            skills: [
              {
                name: "live-proof-skill",
                description: "Reversible mutation proof fixture",
                path: privateSkillPath,
                scope: "user",
                enabled: this.state.enabled,
                interface: {
                  displayName: "Live Proof Skill",
                  shortDescription: "Reversible mutation proof fixture"
                }
              }
            ]
          }
        ]
      } as T;
    }
    if (method === "skills/config/write") {
      const input = params as { path?: unknown; enabled?: unknown };
      assert.equal(input.path, privateSkillPath);
      assert.equal(typeof input.enabled, "boolean");
      this.state.enabled = input.enabled as boolean;
      this.state.providerWrites += 1;
      return { effectiveEnabled: this.state.enabled } as T;
    }
    throw new Error(`Unexpected fake Codex App Server method: ${method}`);
  }

  override async close(): Promise<void> {}
}

function createRuntime(
  repositories: ContinuityRepositories,
  _workspaceId: string,
  state: HarnessState,
  observed: Set<string>
): CodexSkillMutationLiveRuntimeBundle {
  const runtime = {
    async listCodexSkills(_input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]> {
      observed.add("skills/list");
      return [
        {
          name: "live-proof-skill",
          description: "Reversible mutation proof fixture",
          scope: "user",
          enabled: state.enabled,
          displayName: "Live Proof Skill",
          shortDescription: "Reversible mutation proof fixture",
          brandColor: null,
          sourceIdentityHash
        }
      ];
    },
    async listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]> {
      observed.add("mcpServerStatus/list");
      return [];
    },
    async listCodexPlugins(
      _input?: RuntimePluginListInput
    ): Promise<RuntimePluginProjection[]> {
      observed.add("plugin/list");
      return [];
    },
    async readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary> {
      observed.add("config/read");
      return {
        loaded: true,
        modelProviderConfigured: true,
        sandboxModeConfigured: true,
        desktopConfigPresent: true
      };
    }
  };

  return {
    profile,
    runtime,
    mutationAdapter: new CodexSkillMutationAdapter({
      workspaces: repositories.workspaces,
      resolveBinary: () => ({
        command: process.execPath,
        source: "configured",
        version: "codex-cli live-proof-harness",
        attempts: []
      }),
      createClient: () => new FakeMutationClient(state, observed)
    }),
    observedProviderMethods: observed,
    close: async () => undefined
  };
}

const state: HarnessState = {
  enabled: false,
  providerWrites: 0
};
const observed = new Set<string>();

const summary = await runCodexSkillMutationLiveProof({
  workspaceRoot: process.cwd(),
  requireOptIn: false,
  createRuntime: async (repositories, workspaceId) =>
    createRuntime(repositories, workspaceId, state, observed)
});

assert.equal(summary.ok, true);
assert.equal(summary.providerKind, "codex");
assert.equal(summary.protocolKind, "native-app-server");
assert.equal(summary.resourceScope, "user");
assert.equal(summary.originalEnabled, false);
assert.equal(summary.transitionedEnabled, true);
assert.equal(summary.restoredEnabled, false);
assert.equal(summary.transitionVerification, "verified");
assert.equal(summary.restoreVerification, "verified");
assert.equal(summary.restoredFingerprintMatchesOriginal, true);
assert.equal(summary.turnStartObserved, false);
assert.equal(summary.privateWorkspacePathProjected, false);
assert.equal(state.enabled, false);
assert.equal(state.providerWrites, 2, "Live-proof orchestration must perform exactly transition + restore writes");
assert.equal(observed.has("skills/config/write"), true);
assert.equal(observed.has("turn/start"), false);
assert.equal(
  JSON.stringify(summary).includes("/private/tokenpilot-runtime-sentinel"),
  false
);

process.stdout.write("VERIFY_CODEX_SKILL_MUTATION_LIVE_HARNESS_OK\n");
