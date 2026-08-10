import assert from "node:assert/strict";

import {
  hashRuntimeResource,
  hashRuntimeResourceSnapshot
} from "../src/application/runtime-resource-hash.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import type { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import {
  buildLegacySkillMutationHashV1,
  buildRuntimeResourceMutationHashV2,
  mutationSemantics,
  runtimeResourceMutationHashMatches
} from "../src/application/runtime-resource-mutation-semantics.ts";
import { ServiceError } from "../src/application/service-error.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";
import type { CodexPluginMutationAdapter } from "../src/runtime/resources/codex-plugin-mutation-adapter.ts";

const NOW = "2026-08-10T00:45:00.000Z";
const runtimeProfileId = "runtime_profile_mutation_fixture";
const workspaceId = "workspace_mutation_fixture";
const resourceId = "resource_mutation_fixture";

const profile: RuntimeProfileDescriptor = {
  id: runtimeProfileId,
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

function resource(enabled: boolean): RuntimeResourceDescriptor {
  const base = {
    id: resourceId,
    runtimeProfileId,
    kind: "skill" as const,
    externalId: "skill:user:fixture-skill",
    displayName: "Fixture Skill",
    description: "Governed mutation fixture",
    scope: "user" as const,
    installed: true,
    enabled,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable" as const,
    authStatus: "not-applicable" as const,
    compatibilityStatus: "ready" as const,
    sourceKind: "runtime-native" as const,
    sourceLabel: "Codex",
    capabilities: ["instruction"],
    publicReason: null
  };
  return { ...base, fingerprint: hashRuntimeResource(base) };
}

function pluginResource(installed: boolean): RuntimeResourceDescriptor {
  const base = {
    id: "resource_plugin_mutation_fixture",
    runtimeProfileId,
    kind: "plugin" as const,
    externalId: "plugin:fixture-plugin@fixture-marketplace",
    displayName: "Fixture Plugin",
    description: "Governed Plugin mutation fixture",
    scope: "runtime" as const,
    installed,
    enabled: installed,
    version: installed ? "1.0.0" : null,
    availableVersion: "1.0.0",
    updateStatus: installed ? ("current" as const) : ("not-applicable" as const),
    authStatus: "unknown" as const,
    compatibilityStatus: "ready" as const,
    sourceKind: "runtime-native" as const,
    sourceLabel: "Codex:fixture-marketplace",
    capabilities: [
      "plugin:source:remote",
      "plugin:install-policy:available",
      "plugin:auth-policy:on-use",
      "plugin:installation-interstitial:false",
      "plugin:observed:catalog"
    ],
    publicReason: null
  };
  return { ...base, fingerprint: hashRuntimeResource(base) };
}

function pluginResourceWith(
  installed: boolean,
  overrides: Partial<Omit<RuntimeResourceDescriptor, "fingerprint">>
): RuntimeResourceDescriptor {
  const { fingerprint: _ignored, ...current } = pluginResource(installed);
  const base = { ...current, ...overrides };
  return { ...base, fingerprint: hashRuntimeResource(base) };
}

const skillEnable = mutationSemantics("skill.enable");
const skillDisable = mutationSemantics("skill.disable");
const pluginInstall = mutationSemantics("plugin.install");
const pluginUninstall = mutationSemantics("plugin.uninstall");
assert.deepEqual(skillEnable.requestedState, { enabled: true });
assert.deepEqual(skillDisable.requestedState, { enabled: false });
assert.deepEqual(pluginInstall.requestedState, { installed: true });
assert.deepEqual(pluginUninstall.requestedState, { installed: false });
assert.equal(skillEnable.resourceKind, "skill");
assert.equal(pluginInstall.resourceKind, "plugin");
assert.equal(skillEnable.providerMethod, "skills/config/write");
assert.equal(pluginInstall.providerMethod, "plugin/install");
assert.equal(pluginUninstall.providerMethod, "plugin/uninstall");
assert.deepEqual(skillDisable.beforeState(resource(true)), { enabled: true });
assert.deepEqual(pluginInstall.beforeState(pluginResource(false)), {
  installed: false
});
assert.equal(skillDisable.isNoop(resource(true)), false);
assert.equal(skillDisable.isVerified(resource(false)), true);
assert.equal(pluginInstall.isNoop(pluginResource(false)), false);
assert.equal(pluginInstall.isVerified(pluginResource(true)), true);
assert.deepEqual(pluginUninstall.observedState(pluginResource(false)), {
  installed: false
});
assert.deepEqual(pluginUninstall.observedState(undefined), { missing: true });

const semanticsHashInput = {
  operation: "skill.disable" as const,
  runtimeProfileId,
  workspaceId,
  resource: resource(true),
  beforeSnapshotId: "resource_snapshot_semantics_fixture",
  providerKind: profile.providerKind,
  protocolKind: profile.protocolKind
};
const legacySkillHash = buildLegacySkillMutationHashV1(semanticsHashInput);
const v2SkillHash = buildRuntimeResourceMutationHashV2(semanticsHashInput);
assert.notEqual(legacySkillHash, v2SkillHash);
assert.equal(
  runtimeResourceMutationHashMatches(legacySkillHash, semanticsHashInput),
  true,
  "Existing Schema v16 Skill approvals must retain v1 hash compatibility"
);
assert.equal(
  runtimeResourceMutationHashMatches(v2SkillHash, semanticsHashInput),
  true
);
const pluginHashInput = {
  operation: "plugin.install" as const,
  runtimeProfileId,
  workspaceId,
  resource: pluginResource(false),
  beforeSnapshotId: "resource_snapshot_plugin_semantics_fixture",
  providerKind: profile.providerKind,
  protocolKind: profile.protocolKind
};
assert.equal(
  runtimeResourceMutationHashMatches(
    buildRuntimeResourceMutationHashV2(pluginHashInput),
    pluginHashInput
  ),
  true
);

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);
assert.equal(database.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
repositories.projects.create({
  id: "project_mutation_fixture",
  slug: "mutation-fixture",
  displayName: "Mutation Fixture",
  now: NOW
});
repositories.workspaces.create({
  id: workspaceId,
  projectId: "project_mutation_fixture",
  repoId: "repo_mutation_fixture",
  privatePath: "/private/tokenpilot-runtime-sentinel/mutation-workspace",
  now: NOW
});

let enabled = true;
let inventoryCalls = 0;
const inventoryKeys: string[] = [];
const fakeInventory = {
  inventory: async (input: {
    runtimeProfileId: string;
    workspaceId?: string;
    idempotencyKey: string;
  }) => {
    assert.equal(input.runtimeProfileId, runtimeProfileId);
    assert.equal(input.workspaceId, workspaceId);
    assert.ok(input.idempotencyKey.length > 0);
    inventoryCalls += 1;
    inventoryKeys.push(input.idempotencyKey);
    const current = resource(enabled);
    const snapshot = repositories.runtimeResourceSnapshots.create({
      runtimeProfileId,
      providerKind: profile.providerKind,
      protocolKind: profile.protocolKind,
      status: "ready",
      profile: profile as unknown as Record<string, unknown>,
      fingerprint: hashRuntimeResourceSnapshot(profile, [current]),
      items: [
        {
          resourceId: current.id,
          kind: current.kind,
          externalId: current.externalId,
          displayName: current.displayName,
          description: current.description,
          scope: current.scope,
          installed: current.installed,
          enabled: current.enabled,
          version: current.version,
          availableVersion: current.availableVersion,
          updateStatus: current.updateStatus,
          authStatus: current.authStatus,
          compatibilityStatus: current.compatibilityStatus,
          sourceKind: current.sourceKind,
          sourceLabel: current.sourceLabel,
          capabilities: current.capabilities,
          publicReason: current.publicReason,
          fingerprint: current.fingerprint
        }
      ],
      now: new Date(Date.parse(NOW) + inventoryCalls * 1000).toISOString()
    });
    return {
      snapshot,
      profile,
      resources: [current],
      diagnostics: [],
      diff: {
        previousSnapshotId: null,
        added: [],
        removed: [],
        changed: [],
        unchanged: []
      },
      replayed: false
    };
  }
} as unknown as RuntimeResourceInventoryService;

let mutationCalls = 0;
let mutationScenario: "success" | "stale-race" | "error-after-change" = "success";
let staleRaceExternalDesired = false;
const fakeMutationAdapter = {
  setEnabled: async (input: {
    profile: RuntimeProfileDescriptor;
    workspaceId: string;
    resourceId: string;
    expectedFingerprint: string;
    desiredEnabled: boolean;
  }) => {
    mutationCalls += 1;
    assert.equal(input.profile.id, runtimeProfileId);
    assert.equal(input.workspaceId, workspaceId);
    assert.equal(input.resourceId, resourceId);
    assert.equal(input.expectedFingerprint, resource(enabled).fingerprint);
    if (mutationScenario === "stale-race") {
      if (staleRaceExternalDesired) {
        enabled = input.desiredEnabled;
      }
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Fixture target changed between preflight and provider write"
      );
    }
    enabled = input.desiredEnabled;
    if (mutationScenario === "error-after-change") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_EXTERNAL_FAILED",
        "Fixture transport failed after the Runtime applied the desired state"
      );
    }
    return { effectiveEnabled: enabled };
  }
} as unknown as CodexSkillMutationAdapter;

