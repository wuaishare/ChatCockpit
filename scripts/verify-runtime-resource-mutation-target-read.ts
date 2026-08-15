import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.ts";
import { hashRuntimeResource, hashRuntimeResourceSnapshot } from "../src/application/runtime-resource-hash.ts";
import { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import type { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";

const NOW = "2026-08-11T01:00:00.000Z";
const profileId = "runtime_profile_target_read_fixture";
const workspaceId = "workspace_target_read_fixture";
const resourceId = "resource_target_read_fixture";

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
    externalId: "skill:user:target-read-fixture",
    displayName: "Target Read Fixture",
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
  id: "project_target_read_fixture",
  slug: "target-read-fixture",
  displayName: "Target Read Fixture",
  now: NOW
});
repositories.workspaces.create({
  id: workspaceId,
  projectId: "project_target_read_fixture",
  repoId: "target-read-fixture",
  privatePath: "/private/chatcockpit-runtime-sentinel/target-read-workspace",
  status: "ready",
  now: NOW
});

let enabled = true;
const reviewed = skill(true);
const reviewedSnapshot = repositories.runtimeResourceSnapshots.create({
  runtimeProfileId: profileId,
  providerKind: profile.providerKind,
  protocolKind: profile.protocolKind,
  status: "ready",
  profile: profile as unknown as Record<string, unknown>,
  fingerprint: hashRuntimeResourceSnapshot(profile, [reviewed]),
  items: [
    {
      resourceId: reviewed.id,
      kind: reviewed.kind,
      externalId: reviewed.externalId,
      displayName: reviewed.displayName,
      description: reviewed.description,
      scope: reviewed.scope,
      installed: reviewed.installed,
      enabled: reviewed.enabled,
      version: reviewed.version,
      availableVersion: reviewed.availableVersion,
      updateStatus: reviewed.updateStatus,
      authStatus: reviewed.authStatus,
      compatibilityStatus: reviewed.compatibilityStatus,
      sourceKind: reviewed.sourceKind,
      sourceLabel: reviewed.sourceLabel,
      capabilities: reviewed.capabilities,
      publicReason: reviewed.publicReason,
      fingerprint: reviewed.fingerprint
    }
  ],
  now: NOW
});

let fullInventoryCalls = 0;
let targetReadCalls = 0;
const targetReadKinds: string[] = [];
const fakeInventory = {
  inventory: async () => {
    fullInventoryCalls += 1;
    throw new Error("FULL_INVENTORY_MUST_NOT_BE_CALLED");
  },
  inspectSnapshotResource: (snapshotId: string, targetResourceId: string) => {
    assert.equal(targetResourceId, resourceId);
    const snapshot = repositories.runtimeResourceSnapshots.get(snapshotId);
    const item = snapshot.items.find((entry) => entry.resourceId === targetResourceId);
    assert.ok(item, "Target Resource must exist in reviewed snapshot fixture");
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
    targetReadKinds.push(input.resourceKind);
    return {
      profile,
      resource: skill(enabled),
      diagnostics: [
        {
          source: "codex-skills-target",
          status: "ready" as const,
          code: null,
          message: null
        }
      ]
    };
  }
} as unknown as RuntimeResourceInventoryService;

let providerWrites = 0;
const fakeSkillMutation = {
  setEnabled: async (input: {
    profile: RuntimeProfileDescriptor;
    workspaceId: string;
    resourceId: string;
    expectedFingerprint: string;
    desiredEnabled: boolean;
  }) => {
    providerWrites += 1;
    assert.equal(input.profile.id, profileId);
    assert.equal(input.workspaceId, workspaceId);
    assert.equal(input.resourceId, resourceId);
    assert.equal(input.expectedFingerprint, skill(enabled).fingerprint);
    enabled = input.desiredEnabled;
    return { effectiveEnabled: enabled };
  }
} as unknown as CodexSkillMutationAdapter;

