import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.ts";
import {
  hashRuntimeResource,
  hashRuntimeResourceSnapshot
} from "../src/application/runtime-resource-hash.ts";
import { RuntimeResourceMutationPublicService } from "../src/application/runtime-resource-mutation-public-service.ts";
import { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import type { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";

const NOW = "2026-08-11T03:00:00.000Z";
const profileId = "runtime_profile_cross_surface_fixture";
const workspaceId = "workspace_cross_surface_fixture";
const resourceId = "resource_cross_surface_fixture";

const profile: RuntimeProfileDescriptor = {
  id: profileId,
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex",
  executableSource: "bundled",
  executableVersion: "fixture",
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
    runtimeProfileId: profileId,
    kind: "skill" as const,
    externalId: "skill:user:cross-surface-fixture",
    displayName: "Cross Surface Fixture",
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

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);
repositories.projects.create({
  id: "project_cross_surface_fixture",
  slug: "cross-surface-fixture",
  displayName: "Cross Surface Fixture",
  now: NOW
});
repositories.workspaces.create({
  id: workspaceId,
  projectId: "project_cross_surface_fixture",
  repoId: "cross-surface-fixture",
  privatePath: "/private/chatcockpit-runtime-sentinel/cross-surface-workspace",
  status: "ready",
  now: NOW
});

function reviewedSnapshot(resource: RuntimeResourceDescriptor, now: string) {
  return repositories.runtimeResourceSnapshots.create({
    runtimeProfileId: profileId,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    status: "ready",
    profile: profile as unknown as Record<string, unknown>,
    fingerprint: hashRuntimeResourceSnapshot(profile, [resource]),
    items: [
      {
        resourceId: resource.id,
        kind: resource.kind,
        externalId: resource.externalId,
        displayName: resource.displayName,
        description: resource.description,
        scope: resource.scope,
        installed: resource.installed,
        enabled: resource.enabled,
        version: resource.version,
        availableVersion: resource.availableVersion,
        updateStatus: resource.updateStatus,
        authStatus: resource.authStatus,
        compatibilityStatus: resource.compatibilityStatus,
        sourceKind: resource.sourceKind,
        sourceLabel: resource.sourceLabel,
        capabilities: resource.capabilities,
        publicReason: resource.publicReason,
        fingerprint: resource.fingerprint
      }
    ],
    now
  });
}

let enabled = true;
let fullInventoryCalls = 0;
let targetReadCalls = 0;
const fakeInventory = {
  inventory: async () => {
    fullInventoryCalls += 1;
    throw new Error("FULL_INVENTORY_MUST_NOT_BE_CALLED");
  },
  inspectSnapshotResource: (snapshotId: string, targetResourceId: string) => {
    const snapshot = repositories.runtimeResourceSnapshots.get(snapshotId);
    const item = snapshot.items.find((entry) => entry.resourceId === targetResourceId);
    assert.ok(item);
    return {
      snapshot,
      resource: {
        id: item.resourceId,
        runtimeProfileId: snapshot.runtimeProfileId,
        kind: item.kind,
        externalId: item.externalId,
        displayName: item.displayName,
        description: item.description,
        scope: item.scope,
        installed: item.installed,
        enabled: item.enabled,
        version: item.version,
        availableVersion: item.availableVersion,
        updateStatus: item.updateStatus,
        authStatus: item.authStatus,
        compatibilityStatus: item.compatibilityStatus,
        sourceKind: item.sourceKind,
        sourceLabel: item.sourceLabel,
        capabilities: [...item.capabilities],
        publicReason: item.publicReason,
        fingerprint: item.fingerprint
      }
    };
  },
  readTarget: async (input: {
    runtimeProfileId: string;
    workspaceId?: string;
    resourceId: string;
    resourceKind: "skill" | "plugin";
  }) => {
    assert.equal(input.runtimeProfileId, profileId);
    assert.equal(input.workspaceId, workspaceId);
    assert.equal(input.resourceId, resourceId);
    assert.equal(input.resourceKind, "skill");
    targetReadCalls += 1;
    return {
      profile,
      resource: skill(enabled),
      diagnostics: []
    };
  }
} as unknown as RuntimeResourceInventoryService;

let providerWrites = 0;
const fakeSkillMutation = {
  setEnabled: async (input: {
    desiredEnabled: boolean;
    expectedFingerprint: string;
  }) => {
    providerWrites += 1;
    assert.equal(input.expectedFingerprint, skill(enabled).fingerprint);
    enabled = input.desiredEnabled;
    return { effectiveEnabled: enabled };
  }
} as unknown as CodexSkillMutationAdapter;

const mutation = new RuntimeResourceMutationService(
  repositories,
  fakeInventory,
  fakeSkillMutation,
  { now: () => NOW }
);
const publicMutations = new RuntimeResourceMutationPublicService(
  repositories,
  fakeInventory,
  { pluginMutationAvailable: false }
);

const remoteContext = (stage: string) =>
  buildOperationContext({
    requestId: `remote-mcp:${stage}:request`,
    actorType: "remote-mcp",
    actorId: "remote-client-subject",
    publicProjection: true,
    now: NOW
  });
const operatorContext = (stage: string) =>
  buildOperationContext({
    requestId: `rest-api:${stage}:request`,
    actorType: "rest-api",
    actorId: "operator-api-token",
    publicProjection: true,
    now: NOW
  });
const runnerContext = (stage: string) =>
  buildOperationContext({
    requestId: `runner:${stage}:request`,
    actorType: "runner",
    actorId: "fixture-runner",
    now: NOW
  });

const before = skill(true);
const firstSnapshot = reviewedSnapshot(before, NOW);
const prepared = await mutation.prepare(remoteContext("prepare"), {
  operation: "skill.disable",
  runtimeProfileId: profileId,
  workspaceId,
  resourceId,
  expectedSnapshotId: firstSnapshot.id,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "cross-surface-prepare-0001"
});
assert.equal(prepared.approval.requestedActorType, "remote-mcp");
assert.equal(providerWrites, 0);

assert.throws(
  () =>
    mutation.decide(remoteContext("forbidden-decision"), {
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved",
      idempotencyKey: "cross-surface-remote-decision-0001"
    }),
  (error: unknown) =>
    error instanceof ServiceError &&
    error.code === "RUNTIME_RESOURCE_MUTATION_DECISION_FORBIDDEN"
);
assert.equal(
  repositories.runtimeResourceMutations.getApproval(prepared.approval.id).status,
  "pending"
);
assert.equal(providerWrites, 0);

const approved = mutation.decide(operatorContext("decision"), {
  approvalId: prepared.approval.id,
  expectedRevision: prepared.approval.revision,
  decision: "approved",
  idempotencyKey: "cross-surface-operator-decision-0001"
});
assert.equal(approved.approval.decidedActorType, "rest-api");

const executed = await mutation.execute(remoteContext("execute"), {
  approvalId: approved.approval.id,
  expectedApprovalRevision: approved.approval.revision,
  runtimeProfileId: profileId,
  workspaceId,
  resourceId,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "cross-surface-execute-0001"
});
assert.equal(executed.execution.verificationStatus, "verified");
assert.equal(executed.execution.executedActorType, "remote-mcp");
assert.equal(providerWrites, 1);
assert.equal(enabled, false);

const replay = await mutation.execute(remoteContext("execute-retry"), {
  approvalId: approved.approval.id,
  expectedApprovalRevision: approved.approval.revision,
  runtimeProfileId: profileId,
  workspaceId,
  resourceId,
  expectedFingerprint: before.fingerprint,
  idempotencyKey: "cross-surface-execute-0001"
});
assert.equal(replay.replayed, true);
assert.equal(replay.execution.id, executed.execution.id);
assert.equal(providerWrites, 1, "Remote MCP execute replay must not replay provider write");

const approvalProjection = publicMutations.getApproval({
  workspaceId,
  approvalId: prepared.approval.id
});
const executionProjection = publicMutations.getExecution({
  workspaceId,
  executionId: executed.execution.id
});
assert.equal(approvalProjection.requestedActor?.type, "remote-mcp");
assert.equal(approvalProjection.decidedActor?.type, "rest-api");
assert.equal(executionProjection.executedActor?.type, "remote-mcp");
const publicJson = JSON.stringify({ approvalProjection, executionProjection });
for (const forbidden of [
  "remote-client-subject",
  "operator-api-token",
  "remote-mcp:prepare:request",
  "rest-api:decision:request",
  "requestedRequestIdentityHash",
  "decidedRequestIdentityHash",
  "executedRequestIdentityHash"
]) {
  assert.equal(publicJson.includes(forbidden), false, `Public projection leaked ${forbidden}`);
}

const restoreBefore = skill(false);
const restoreSnapshot = reviewedSnapshot(
  restoreBefore,
  "2026-08-11T03:01:00.000Z"
);
const wrongProvenancePrepared = await mutation.prepare(remoteContext("prepare-wrong"), {
  operation: "skill.enable",
  runtimeProfileId: profileId,
  workspaceId,
  resourceId,
  expectedSnapshotId: restoreSnapshot.id,
  expectedFingerprint: restoreBefore.fingerprint,
  idempotencyKey: "cross-surface-prepare-wrong-0001"
});
const wrongProvenanceApproved = mutation.decide(runnerContext("decision-wrong"), {
  approvalId: wrongProvenancePrepared.approval.id,
  expectedRevision: wrongProvenancePrepared.approval.revision,
  decision: "approved",
  idempotencyKey: "cross-surface-runner-decision-0001"
});
assert.equal(wrongProvenanceApproved.approval.decidedActorType, "runner");
const targetReadsBeforeForbiddenExecute = targetReadCalls;
await assert.rejects(
  () =>
    mutation.execute(remoteContext("execute-wrong"), {
      approvalId: wrongProvenanceApproved.approval.id,
      expectedApprovalRevision: wrongProvenanceApproved.approval.revision,
      runtimeProfileId: profileId,
      workspaceId,
      resourceId,
      expectedFingerprint: restoreBefore.fingerprint,
      idempotencyKey: "cross-surface-execute-wrong-0001"
    }),
  (error: unknown) =>
    error instanceof ServiceError &&
    error.code === "RUNTIME_RESOURCE_MUTATION_EXECUTION_FORBIDDEN"
);
assert.equal(providerWrites, 1, "Wrong decision provenance must fail before provider write");
assert.equal(
  targetReadCalls,
  targetReadsBeforeForbiddenExecute,
  "Wrong decision provenance must fail before authoritative preflight"
);
assert.equal(fullInventoryCalls, 0);

database.close();
process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_CROSS_SURFACE_OK\n");