const service = new RuntimeResourceMutationService(
  repositories,
  fakeInventory,
  fakeMutationAdapter,
  { now: () => NOW }
);

const before = resource(true);

enabled = false;
const retryInventoryStart = inventoryKeys.length;
await assert.rejects(
  () =>
    service.prepare({
      operation: "skill.disable",
      runtimeProfileId,
      workspaceId,
      resourceId,
      expectedFingerprint: before.fingerprint,
      idempotencyKey: "prepare-fresh-retry-001"
    }),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "RUNTIME_RESOURCE_MUTATION_STALE"
);
enabled = true;
const freshRetryPrepared = await service.prepare({
  operation: "skill.disable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "prepare-fresh-retry-001"
});
assert.equal(freshRetryPrepared.replayed, false);
assert.equal(inventoryKeys.length, retryInventoryStart + 2);
assert.notEqual(
  inventoryKeys[retryInventoryStart],
  inventoryKeys[retryInventoryStart + 1],
  "Failed outer retries must use a fresh authoritative inventory key"
);

const prepared = await service.prepare({
  operation: "skill.disable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "prepare-disable-001"
});
assert.equal(prepared.replayed, false);
assert.equal(prepared.approval.status, "pending");
assert.equal(prepared.approval.beforeFingerprint, before.fingerprint);
assert.deepEqual(prepared.approval.requestedState, { enabled: false });
assert.equal(prepared.approval.expiresAt, "2026-08-10T00:50:00.000Z");
const callsAfterPrepare = inventoryCalls;
const preparedReplay = await service.prepare({
  operation: "skill.disable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "prepare-disable-001"
});
assert.equal(preparedReplay.replayed, true);
assert.equal(preparedReplay.approval.id, prepared.approval.id);
assert.equal(inventoryCalls, callsAfterPrepare);

