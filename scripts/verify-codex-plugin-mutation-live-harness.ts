import assert from "node:assert/strict";
import fs from "node:fs";

import { ServiceError } from "../src/application/service-error.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import type {
  RuntimeMcpServerProjection,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection
} from "../src/runtime/codex/runtime-adapter.ts";
import type { CodexPluginMutationAdapter } from "../src/runtime/resources/codex-plugin-mutation-adapter.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";
import {
  formatCodexPluginMutationProofFailure,
  runCodexPluginMutationLiveProof,
  type CodexPluginMutationLiveRuntimeBundle
} from "./probe-codex-plugin-mutation-live.ts";

const profile: RuntimeProfileDescriptor = {
  id: "runtime_profile_plugin_live_harness",
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex",
  executableSource: "bundled",
  executableVersion: "codex-cli fixture",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.plugins"],
  publicReason: null
};

let installed = false;
let visibilityLagReadsRemaining = 0;
let visibilityLagProjectedInstalled = false;
let visibilityLagObservedInstalled = false;
let installCalls = 0;
let uninstallCalls = 0;
let skillMutationCalls = 0;
const observedProviderMethods = new Set<string>();

function pluginProjection(
  projectedInstalled = installed,
  observedInstalled = installed
): RuntimePluginProjection {
  return {
    id: "fixture-plugin@fixture-marketplace",
    marketplaceName: "fixture-marketplace",
    sourceIdentityHash: "a".repeat(64),
    sourceType: "remote",
    name: "fixture-plugin",
    displayName: "Fixture Plugin",
    description: "Fixture Plugin live-proof harness",
    version: projectedInstalled ? "1.0.0" : null,
    availableVersion: "1.0.0",
    installed: projectedInstalled,
    enabled: projectedInstalled,
    availability: "AVAILABLE",
    installPolicy: "AVAILABLE",
    installPolicySource: "WORKSPACE_SETTING",
    mustShowInstallationInterstitial: false,
    authPolicy: "ON_USE",
    category: "Engineering",
    capabilities: ["Read"],
    observedBy: observedInstalled ? ["catalog", "installed"] : ["catalog"]
  };
}

const runtime = {
  listCodexSkills: async (
    _input: RuntimeSkillListInput
  ): Promise<RuntimeSkillProjection[]> => {
    observedProviderMethods.add("skills/list");
    return [];
  },
  listCodexMcpServers: async (): Promise<RuntimeMcpServerProjection[]> => {
    observedProviderMethods.add("mcpServerStatus/list");
    return [];
  },
  listCodexPlugins: async (
    _input?: RuntimePluginListInput
  ): Promise<RuntimePluginProjection[]> => {
    observedProviderMethods.add("plugin/installed");
    observedProviderMethods.add("plugin/list");
    const useVisibilityLag = visibilityLagReadsRemaining > 0;
    const projectedInstalled = useVisibilityLag
      ? visibilityLagProjectedInstalled
      : installed;
    const observedInstalled = useVisibilityLag
      ? visibilityLagObservedInstalled
      : installed;
    if (useVisibilityLag) visibilityLagReadsRemaining -= 1;
    return [pluginProjection(projectedInstalled, observedInstalled)];
  },
  readCodexResourceConfigSummary:
    async (): Promise<RuntimeResourceConfigSummary> => {
      observedProviderMethods.add("config/read");
      return {
        loaded: true,
        modelProviderConfigured: true,
        sandboxModeConfigured: true,
        desktopConfigPresent: true
      };
    }
};

const skillMutationAdapter = {
  setEnabled: async () => {
    skillMutationCalls += 1;
    throw new Error("Plugin live-proof harness must never mutate a Skill");
  }
} as unknown as CodexSkillMutationAdapter;

