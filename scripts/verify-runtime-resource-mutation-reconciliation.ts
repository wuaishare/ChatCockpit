import assert from "node:assert/strict";
import fs from "node:fs";

import {
  hashRuntimeResource,
  hashRuntimeResourceSnapshot
} from "../src/application/runtime-resource-hash.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import type { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import { RuntimeResourceMutationReconciliationService } from "../src/application/runtime-resource-mutation-reconciliation-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const NOW = "2026-08-10T01:00:00.000Z";
const runtimeProfileId = "runtime_profile_reconcile_fixture";
const workspaceId = "workspace_reconcile_fixture";
const resourceId = "resource_reconcile_fixture";

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

function skill(enabled: boolean): RuntimeResourceDescriptor {
  const base = {
    id: resourceId,
    runtimeProfileId,
    kind: "skill" as const,
    externalId: "skill:user:reconcile-fixture",
    displayName: "Reconcile Fixture Skill",
    description: null,
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

function plugin(installed: boolean): RuntimeResourceDescriptor {
  const base = {
    id: "resource_plugin_reconcile_fixture",
    runtimeProfileId,
    kind: "plugin" as const,
    externalId: "plugin:reconcile-fixture@fixture-marketplace",
    displayName: "Reconcile Fixture Plugin",
    description: null,
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

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);
try {
  repositories.projects.create({
    id: "project_reconcile_fixture",
    slug: "reconcile-fixture",
    displayName: "Reconcile Fixture",
    now: NOW
  });
  repositories.workspaces.create({
    id: workspaceId,
    projectId: "project_reconcile_fixture",
    repoId: "repo_reconcile_fixture",
    privatePath: "/private/tokenpilot-runtime-sentinel/reconcile-workspace",
    now: NOW
  });

  const before = skill(true);
  const beforeSnapshot = repositories.runtimeResourceSnapshots.create({
    runtimeProfileId,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    status: "ready",
    profile: profile as unknown as Record<string, unknown>,
    fingerprint: hashRuntimeResourceSnapshot(profile, [before]),
    items: [{
      resourceId: before.id,
      kind: before.kind,
      externalId: before.externalId,
      displayName: before.displayName,
      description: before.description,
      scope: before.scope,
      installed: before.installed,
      enabled: before.enabled,
      version: before.version,
      availableVersion: before.availableVersion,
      updateStatus: before.updateStatus,
      authStatus: before.authStatus,
      compatibilityStatus: before.compatibilityStatus,
      sourceKind: before.sourceKind,
      sourceLabel: before.sourceLabel,
      capabilities: before.capabilities,
      publicReason: before.publicReason,
      fingerprint: before.fingerprint
    }],
    now: NOW
  });

  const createStuckExecution = (suffix: string, mutationHash: string) => {
    const pending = repositories.runtimeResourceMutations.createApproval({
      id: `approval_${suffix}`,
      operation: "skill.disable",
      runtimeProfileId,
      workspaceId,
      resourceId,
      resourceKind: "skill",
      resourceScope: "user",
      beforeSnapshotId: beforeSnapshot.id,
      beforeFingerprint: before.fingerprint,
      requestedState: { enabled: false },
      mutationHash,
      publicSummary: {
        resourceId,
        displayName: before.displayName,
        beforeEnabled: true,
        requestedEnabled: false
      },
      expiresAt: "2026-08-10T01:05:00.000Z",
      now: NOW
    });
    const approved = repositories.runtimeResourceMutations.decide({
      id: pending.id,
      decision: "approved",
      expectedRevision: pending.revision,
      now: NOW
    });
    const consumed = repositories.runtimeResourceMutations.consume({
      id: approved.id,
      expectedRevision: approved.revision,
      now: NOW
    });
    return repositories.runtimeResourceMutations.createExecution({
      id: `execution_${suffix}`,
      approval: consumed,
      providerMethod: "skills/config/write",
      now: NOW
    });
  };

  const execution = createStuckExecution("verified", "a".repeat(64));
  assert.equal(execution.verificationStatus, "executing");

  let inventoryCalls = 0;
  let observedEnabled = false;
  const inventoryKeys: string[] = [];
  const fakeInventory = {
    inventory: async (input: {
      runtimeProfileId: string;
      workspaceId?: string;
      idempotencyKey: string;
    }) => {
      inventoryCalls += 1;
      inventoryKeys.push(input.idempotencyKey);
      assert.equal(input.runtimeProfileId, runtimeProfileId);
      assert.equal(input.workspaceId, workspaceId);
      assert.ok(input.idempotencyKey.startsWith("resource-mutation-reconcile:"));
      const after = skill(observedEnabled);
      const snapshot = repositories.runtimeResourceSnapshots.create({
        runtimeProfileId,
        providerKind: profile.providerKind,
        protocolKind: profile.protocolKind,
        status: "ready",
        profile: profile as unknown as Record<string, unknown>,
        fingerprint: hashRuntimeResourceSnapshot(profile, [after]),
        items: [{
          resourceId: after.id,
          kind: after.kind,
          externalId: after.externalId,
          displayName: after.displayName,
          description: after.description,
          scope: after.scope,
          installed: after.installed,
          enabled: after.enabled,
          version: after.version,
          availableVersion: after.availableVersion,
          updateStatus: after.updateStatus,
          authStatus: after.authStatus,
          compatibilityStatus: after.compatibilityStatus,
          sourceKind: after.sourceKind,
          sourceLabel: after.sourceLabel,
          capabilities: after.capabilities,
          publicReason: after.publicReason,
          fingerprint: after.fingerprint
        }],
        now: new Date(Date.parse(NOW) + inventoryCalls * 1000).toISOString()
      });
      return {
        snapshot,
        profile,
        resources: [after],
        diagnostics: [],
        diff: {
          previousSnapshotId: beforeSnapshot.id,
          added: [],
          removed: [],
          changed: [resourceId],
          unchanged: []
        },
        replayed: false
      };
    }
  } as unknown as RuntimeResourceInventoryService;

  const reconciliation = new RuntimeResourceMutationReconciliationService(
    repositories,
    fakeInventory,
    { now: () => "2026-08-10T01:00:02.000Z" }
  );
  const reconciled = await reconciliation.reconcile({
    executionId: execution.id,
    idempotencyKey: "reconcile-001"
  });
  assert.equal(reconciled.replayed, false);
  assert.equal(reconciled.execution.verificationStatus, "verified");
  assert.deepEqual(reconciled.execution.observedState, { enabled: false });
  assert.equal(reconciled.execution.afterFingerprint, skill(false).fingerprint);
  assert.equal(inventoryCalls, 1);

  const replay = await reconciliation.reconcile({
    executionId: execution.id,
    idempotencyKey: "reconcile-001"
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.execution.id, execution.id);
  assert.equal(inventoryCalls, 1, "Reconciliation replay must not refresh Runtime again");

  const mismatchExecution = createStuckExecution("mismatch", "b".repeat(64));
  observedEnabled = true;
  const mismatch = await reconciliation.reconcile({
    executionId: mismatchExecution.id,
    idempotencyKey: "reconcile-mismatch-001"
  });
  assert.equal(mismatch.replayed, false);
  assert.equal(mismatch.execution.verificationStatus, "failed-verification");
  assert.equal(
    mismatch.execution.errorCode,
    "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED"
  );
  assert.deepEqual(mismatch.execution.observedState, { enabled: true });
  assert.equal(mismatch.execution.afterFingerprint, skill(true).fingerprint);
  assert.equal(inventoryCalls, 2);
  assert.notEqual(
    inventoryKeys[0],
    inventoryKeys[1],
    "Independent reconciliation attempts must read independently fresh Runtime truth"
  );

  const createPluginStuckExecution = (
    suffix: string,
    operation: "plugin.install" | "plugin.uninstall",
    beforeInstalled: boolean
  ) => {
    const pluginBefore = plugin(beforeInstalled);
    const pluginBeforeSnapshot = repositories.runtimeResourceSnapshots.create({
      runtimeProfileId,
      providerKind: profile.providerKind,
      protocolKind: profile.protocolKind,
      status: "ready",
      profile: profile as unknown as Record<string, unknown>,
      fingerprint: hashRuntimeResourceSnapshot(profile, [pluginBefore]),
      items: [
        {
          resourceId: pluginBefore.id,
          kind: pluginBefore.kind,
          externalId: pluginBefore.externalId,
          displayName: pluginBefore.displayName,
          description: pluginBefore.description,
          scope: pluginBefore.scope,
          installed: pluginBefore.installed,
          enabled: pluginBefore.enabled,
          version: pluginBefore.version,
          availableVersion: pluginBefore.availableVersion,
          updateStatus: pluginBefore.updateStatus,
          authStatus: pluginBefore.authStatus,
          compatibilityStatus: pluginBefore.compatibilityStatus,
          sourceKind: pluginBefore.sourceKind,
          sourceLabel: pluginBefore.sourceLabel,
          capabilities: pluginBefore.capabilities,
          publicReason: pluginBefore.publicReason,
          fingerprint: pluginBefore.fingerprint
        }
      ],
      now: "2026-08-10T01:01:00.000Z"
    });
    const desiredInstalled = operation === "plugin.install";
    const pending = repositories.runtimeResourceMutations.createApproval({
      id: `approval_plugin_${suffix}`,
      operation,
      runtimeProfileId,
      workspaceId,
      resourceId: pluginBefore.id,
      resourceKind: "plugin",
      resourceScope: "runtime",
      beforeSnapshotId: pluginBeforeSnapshot.id,
      beforeFingerprint: pluginBefore.fingerprint,
      requestedState: { installed: desiredInstalled },
      mutationHash: "c".repeat(64),
      publicSummary: {
        resourceId: pluginBefore.id,
        displayName: pluginBefore.displayName,
        beforeInstalled,
        requestedInstalled: desiredInstalled
      },
      expiresAt: "2026-08-10T01:05:00.000Z",
      now: NOW
    });
    const approved = repositories.runtimeResourceMutations.decide({
      id: pending.id,
      decision: "approved",
      expectedRevision: pending.revision,
      now: NOW
    });
    const consumed = repositories.runtimeResourceMutations.consume({
      id: approved.id,
      expectedRevision: approved.revision,
      now: NOW
    });
    return repositories.runtimeResourceMutations.createExecution({
      id: `execution_plugin_${suffix}`,
      approval: consumed,
      providerMethod:
        operation === "plugin.install" ? "plugin/install" : "plugin/uninstall",
      now: NOW
    });
  };

  let pluginObserved: boolean | "missing" = true;
  let pluginInventoryCalls = 0;
  const fakePluginInventory = {
    inventory: async (input: {
      runtimeProfileId: string;
      workspaceId?: string;
      idempotencyKey: string;
    }) => {
      pluginInventoryCalls += 1;
      assert.equal(input.runtimeProfileId, runtimeProfileId);
      assert.equal(input.workspaceId, workspaceId);
      assert.ok(input.idempotencyKey.startsWith("resource-mutation-reconcile:"));
      const resources =
        pluginObserved === "missing" ? [] : [plugin(pluginObserved)];
      const snapshot = repositories.runtimeResourceSnapshots.create({
        runtimeProfileId,
        providerKind: profile.providerKind,
        protocolKind: profile.protocolKind,
        status: "ready",
        profile: profile as unknown as Record<string, unknown>,
        fingerprint: hashRuntimeResourceSnapshot(profile, resources),
        items: resources.map((entry) => ({
          resourceId: entry.id,
          kind: entry.kind,
          externalId: entry.externalId,
          displayName: entry.displayName,
          description: entry.description,
          scope: entry.scope,
          installed: entry.installed,
          enabled: entry.enabled,
          version: entry.version,
          availableVersion: entry.availableVersion,
          updateStatus: entry.updateStatus,
          authStatus: entry.authStatus,
          compatibilityStatus: entry.compatibilityStatus,
          sourceKind: entry.sourceKind,
          sourceLabel: entry.sourceLabel,
          capabilities: entry.capabilities,
          publicReason: entry.publicReason,
          fingerprint: entry.fingerprint
        })),
        now: new Date(
          Date.parse(NOW) + 10_000 + pluginInventoryCalls * 1000
        ).toISOString()
      });
      return {
        snapshot,
        profile,
        resources,
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
  const pluginReconciliation = new RuntimeResourceMutationReconciliationService(
    repositories,
    fakePluginInventory,
    { now: () => "2026-08-10T01:00:03.000Z" }
  );

  const pluginInstallExecution = createPluginStuckExecution(
    "install_verified",
    "plugin.install",
    false
  );
  pluginObserved = true;
  const pluginInstallReconciled = await pluginReconciliation.reconcile({
    executionId: pluginInstallExecution.id,
    idempotencyKey: "reconcile-plugin-install-verified-001"
  });
  assert.equal(
    pluginInstallReconciled.execution.verificationStatus,
    "verified"
  );
  assert.deepEqual(pluginInstallReconciled.execution.observedState, {
    installed: true
  });

  const pluginInstallMismatchExecution = createPluginStuckExecution(
    "install_mismatch",
    "plugin.install",
    false
  );
  pluginObserved = false;
  const pluginInstallMismatch = await pluginReconciliation.reconcile({
    executionId: pluginInstallMismatchExecution.id,
    idempotencyKey: "reconcile-plugin-install-mismatch-001"
  });
  assert.equal(
    pluginInstallMismatch.execution.verificationStatus,
    "failed-verification"
  );
  assert.deepEqual(pluginInstallMismatch.execution.observedState, {
    installed: false
  });

  const pluginUninstallExecution = createPluginStuckExecution(
    "uninstall_verified",
    "plugin.uninstall",
    true
  );
  pluginObserved = false;
  const pluginUninstallReconciled = await pluginReconciliation.reconcile({
    executionId: pluginUninstallExecution.id,
    idempotencyKey: "reconcile-plugin-uninstall-verified-001"
  });
  assert.equal(
    pluginUninstallReconciled.execution.verificationStatus,
    "verified"
  );
  assert.deepEqual(pluginUninstallReconciled.execution.observedState, {
    installed: false
  });

  const pluginUninstallMissingExecution = createPluginStuckExecution(
    "uninstall_missing",
    "plugin.uninstall",
    true
  );
  pluginObserved = "missing";
  const pluginUninstallMissing = await pluginReconciliation.reconcile({
    executionId: pluginUninstallMissingExecution.id,
    idempotencyKey: "reconcile-plugin-uninstall-missing-001"
  });
  assert.equal(
    pluginUninstallMissing.execution.verificationStatus,
    "failed-verification"
  );
  assert.deepEqual(pluginUninstallMissing.execution.observedState, {
    missing: true
  });

  const reconciliationSource = fs.readFileSync(
    new URL(
      "../src/application/runtime-resource-mutation-reconciliation-service.ts",
      import.meta.url
    ),
    "utf8"
  );
  for (const forbiddenDependency of [
    "CodexSkillMutationAdapter",
    "CodexPluginMutationAdapter",
    "CodexAppServerClient",
    ".setEnabled(",
    ".install(",
    ".uninstall("
  ]) {
    assert.equal(
      reconciliationSource.includes(forbiddenDependency),
      false,
      `Crash reconciliation must remain provider-write-free: ${forbiddenDependency}`
    );
  }

  const persisted = JSON.stringify({
    reconciled,
    replay,
    mismatch,
    pluginInstallReconciled,
    pluginInstallMismatch,
    pluginUninstallReconciled,
    pluginUninstallMissing
  });
  for (const forbidden of [
    "/private/tokenpilot-runtime-sentinel/reconcile-workspace",
    "SKILL.md",
    "skills/config/write" + ":{",
    "authorizationUrl"
  ]) {
    assert.equal(persisted.includes(forbidden), false);
  }

  process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_RECONCILIATION_OK\n");
} finally {
  database.close();
}