const approved = service.decide({
  approvalId: prepared.approval.id,
  expectedRevision: prepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-disable-001"
});
assert.equal(approved.approval.status, "approved");
assert.equal(approved.approval.revision, 2);

const executed = await service.execute({
  approvalId: approved.approval.id,
  expectedApprovalRevision: approved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "execute-disable-001"
});
assert.equal(executed.replayed, false);
assert.equal(executed.approval.status, "consumed");
assert.equal(executed.execution.verificationStatus, "verified");
assert.deepEqual(executed.execution.observedState, { enabled: false });
assert.equal(enabled, false);
assert.equal(mutationCalls, 1);
assert.ok(executed.execution.afterSnapshotId);
assert.equal(executed.execution.afterFingerprint, resource(false).fingerprint);

const callsAfterExecute = inventoryCalls;
const executedReplay = await service.execute({
  approvalId: approved.approval.id,
  expectedApprovalRevision: approved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "execute-disable-001"
});
assert.equal(executedReplay.replayed, true);
assert.equal(executedReplay.execution.id, executed.execution.id);
assert.equal(mutationCalls, 1);
assert.equal(inventoryCalls, callsAfterExecute);

const disabled = resource(false);
const enablePrepared = await service.prepare({
  operation: "skill.enable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: disabled.fingerprint,
  idempotencyKey: "prepare-enable-stale-001"
});
const enableApproved = service.decide({
  approvalId: enablePrepared.approval.id,
  expectedRevision: enablePrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-enable-stale-001"
});
enabled = true;
await assert.rejects(
  () =>
    service.execute({
      approvalId: enableApproved.approval.id,
      expectedApprovalRevision: enableApproved.approval.revision,
      runtimeProfileId,
      workspaceId,
      resourceId,
      expectedFingerprint: disabled.fingerprint,
      idempotencyKey: "execute-enable-stale-001"
    }),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "RUNTIME_RESOURCE_MUTATION_STALE"
);
assert.equal(mutationCalls, 1, "Stale preflight must not call the provider mutation adapter");
const permanentlyStale = repositories.runtimeResourceMutations.getApproval(
  enableApproved.approval.id
);
assert.equal(permanentlyStale.status, "stale");
assert.equal(permanentlyStale.revision, enableApproved.approval.revision + 1);

enabled = false;
await assert.rejects(
  () =>
    service.execute({
      approvalId: permanentlyStale.id,
      expectedApprovalRevision: permanentlyStale.revision,
      runtimeProfileId,
      workspaceId,
      resourceId,
      expectedFingerprint: disabled.fingerprint,
      idempotencyKey: "execute-enable-stale-resurrection-001"
    }),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "RUNTIME_RESOURCE_MUTATION_STALE"
);
assert.equal(
  mutationCalls,
  1,
  "A stale approval must remain unusable even if the Runtime later returns to its old fingerprint"
);