const service = new RuntimeResourceMutationService(
  repositories,
  fakeInventory,
  fakeSkillMutation,
  { now: () => NOW }
);
const context = (stage: string) =>
  buildOperationContext({
    requestId: `target-read:${stage}:request`,
    actorType: "rest-api",
    actorId: "target-read-operator",
    now: NOW
  });

const prepared = await service.prepare(context("prepare"), {
  operation: "skill.disable",
  runtimeProfileId: profileId,
  workspaceId,
  resourceId,
  expectedSnapshotId: reviewedSnapshot.id,
  expectedFingerprint: reviewed.fingerprint,
  idempotencyKey: "target-read-prepare-0001"
} as Parameters<RuntimeResourceMutationService["prepare"]>[1] & {
  expectedSnapshotId: string;
});
assert.equal(prepared.approval.beforeSnapshotId, reviewedSnapshot.id);
assert.equal(prepared.approval.beforeFingerprint, reviewed.fingerprint);
assert.equal(targetReadCalls, 1);
assert.equal(fullInventoryCalls, 0);
assert.equal(providerWrites, 0);

const approved = service.decide(context("decision"), {
  approvalId: prepared.approval.id,
  expectedRevision: prepared.approval.revision,
  decision: "approved",
  idempotencyKey: "target-read-decision-0001"
});

const executed = await service.execute(context("execute"), {
  approvalId: approved.approval.id,
  expectedApprovalRevision: approved.approval.revision,
  runtimeProfileId: profileId,
  workspaceId,
  resourceId,
  expectedFingerprint: reviewed.fingerprint,
  idempotencyKey: "target-read-execute-0001"
});
assert.equal(executed.execution.verificationStatus, "verified");
assert.equal(executed.execution.afterSnapshotId, null);
assert.equal(executed.execution.afterFingerprint, skill(false).fingerprint);
assert.deepEqual(executed.execution.observedState, { enabled: false });
assert.equal(providerWrites, 1);
assert.equal(targetReadCalls, 3, "prepare + execute preflight + postflight must use target reads");
assert.deepEqual(targetReadKinds, ["skill", "skill", "skill"]);
assert.equal(fullInventoryCalls, 0);

const replay = await service.execute(context("execute-replay"), {
  approvalId: approved.approval.id,
  expectedApprovalRevision: approved.approval.revision,
  runtimeProfileId: profileId,
  workspaceId,
  resourceId,
  expectedFingerprint: reviewed.fingerprint,
  idempotencyKey: "target-read-execute-0001"
});
assert.equal(replay.replayed, true);
assert.equal(providerWrites, 1);
assert.equal(targetReadCalls, 3);
assert.equal(fullInventoryCalls, 0);

const staleReviewedSnapshot = repositories.runtimeResourceSnapshots.create({
  runtimeProfileId: profileId,
  providerKind: profile.providerKind,
  protocolKind: profile.protocolKind,
  status: "ready",
  profile: profile as unknown as Record<string, unknown>,
  fingerprint: hashRuntimeResourceSnapshot(profile, [skill(false)]),
  items: [
    {
      ...reviewedSnapshot.items[0]!,
      enabled: false,
      fingerprint: skill(false).fingerprint
    }
  ],
  now: "2026-08-11T01:01:00.000Z"
});
await assert.rejects(
  () =>
    service.prepare(context("stale-reviewed"), {
      operation: "skill.enable",
      runtimeProfileId: profileId,
      workspaceId,
      resourceId,
      expectedSnapshotId: staleReviewedSnapshot.id,
      expectedFingerprint: reviewed.fingerprint,
      idempotencyKey: "target-read-stale-reviewed-0001"
    } as Parameters<RuntimeResourceMutationService["prepare"]>[1] & {
      expectedSnapshotId: string;
    }),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "RUNTIME_RESOURCE_MUTATION_STALE"
);
assert.equal(providerWrites, 1, "stale reviewed snapshot must fail before provider write");
assert.equal(fullInventoryCalls, 0);

database.close();
process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_TARGET_READ_OK\n");
