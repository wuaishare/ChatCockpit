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
import { ServiceError } from "../src/application/service-error.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";

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

// A failed outer prepare must not pin a reusable inner inventory key. Retrying
// the exact same operation after Runtime state changes must read fresh truth.
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

// A race discovered by the private adapter after preflight is a stale
// execution, not a generic provider failure. The adapter does not mutate.
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

// If the provider transport reports an error after the Runtime already applied
// the state, authoritative postflight truth wins and the execution is verified.
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
assert.equal(mutationCalls, 3);
mutationScenario = "success";

const publicJson = JSON.stringify({
  freshRetryPrepared,
  prepared,
  approved,
  executed,
  raceExecuted,
  authoritativeExecuted
});
for (const forbidden of [
  "/private/tokenpilot-runtime-sentinel/mutation-workspace",
  "SKILL.md",
  "rawConfig",
  "authorizationUrl"
]) {
  assert.equal(publicJson.includes(forbidden), false);
}

database.close();
process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_SERVICE_OK\n");