enabled = true;
const raceBefore = resource(true);
const racePrepared = await service.prepare({
  operation: "skill.disable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: raceBefore.fingerprint,
  idempotencyKey: "prepare-disable-race-001"
});
const raceApproved = service.decide({
  approvalId: racePrepared.approval.id,
  expectedRevision: racePrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-disable-race-001"
});
mutationScenario = "stale-race";
const raceExecuted = await service.execute({
  approvalId: raceApproved.approval.id,
  expectedApprovalRevision: raceApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: raceBefore.fingerprint,
  idempotencyKey: "execute-disable-race-001"
});
assert.equal(raceExecuted.execution.verificationStatus, "stale");
assert.equal(raceExecuted.execution.errorCode, "RUNTIME_RESOURCE_MUTATION_STALE");
assert.deepEqual(raceExecuted.execution.observedState, { enabled: true });
assert.equal(enabled, true);
assert.equal(mutationCalls, 2);

const staleDesiredBefore = resource(true);
const staleDesiredPrepared = await service.prepare({
  operation: "skill.disable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: staleDesiredBefore.fingerprint,
  idempotencyKey: "prepare-disable-stale-desired-001"
});
const staleDesiredApproved = service.decide({
  approvalId: staleDesiredPrepared.approval.id,
  expectedRevision: staleDesiredPrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-disable-stale-desired-001"
});
staleRaceExternalDesired = true;
const staleDesiredExecuted = await service.execute({
  approvalId: staleDesiredApproved.approval.id,
  expectedApprovalRevision: staleDesiredApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: staleDesiredBefore.fingerprint,
  idempotencyKey: "execute-disable-stale-desired-001"
});
assert.equal(staleDesiredExecuted.execution.verificationStatus, "stale");
assert.equal(
  staleDesiredExecuted.execution.errorCode,
  "RUNTIME_RESOURCE_MUTATION_STALE"
);
assert.deepEqual(staleDesiredExecuted.execution.observedState, { enabled: false });
assert.ok(staleDesiredExecuted.execution.afterSnapshotId);
assert.equal(enabled, false);
assert.equal(mutationCalls, 3);
staleRaceExternalDesired = false;

enabled = true;
mutationScenario = "error-after-change";
const authoritativeBefore = resource(true);
const authoritativePrepared = await service.prepare({
  operation: "skill.disable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: authoritativeBefore.fingerprint,
  idempotencyKey: "prepare-disable-authoritative-001"
});
const authoritativeApproved = service.decide({
  approvalId: authoritativePrepared.approval.id,
  expectedRevision: authoritativePrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-disable-authoritative-001"
});
const authoritativeInventoryStart = inventoryCalls;
const authoritativeExecuted = await service.execute({
  approvalId: authoritativeApproved.approval.id,
  expectedApprovalRevision: authoritativeApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: authoritativeBefore.fingerprint,
  idempotencyKey: "execute-disable-authoritative-001"
});
assert.equal(authoritativeExecuted.execution.verificationStatus, "verified");
assert.equal(authoritativeExecuted.execution.errorCode, null);
assert.deepEqual(authoritativeExecuted.execution.observedState, { enabled: false });
assert.equal(enabled, false);
assert.equal(mutationCalls, 4);
assert.equal(
  inventoryCalls - authoritativeInventoryStart,
  2,
  "Skill execute must remain one fresh preflight plus one postflight read"
);
mutationScenario = "success";