const pluginMutationAdapter = {
  install: async (input: {
    profile: RuntimeProfileDescriptor;
    workspaceId: string;
    resourceId: string;
    expectedFingerprint: string;
  }) => {
    installCalls += 1;
    observedProviderMethods.add("plugin/installed");
    observedProviderMethods.add("plugin/list");
    observedProviderMethods.add("plugin/install");
    assert.equal(input.profile.id, profile.id);
    assert.ok(input.workspaceId.length > 0);
    assert.ok(input.resourceId.length > 0);
    assert.match(input.expectedFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(installed, false);
    installed = true;
    visibilityLagProjectedInstalled = true;
    visibilityLagObservedInstalled = false;
    visibilityLagReadsRemaining = 2;
    return {
      authPolicy: "ON_USE",
      appsNeedingAuthCount: 0
    };
  },
  uninstall: async (input: {
    profile: RuntimeProfileDescriptor;
    workspaceId: string;
    resourceId: string;
    expectedFingerprint: string;
  }) => {
    uninstallCalls += 1;
    observedProviderMethods.add("plugin/installed");
    observedProviderMethods.add("plugin/list");
    observedProviderMethods.add("plugin/uninstall");
    assert.equal(input.profile.id, profile.id);
    assert.ok(input.workspaceId.length > 0);
    assert.ok(input.resourceId.length > 0);
    assert.match(input.expectedFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(installed, true);
    installed = false;
    visibilityLagProjectedInstalled = true;
    visibilityLagObservedInstalled = true;
    visibilityLagReadsRemaining = 2;
  }
} as unknown as CodexPluginMutationAdapter;

const bundle: CodexPluginMutationLiveRuntimeBundle = {
  profile,
  runtime,
  skillMutationAdapter,
  pluginMutationAdapter,
  observedProviderMethods,
  close: async () => undefined
};

const summary = await runCodexPluginMutationLiveProof({
  requireOptIn: false,
  workspaceRoot: process.cwd(),
  pluginPostflightMaxAttempts: 3,
  pluginPostflightDelayMs: 0,
  createRuntime: async () => bundle
});

assert.equal(summary.ok, true);
assert.equal(summary.providerKind, "codex");
assert.equal(summary.protocolKind, "native-app-server");
assert.equal(summary.originalInstalled, false);
assert.equal(summary.transitionedInstalled, true);
assert.equal(summary.restoredInstalled, false);
assert.equal(summary.transitionVerification, "verified");
assert.equal(summary.restoreVerification, "verified");
assert.equal(summary.turnStartObserved, false);
assert.equal(summary.privateWorkspacePathProjected, false);
assert.equal(summary.restoredFingerprintMatchesOriginal, true);
assert.equal(installed, false);
assert.equal(installCalls, 1);
assert.equal(uninstallCalls, 1);
assert.equal(skillMutationCalls, 0);
assert.equal(summary.observedProviderMethods.includes("plugin/install"), true);
assert.equal(summary.observedProviderMethods.includes("plugin/uninstall"), true);
assert.equal(summary.observedProviderMethods.includes("turn/start"), false);
assert.equal(visibilityLagReadsRemaining, 0);

const formattedFailure = formatCodexPluginMutationProofFailure(
  new AggregateError(
    [
      new ServiceError("PRIMARY_SAFE_CODE", "sensitive primary provider message"),
      new ServiceError("CLEANUP_SAFE_CODE", "sensitive cleanup provider message")
    ],
    "sensitive aggregate message"
  )
);
assert.equal(formattedFailure, "primary=PRIMARY_SAFE_CODE,cleanup=CLEANUP_SAFE_CODE");
assert.equal(formattedFailure.includes("sensitive"), false);

const stageAwareSource = fs.readFileSync(
  new URL("./probe-codex-plugin-mutation-live.ts", import.meta.url),
  "utf8"
);
assert.equal(
  stageAwareSource.includes("new CodexPluginMutationProofStageError(\n      input.operation"),
  true,
  "Governed transition failures must retain the Plugin operation stage"
);
assert.equal(
  stageAwareSource.includes("`${role}.${stage}`"),
  true,
  "Public-safe Plugin proof errors must include the operation stage without raw provider messages"
);

const publicJson = JSON.stringify(summary);
for (const forbidden of [
  "fixture-plugin",
  "fixture-marketplace",
  "sourceIdentityHash",
  "remoteMarketplaceName",
  "marketplacePath",
  "installUrl",
  process.cwd()
]) {
  assert.equal(publicJson.includes(forbidden), false);
}

const probeSource = fs.readFileSync(
  new URL("./probe-codex-plugin-mutation-live.ts", import.meta.url),
  "utf8"
);
for (const required of [
  "TOKENPILOT_CODEX_PLUGIN_MUTATION_PROOF",
  "I_UNDERSTAND_REVERSIBLE_PLUGIN_MUTATION",
  "Refusing real Codex Plugin mutation without",
  "new RuntimeResourceMutationService(",
  "governedTransition({",
  'operation: "plugin.install"',
  'operation: "plugin.uninstall"'
]) {
  assert.equal(probeSource.includes(required), true, `Probe is missing ${required}`);
}
for (const forbiddenDirectWrite of [
  /\.request(?:<[^>]+>)?\(\s*["']plugin\/install["']/,
  /\.request(?:<[^>]+>)?\(\s*["']plugin\/uninstall["']/,
  /pluginMutationAdapter\.install\s*\(/,
  /pluginMutationAdapter\.uninstall\s*\(/
]) {
  assert.equal(
    forbiddenDirectWrite.test(probeSource),
    false,
    "Plugin live proof must not bypass the governed mutation service"
  );
}

const cleanupSection = probeSource.slice(
  probeSource.indexOf("cleanup-current"),
  probeSource.indexOf("cleanup-final") + "cleanup-final".length
);
assert.equal(cleanupSection.includes("governedTransition({"), true);
assert.equal(cleanupSection.includes('operation: "plugin.uninstall"'), true);

process.stdout.write("VERIFY_CODEX_PLUGIN_MUTATION_LIVE_HARNESS_OK\n");