let pluginInstalled = false;
let pluginInventoryCalls = 0;
const pluginInventoryKeys: string[] = [];
let pluginMutationCalls = 0;
let pluginResourceOverride: RuntimeResourceDescriptor | null = null;
let pluginMutationScenario: "success" | "stale-race" | "error-after-change" = "success";
let pluginStaleExternalDesired = false;
let pluginPostflightStaleReadsRemaining = 0;
let pluginPostflightStaleInstalled: boolean | null = null;
const fakePluginInventory = {
  inventory: async (input: {
    runtimeProfileId: string;
    workspaceId?: string;
    idempotencyKey: string;
  }) => {
    assert.equal(input.runtimeProfileId, runtimeProfileId);
    assert.equal(input.workspaceId, workspaceId);
    assert.ok(input.idempotencyKey.length > 0);
    pluginInventoryCalls += 1;
    pluginInventoryKeys.push(input.idempotencyKey);
    const isPostflight = input.idempotencyKey.startsWith("resource-mutation-postflight:");
    const useStalePostflight =
      isPostflight &&
      pluginPostflightStaleReadsRemaining > 0 &&
      pluginPostflightStaleInstalled !== null;
    if (useStalePostflight) pluginPostflightStaleReadsRemaining -= 1;
    const current =
      pluginResourceOverride ??
      pluginResource(useStalePostflight ? pluginPostflightStaleInstalled! : pluginInstalled);
    const snapshot = repositories.runtimeResourceSnapshots.create({
      runtimeProfileId,
      providerKind: profile.providerKind,
      protocolKind: profile.protocolKind,
      status: "ready",
      profile: profile as unknown as Record<string, unknown>,
      fingerprint: hashRuntimeResourceSnapshot(profile, [current]),
      items: [
        {
          resourceId: current.id,
          kind: current.kind,
          externalId: current.externalId,
          displayName: current.displayName,
          description: current.description,
          scope: current.scope,
          installed: current.installed,
          enabled: current.enabled,
          version: current.version,
          availableVersion: current.availableVersion,
          updateStatus: current.updateStatus,
          authStatus: current.authStatus,
          compatibilityStatus: current.compatibilityStatus,
          sourceKind: current.sourceKind,
          sourceLabel: current.sourceLabel,
          capabilities: current.capabilities,
          publicReason: current.publicReason,
          fingerprint: current.fingerprint
        }
      ],
      now: new Date(Date.parse(NOW) + 60_000 + pluginInventoryCalls * 1000).toISOString()
    });
    return {
      snapshot,
      profile,
      resources: [current],
      diagnostics: [],
      diff: {
        previousSnapshotId: null,
        added: [],
        removed: [],
        changed: [],
        unchanged: []
      },
      replayed: false
    };
  }
} as unknown as RuntimeResourceInventoryService;

const fakePluginMutationAdapter = {
  install: async (input: {
    profile: RuntimeProfileDescriptor;
    workspaceId: string;
    resourceId: string;
    expectedFingerprint: string;
  }) => {
    pluginMutationCalls += 1;
    assert.equal(input.profile.id, runtimeProfileId);
    assert.equal(input.workspaceId, workspaceId);
    assert.equal(input.resourceId, pluginResource(false).id);
    assert.equal(input.expectedFingerprint, pluginResource(false).fingerprint);
    if (pluginMutationScenario === "stale-race") {
      if (pluginStaleExternalDesired) pluginInstalled = true;
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Fixture Plugin target changed between preflight and provider write"
      );
    }
    pluginInstalled = true;
    if (pluginMutationScenario === "error-after-change") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_EXTERNAL_FAILED",
        "Fixture transport failed after Plugin install reached the provider"
      );
    }
    return { authPolicy: "ON_USE", appsNeedingAuthCount: 0 };
  },
  uninstall: async (input: {
    profile: RuntimeProfileDescriptor;
    workspaceId: string;
    resourceId: string;
    expectedFingerprint: string;
  }) => {
    pluginMutationCalls += 1;
    assert.equal(input.profile.id, runtimeProfileId);
    assert.equal(input.workspaceId, workspaceId);
    assert.equal(input.resourceId, pluginResource(true).id);
    assert.equal(input.expectedFingerprint, pluginResource(true).fingerprint);
    pluginInstalled = false;
  }
} as unknown as CodexPluginMutationAdapter;

const pluginService = new RuntimeResourceMutationService(
  repositories,
  fakePluginInventory,
  fakeMutationAdapter,
  {
    now: () => NOW,
    codexPlugins: fakePluginMutationAdapter,
    pluginPostflightMaxAttempts: 3,
    pluginPostflightDelayMs: 0
  }
);

const pluginBefore = pluginResource(false);
const pluginInstallPrepared = await pluginService.prepare({
  operation: "plugin.install",
  runtimeProfileId,
  workspaceId,
  resourceId: pluginBefore.id,
  expectedFingerprint: pluginBefore.fingerprint,
  idempotencyKey: "prepare-plugin-install-001"
});
assert.equal(pluginInstallPrepared.approval.resourceKind, "plugin");
assert.deepEqual(pluginInstallPrepared.approval.requestedState, {
  installed: true
});
assert.equal(pluginInstallPrepared.approval.publicSummary.beforeInstalled, false);
assert.equal(pluginInstallPrepared.approval.publicSummary.requestedInstalled, true);
const pluginInstallApproved = pluginService.decide({
  approvalId: pluginInstallPrepared.approval.id,
  expectedRevision: pluginInstallPrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-plugin-install-001"
});
const pluginInstalledExecution = await pluginService.execute({
  approvalId: pluginInstallApproved.approval.id,
  expectedApprovalRevision: pluginInstallApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId: pluginBefore.id,
  expectedFingerprint: pluginBefore.fingerprint,
  idempotencyKey: "execute-plugin-install-001"
});
assert.equal(pluginInstalledExecution.execution.providerMethod, "plugin/install");
assert.equal(pluginInstalledExecution.execution.verificationStatus, "verified");
assert.deepEqual(pluginInstalledExecution.execution.observedState, {
  installed: true,
  authPolicy: "ON_USE",
  appsNeedingAuthCount: 0
});
assert.equal(pluginInstalled, true);
assert.equal(pluginMutationCalls, 1);
const pluginInstallReplay = await pluginService.execute({
  approvalId: pluginInstallApproved.approval.id,
  expectedApprovalRevision: pluginInstallApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId: pluginBefore.id,
  expectedFingerprint: pluginBefore.fingerprint,
  idempotencyKey: "execute-plugin-install-001"
});
assert.equal(pluginInstallReplay.replayed, true);
assert.equal(pluginMutationCalls, 1);

const pluginAfterInstall = pluginResource(true);
const pluginUninstallPrepared = await pluginService.prepare({
  operation: "plugin.uninstall",
  runtimeProfileId,
  workspaceId,
  resourceId: pluginAfterInstall.id,
  expectedFingerprint: pluginAfterInstall.fingerprint,
  idempotencyKey: "prepare-plugin-uninstall-001"
});
assert.deepEqual(pluginUninstallPrepared.approval.requestedState, {
  installed: false
});
const pluginUninstallApproved = pluginService.decide({
  approvalId: pluginUninstallPrepared.approval.id,
  expectedRevision: pluginUninstallPrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-plugin-uninstall-001"
});
const pluginUninstalledExecution = await pluginService.execute({
  approvalId: pluginUninstallApproved.approval.id,
  expectedApprovalRevision: pluginUninstallApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId: pluginAfterInstall.id,
  expectedFingerprint: pluginAfterInstall.fingerprint,
  idempotencyKey: "execute-plugin-uninstall-001"
});
assert.equal(
  pluginUninstalledExecution.execution.providerMethod,
  "plugin/uninstall"
);
assert.equal(pluginUninstalledExecution.execution.verificationStatus, "verified");
assert.deepEqual(pluginUninstalledExecution.execution.observedState, {
  installed: false
});
assert.equal(pluginInstalled, false);
assert.equal(pluginMutationCalls, 2);

pluginInstalled = false;
pluginPostflightStaleReadsRemaining = 2;
pluginPostflightStaleInstalled = false;
const pluginConvergenceBefore = pluginResource(false);
const pluginConvergencePrepared = await pluginService.prepare({
  operation: "plugin.install",
  runtimeProfileId,
  workspaceId,
  resourceId: pluginConvergenceBefore.id,
  expectedFingerprint: pluginConvergenceBefore.fingerprint,
  idempotencyKey: "prepare-plugin-convergence-001"
});
const pluginConvergenceApproved = pluginService.decide({
  approvalId: pluginConvergencePrepared.approval.id,
  expectedRevision: pluginConvergencePrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-plugin-convergence-001"
});
const convergenceInventoryStart = pluginInventoryCalls;
const pluginConvergenceExecuted = await pluginService.execute({
  approvalId: pluginConvergenceApproved.approval.id,
  expectedApprovalRevision: pluginConvergenceApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId: pluginConvergenceBefore.id,
  expectedFingerprint: pluginConvergenceBefore.fingerprint,
  idempotencyKey: "execute-plugin-convergence-001"
});
assert.equal(pluginConvergenceExecuted.execution.verificationStatus, "verified");
assert.deepEqual(pluginConvergenceExecuted.execution.observedState, {
  installed: true,
  authPolicy: "ON_USE",
  appsNeedingAuthCount: 0
});
assert.equal(pluginMutationCalls, 3, "Convergence polling must not replay plugin/install");
assert.equal(
  pluginInventoryCalls - convergenceInventoryStart,
  4,
  "Plugin execute should perform one preflight plus three fresh postflight reads before convergence"
);
const convergenceKeys = pluginInventoryKeys.slice(convergenceInventoryStart);
assert.equal(new Set(convergenceKeys).size, convergenceKeys.length);
assert.equal(
  convergenceKeys.filter((key) => key.startsWith("resource-mutation-postflight:")).length,
  3,
  "Every convergence observation must use a fresh postflight inventory key"
);
pluginInstalled = false;
pluginPostflightStaleReadsRemaining = 99;
pluginPostflightStaleInstalled = false;
const pluginExhaustedBefore = pluginResource(false);
const pluginExhaustedPrepared = await pluginService.prepare({
  operation: "plugin.install",
  runtimeProfileId,
  workspaceId,
  resourceId: pluginExhaustedBefore.id,
  expectedFingerprint: pluginExhaustedBefore.fingerprint,
  idempotencyKey: "prepare-plugin-convergence-exhausted-001"
});
const pluginExhaustedApproved = pluginService.decide({
  approvalId: pluginExhaustedPrepared.approval.id,
  expectedRevision: pluginExhaustedPrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-plugin-convergence-exhausted-001"
});
const exhaustedInventoryStart = pluginInventoryCalls;
const pluginExhaustedExecution = await pluginService.execute({
  approvalId: pluginExhaustedApproved.approval.id,
  expectedApprovalRevision: pluginExhaustedApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId: pluginExhaustedBefore.id,
  expectedFingerprint: pluginExhaustedBefore.fingerprint,
  idempotencyKey: "execute-plugin-convergence-exhausted-001"
});
assert.equal(
  pluginExhaustedExecution.execution.verificationStatus,
  "failed-verification"
);
assert.equal(
  pluginExhaustedExecution.execution.errorCode,
  "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED"
);
assert.deepEqual(pluginExhaustedExecution.execution.observedState, {
  installed: false,
  authPolicy: "ON_USE",
  appsNeedingAuthCount: 0
});
assert.equal(
  pluginMutationCalls,
  4,
  "Exhausted convergence polling must still issue plugin/install only once"
);
assert.equal(
  pluginInventoryCalls - exhaustedInventoryStart,
  4,
  "Exhausted Plugin execute should stop after one preflight plus three postflight reads"
);
pluginInstalled = false;
pluginPostflightStaleReadsRemaining = 0;
pluginPostflightStaleInstalled = null;

pluginMutationScenario = "error-after-change";
pluginPostflightStaleReadsRemaining = 1;
pluginPostflightStaleInstalled = false;
const pluginAuthoritativeBefore = pluginResource(false);
const pluginAuthoritativePrepared = await pluginService.prepare({
  operation: "plugin.install",
  runtimeProfileId,
  workspaceId,
  resourceId: pluginAuthoritativeBefore.id,
  expectedFingerprint: pluginAuthoritativeBefore.fingerprint,
  idempotencyKey: "prepare-plugin-authoritative-after-error-001"
});
const pluginAuthoritativeApproved = pluginService.decide({
  approvalId: pluginAuthoritativePrepared.approval.id,
  expectedRevision: pluginAuthoritativePrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-plugin-authoritative-after-error-001"
});
const pluginAuthoritativeExecuted = await pluginService.execute({
  approvalId: pluginAuthoritativeApproved.approval.id,
  expectedApprovalRevision: pluginAuthoritativeApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId: pluginAuthoritativeBefore.id,
  expectedFingerprint: pluginAuthoritativeBefore.fingerprint,
  idempotencyKey: "execute-plugin-authoritative-after-error-001"
});
assert.equal(pluginAuthoritativeExecuted.execution.verificationStatus, "verified");
assert.equal(pluginAuthoritativeExecuted.execution.errorCode, null);
assert.deepEqual(pluginAuthoritativeExecuted.execution.observedState, {
  installed: true
});
assert.equal(
  pluginMutationCalls,
  5,
  "Authoritative convergence after provider error must not replay plugin/install"
);
pluginInstalled = false;
pluginMutationScenario = "success";
pluginPostflightStaleReadsRemaining = 0;
pluginPostflightStaleInstalled = null;

await assert.rejects(
  () =>
    pluginService.prepare({
      operation: "plugin.uninstall",
      runtimeProfileId,
      workspaceId,
      resourceId: pluginBefore.id,
      expectedFingerprint: pluginBefore.fingerprint,
      idempotencyKey: "prepare-plugin-uninstall-noop-001"
    }),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "RUNTIME_RESOURCE_MUTATION_NOOP"
);
assert.equal(pluginMutationCalls, 5);

const safePluginCapabilities = [...pluginBefore.capabilities];
const unsafePluginResources = [
  pluginResourceWith(false, {
    capabilities: safePluginCapabilities.map((capability) =>
      capability === "plugin:auth-policy:on-use"
        ? "plugin:auth-policy:on-install"
        : capability
    )
  }),
  pluginResourceWith(false, {
    capabilities: safePluginCapabilities.map((capability) =>
      capability === "plugin:installation-interstitial:false"
        ? "plugin:installation-interstitial:unknown"
        : capability
    )
  }),
  pluginResourceWith(false, {
    capabilities: safePluginCapabilities.map((capability) =>
      capability === "plugin:source:remote"
        ? "plugin:source:local"
        : capability
    )
  }),
  pluginResourceWith(false, { compatibilityStatus: "blocked" })
];
for (let index = 0; index < unsafePluginResources.length; index += 1) {
  const unsafe = unsafePluginResources[index]!;
  pluginResourceOverride = unsafe;
  await assert.rejects(
    () =>
      pluginService.prepare({
        operation: "plugin.install",
        runtimeProfileId,
        workspaceId,
        resourceId: unsafe.id,
        expectedFingerprint: unsafe.fingerprint,
        idempotencyKey: `prepare-plugin-unsafe-${index}`
      }),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED"
  );
  assert.equal(pluginMutationCalls, 5);
}
pluginResourceOverride = null;

pluginInstalled = false;
pluginMutationScenario = "stale-race";
pluginStaleExternalDesired = true;
const pluginRaceBefore = pluginResource(false);
const pluginRacePrepared = await pluginService.prepare({
  operation: "plugin.install",
  runtimeProfileId,
  workspaceId,
  resourceId: pluginRaceBefore.id,
  expectedFingerprint: pluginRaceBefore.fingerprint,
  idempotencyKey: "prepare-plugin-stale-race-001"
});
const pluginRaceApproved = pluginService.decide({
  approvalId: pluginRacePrepared.approval.id,
  expectedRevision: pluginRacePrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "decide-plugin-stale-race-001"
});
const pluginRaceExecuted = await pluginService.execute({
  approvalId: pluginRaceApproved.approval.id,
  expectedApprovalRevision: pluginRaceApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId: pluginRaceBefore.id,
  expectedFingerprint: pluginRaceBefore.fingerprint,
  idempotencyKey: "execute-plugin-stale-race-001"
});
assert.equal(pluginRaceExecuted.execution.verificationStatus, "stale");
assert.equal(
  pluginRaceExecuted.execution.errorCode,
  "RUNTIME_RESOURCE_MUTATION_STALE"
);
assert.deepEqual(pluginRaceExecuted.execution.observedState, {
  installed: true
});
assert.equal(pluginInstalled, true);
assert.equal(pluginMutationCalls, 6);
pluginInstalled = false;
pluginMutationScenario = "success";
pluginStaleExternalDesired = false;

enabled = true;
mutationScenario = "success";
const legacyObserved = await fakeInventory.inventory({
  runtimeProfileId,
  workspaceId,
  idempotencyKey: "legacy-v1-inventory-001"
});
const legacyBefore = resource(true);
const legacyApprovalRecord = repositories.runtimeResourceMutations.createApproval({
  operation: "skill.disable",
  runtimeProfileId,
  workspaceId,
  resourceId,
  resourceKind: "skill",
  resourceScope: legacyBefore.scope,
  beforeSnapshotId: legacyObserved.snapshot.id,
  beforeFingerprint: legacyBefore.fingerprint,
  requestedState: { enabled: false },
  mutationHash: buildLegacySkillMutationHashV1({
    operation: "skill.disable",
    runtimeProfileId,
    workspaceId,
    resource: legacyBefore,
    beforeSnapshotId: legacyObserved.snapshot.id,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind
  }),
  publicSummary: {
    resourceId,
    displayName: legacyBefore.displayName,
    kind: "skill",
    scope: legacyBefore.scope,
    beforeEnabled: true,
    requestedEnabled: false,
    runtimeProfileId
  },
  expiresAt: "2026-08-10T00:50:00.000Z",
  now: NOW
});
const legacyApproved = service.decide({
  approvalId: legacyApprovalRecord.id,
  expectedRevision: legacyApprovalRecord.revision,
  decision: "approved",
  idempotencyKey: "decide-legacy-v1-skill-001"
});
const legacyExecuted = await service.execute({
  approvalId: legacyApproved.approval.id,
  expectedApprovalRevision: legacyApproved.approval.revision,
  runtimeProfileId,
  workspaceId,
  resourceId,
  expectedFingerprint: legacyBefore.fingerprint,
  idempotencyKey: "execute-legacy-v1-skill-001"
});
assert.equal(legacyExecuted.execution.verificationStatus, "verified");
assert.equal(legacyExecuted.execution.providerMethod, "skills/config/write");
assert.deepEqual(legacyExecuted.execution.observedState, { enabled: false });
assert.equal(enabled, false);

const publicJson = JSON.stringify({
  freshRetryPrepared,
  prepared,
  approved,
  executed,
  permanentlyStale,
  raceExecuted,
  staleDesiredExecuted,
  authoritativeExecuted,
  pluginInstallPrepared,
  pluginInstalledExecution,
  pluginUninstallPrepared,
  pluginUninstalledExecution,
  pluginConvergenceExecuted,
  pluginExhaustedExecution,
  pluginAuthoritativeExecuted,
  pluginRaceExecuted,
  legacyExecuted
});
for (const forbidden of [
  "/private/tokenpilot-runtime-sentinel/mutation-workspace",
  "SKILL.md",
  "rawConfig",
  "authorizationUrl",
  "installUrl",
  "marketplacePath",
  "remoteMarketplaceName"
]) {
  assert.equal(publicJson.includes(forbidden), false);
}

database.close();
process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_SERVICE_OK\n");
