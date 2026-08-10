import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.ts";
import { hashRuntimeResourceSnapshot } from "../src/application/runtime-resource-hash.ts";
import { RuntimeResourceMutationPublicService } from "../src/application/runtime-resource-mutation-public-service.ts";
import { buildRuntimeResourceMutationProvenance } from "../src/application/runtime-resource-mutation-provenance.ts";
import { buildRuntimeResourceServices } from "../src/application/runtime-resource-services.ts";
import { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type {
  RuntimeResourceMutationApprovalRecord,
  RuntimeResourceMutationOperation
} from "../src/continuity/repositories/runtime-resource-mutation-repository.ts";
import { RuntimeProfileRegistry } from "../src/runtime/resources/runtime-profile-registry.ts";
import { RuntimeResourceInventoryAdapterRegistry } from "../src/runtime/resources/runtime-resource-inventory-adapter-registry.ts";

const NOW = "2026-08-10T19:00:00.000Z";
const workspaceA = "workspace_mutation_read_a";
const workspaceB = "workspace_mutation_read_b";
const profile: RuntimeProfileDescriptor = {
  id: "runtime_profile_mutation_read_fixture",
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex",
  executableSource: "bundled",
  executableVersion: "fixture",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.skills", "resources.plugins"],
  publicReason: null
};

const skillResource: RuntimeResourceDescriptor = {
  id: "resource_mutation_read_skill",
  runtimeProfileId: profile.id,
  kind: "skill",
  externalId: "skill:user:read-model-fixture",
  displayName: "Read Model Skill",
  description: null,
  scope: "user",
  installed: true,
  enabled: false,
  version: null,
  availableVersion: null,
  updateStatus: "not-applicable",
  authStatus: "not-applicable",
  compatibilityStatus: "ready",
  sourceKind: "runtime-native",
  sourceLabel: "Codex",
  capabilities: ["instruction"],
  publicReason: null,
  fingerprint: "1".repeat(64)
};
const pluginResource: RuntimeResourceDescriptor = {
  id: "resource_mutation_read_plugin",
  runtimeProfileId: profile.id,
  kind: "plugin",
  externalId: "plugin:read-model-fixture@catalog",
  displayName: "Read Model Plugin",
  description: null,
  scope: "runtime",
  installed: false,
  enabled: false,
  version: null,
  availableVersion: "1.0.0",
  updateStatus: "not-applicable",
  authStatus: "unknown",
  compatibilityStatus: "ready",
  sourceKind: "runtime-native",
  sourceLabel: "Codex:catalog",
  capabilities: [
    "plugin:source:remote",
    "plugin:install-policy:available",
    "plugin:auth-policy:on-use",
    "plugin:installation-interstitial:false",
    "plugin:observed:catalog"
  ],
  publicReason: null,
  fingerprint: "2".repeat(64)
};

const requestedActor = buildRuntimeResourceMutationProvenance(
  buildOperationContext({
    requestId: "read-model-request",
    actorType: "remote-mcp",
    actorId: "raw-client-subject-must-not-project",
    now: NOW
  })
);
const decidedActor = buildRuntimeResourceMutationProvenance(
  buildOperationContext({
    requestId: "read-model-decision",
    actorType: "rest-api",
    actorId: "raw-operator-subject-must-not-project",
    now: NOW
  })
);
const executedActor = buildRuntimeResourceMutationProvenance(
  buildOperationContext({
    requestId: "read-model-execute",
    actorType: "remote-mcp",
    actorId: "raw-client-subject-must-not-project",
    now: NOW
  })
);

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);
try {
  repositories.projects.create({
    id: "project_mutation_read_fixture",
    slug: "mutation-read-fixture",
    displayName: "Mutation Read Fixture",
    now: NOW
  });
  for (const [workspaceId, repoId] of [
    [workspaceA, "repo_mutation_read_a"],
    [workspaceB, "repo_mutation_read_b"]
  ] as const) {
    repositories.workspaces.create({
      id: workspaceId,
      projectId: "project_mutation_read_fixture",
      repoId,
      privatePath: `/private/tokenpilot-runtime-sentinel/${repoId}`,
      now: NOW
    });
  }

  const snapshot = repositories.runtimeResourceSnapshots.create({
    id: "resource_snapshot_mutation_read_fixture",
    runtimeProfileId: profile.id,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    status: "ready",
    profile: profile as unknown as Record<string, unknown>,
    fingerprint: hashRuntimeResourceSnapshot(profile, [skillResource, pluginResource]),
    items: [skillResource, pluginResource].map((resource) => ({
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
    })),
    now: NOW
  });

  function createApproval(input: {
    id: string;
    workspaceId: string;
    resource: RuntimeResourceDescriptor;
    operation: RuntimeResourceMutationOperation;
    now: string;
    privateSummary?: boolean;
  }): RuntimeResourceMutationApprovalRecord {
    const requestedState = input.operation.startsWith("skill.")
      ? { enabled: input.operation === "skill.enable" }
      : { installed: input.operation === "plugin.install" };
    return repositories.runtimeResourceMutations.createApproval({
      id: input.id,
      operation: input.operation,
      runtimeProfileId: profile.id,
      workspaceId: input.workspaceId,
      resourceId: input.resource.id,
      resourceKind: input.resource.kind as "skill" | "plugin",
      resourceScope: input.resource.scope,
      beforeSnapshotId: snapshot.id,
      beforeFingerprint: input.resource.fingerprint,
      requestedState,
      mutationHash: "a".repeat(64),
      publicSummary: {
        resourceId: input.resource.id,
        displayName: input.resource.displayName,
        kind: input.resource.kind,
        scope: input.resource.scope,
        runtimeProfileId: profile.id,
        ...(input.operation.startsWith("skill.")
          ? {
              beforeEnabled: input.resource.enabled,
              requestedEnabled: requestedState.enabled
            }
          : {
              beforeInstalled: input.resource.installed,
              requestedInstalled: requestedState.installed
            }),
        ...(input.privateSummary
          ? {
              sourceIdentityHash: "private-source-identity",
              remotePluginId: "private-remote-plugin-id",
              marketplacePath: "/private/marketplace/path",
              installUrl: "https://private.invalid/install"
            }
          : {})
      },
      requestedActor,
      expiresAt: "2026-08-10T20:00:00.000Z",
      now: input.now
    });
  }

  const pendingA = createApproval({
    id: "approval_read_pending_a",
    workspaceId: workspaceA,
    resource: skillResource,
    operation: "skill.enable",
    now: "2026-08-10T19:01:00.000Z"
  });
  const deniedA = createApproval({
    id: "approval_read_denied_a",
    workspaceId: workspaceA,
    resource: skillResource,
    operation: "skill.enable",
    now: "2026-08-10T19:02:00.000Z"
  });
  repositories.runtimeResourceMutations.decide({
    id: deniedA.id,
    decision: "denied",
    expectedRevision: deniedA.revision,
    decidedActor,
    now: "2026-08-10T19:02:30.000Z"
  });

  const consumedA = createApproval({
    id: "approval_read_consumed_a",
    workspaceId: workspaceA,
    resource: pluginResource,
    operation: "plugin.install",
    now: "2026-08-10T19:03:00.000Z",
    privateSummary: true
  });
  const approvedA = repositories.runtimeResourceMutations.decide({
    id: consumedA.id,
    decision: "approved",
    expectedRevision: consumedA.revision,
    decidedActor,
    now: "2026-08-10T19:03:30.000Z"
  });
  const consumedARecord = repositories.runtimeResourceMutations.consume({
    id: approvedA.id,
    expectedRevision: approvedA.revision,
    now: "2026-08-10T19:04:00.000Z"
  });
  const executionA = repositories.runtimeResourceMutations.createExecution({
    id: "execution_read_a",
    approval: consumedARecord,
    providerMethod: "plugin/install",
    executedActor,
    now: "2026-08-10T19:04:30.000Z"
  });
  repositories.runtimeResourceMutations.finishExecution({
    id: executionA.id,
    status: "verified",
    afterSnapshotId: snapshot.id,
    afterFingerprint: "3".repeat(64),
    observedState: {
      installed: true,
      authPolicy: "ON_USE",
      appsNeedingAuthCount: 0,
      installUrl: "https://private.invalid/should-not-project"
    },
    now: "2026-08-10T19:05:00.000Z"
  });

  const pendingB = createApproval({
    id: "approval_read_pending_b",
    workspaceId: workspaceB,
    resource: skillResource,
    operation: "skill.enable",
    now: "2026-08-10T19:06:00.000Z"
  });

  assert.throws(
    () =>
      (repositories.runtimeResourceMutations.listApprovals as unknown as (input: object) => unknown)(
        {}
      ),
    /workspace/i
  );
  assert.throws(
    () =>
      (repositories.runtimeResourceMutations.listExecutions as unknown as (input: object) => unknown)(
        {}
      ),
    /workspace/i
  );

  const workspaceApprovals = repositories.runtimeResourceMutations.listApprovals({
    workspaceId: workspaceA,
    limit: 10
  });
  assert.deepEqual(
    workspaceApprovals.map((approval) => approval.id),
    [consumedA.id, deniedA.id, pendingA.id],
    "Approvals must be isolated by workspace and ordered by newest update first"
  );
  assert.equal(workspaceApprovals.some((approval) => approval.id === pendingB.id), false);
  assert.deepEqual(
    repositories.runtimeResourceMutations
      .listApprovals({
        workspaceId: workspaceA,
        resourceId: skillResource.id,
        status: "denied",
        limit: 10
      })
      .map((approval) => approval.id),
    [deniedA.id]
  );

  for (let index = 0; index < 105; index += 1) {
    createApproval({
      id: `approval_read_bulk_${String(index).padStart(3, "0")}`,
      workspaceId: workspaceA,
      resource: skillResource,
      operation: "skill.enable",
      now: new Date(Date.parse("2026-08-10T19:10:00.000Z") + index * 1000).toISOString()
    });
  }
  const defaultBounded = repositories.runtimeResourceMutations.listApprovals({
    workspaceId: workspaceA,
    resourceId: skillResource.id
  });
  assert.equal(defaultBounded.length, 25);
  assert.equal(defaultBounded[0]?.id, "approval_read_bulk_104");
  assert.equal(defaultBounded[24]?.id, "approval_read_bulk_080");
  const maxBounded = repositories.runtimeResourceMutations.listApprovals({
    workspaceId: workspaceA,
    resourceId: skillResource.id,
    limit: 10_000
  });
  assert.equal(maxBounded.length, 100);

  assert.deepEqual(
    repositories.runtimeResourceMutations
      .listExecutions({ workspaceId: workspaceA, resourceId: pluginResource.id })
      .map((execution) => execution.id),
    [executionA.id]
  );
  assert.deepEqual(
    repositories.runtimeResourceMutations
      .listExecutions({ workspaceId: workspaceB, resourceId: pluginResource.id })
      .map((execution) => execution.id),
    []
  );
  assert.deepEqual(
    repositories.runtimeResourceMutations
      .listExecutions({ workspaceId: workspaceA, approvalId: consumedA.id })
      .map((execution) => execution.id),
    [executionA.id]
  );

  for (let index = 0; index < 105; index += 1) {
    const pending = createApproval({
      id: `approval_execution_bulk_${String(index).padStart(3, "0")}`,
      workspaceId: workspaceA,
      resource: skillResource,
      operation: "skill.enable",
      now: new Date(Date.parse("2026-08-10T19:20:00.000Z") + index * 1000).toISOString()
    });
    const approved = repositories.runtimeResourceMutations.decide({
      id: pending.id,
      decision: "approved",
      expectedRevision: pending.revision,
      decidedActor,
      now: new Date(Date.parse("2026-08-10T19:20:00.250Z") + index * 1000).toISOString()
    });
    const consumed = repositories.runtimeResourceMutations.consume({
      id: approved.id,
      expectedRevision: approved.revision,
      now: new Date(Date.parse("2026-08-10T19:20:00.500Z") + index * 1000).toISOString()
    });
    repositories.runtimeResourceMutations.createExecution({
      id: `execution_bulk_${String(index).padStart(3, "0")}`,
      approval: consumed,
      providerMethod: "skills/config/write",
      executedActor,
      now: new Date(Date.parse("2026-08-10T19:20:00.750Z") + index * 1000).toISOString()
    });
  }
  const defaultExecutionBounded = repositories.runtimeResourceMutations.listExecutions({
    workspaceId: workspaceA,
    resourceId: skillResource.id
  });
  assert.equal(defaultExecutionBounded.length, 25);
  assert.equal(defaultExecutionBounded[0]?.id, "execution_bulk_104");
  assert.equal(defaultExecutionBounded[24]?.id, "execution_bulk_080");
  const maxExecutionBounded = repositories.runtimeResourceMutations.listExecutions({
    workspaceId: workspaceA,
    resourceId: skillResource.id,
    limit: 10_000
  });
  assert.equal(maxExecutionBounded.length, 100);

  const alternatePluginResource: RuntimeResourceDescriptor = {
    ...pluginResource,
    capabilities: pluginResource.capabilities.filter(
      (capability) => capability !== "plugin:install-policy:available"
    ),
    fingerprint: "4".repeat(64)
  };
  const alternateSnapshot = repositories.runtimeResourceSnapshots.create({
    id: "resource_snapshot_mutation_read_alternate_workspace_policy",
    runtimeProfileId: profile.id,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    status: "ready",
    profile: profile as unknown as Record<string, unknown>,
    fingerprint: hashRuntimeResourceSnapshot(profile, [alternatePluginResource]),
    items: [
      {
        resourceId: alternatePluginResource.id,
        kind: alternatePluginResource.kind,
        externalId: alternatePluginResource.externalId,
        displayName: alternatePluginResource.displayName,
        description: alternatePluginResource.description,
        scope: alternatePluginResource.scope,
        installed: alternatePluginResource.installed,
        enabled: alternatePluginResource.enabled,
        version: alternatePluginResource.version,
        availableVersion: alternatePluginResource.availableVersion,
        updateStatus: alternatePluginResource.updateStatus,
        authStatus: alternatePluginResource.authStatus,
        compatibilityStatus: alternatePluginResource.compatibilityStatus,
        sourceKind: alternatePluginResource.sourceKind,
        sourceLabel: alternatePluginResource.sourceLabel,
        capabilities: alternatePluginResource.capabilities,
        publicReason: alternatePluginResource.publicReason,
        fingerprint: alternatePluginResource.fingerprint
      }
    ],
    now: "2026-08-10T19:30:00.000Z"
  });

  const inventory = new RuntimeResourceInventoryService(
    repositories,
    new RuntimeProfileRegistry([]),
    new RuntimeResourceInventoryAdapterRegistry([])
  );
  assert.equal(
    inventory.inspectResource(pluginResource.id).snapshot.id,
    alternateSnapshot.id,
    "Global latest Resource observation can legitimately differ from the UI's selected snapshot"
  );
  const publicService = new RuntimeResourceMutationPublicService(
    repositories,
    inventory,
    { pluginMutationAvailable: true }
  );

  const publicApproval = publicService.getApproval({
    workspaceId: workspaceA,
    approvalId: consumedA.id
  });
  const publicExecution = publicService.getExecution({
    workspaceId: workspaceA,
    executionId: executionA.id
  });
  const activity = publicService.activity({
    workspaceId: workspaceA,
    resourceId: pluginResource.id,
    limit: 10
  });
  assert.equal(activity.approvals.length, 1);
  assert.equal(activity.executions.length, 1);
  assert.equal(publicApproval.requestedActor?.type, "remote-mcp");
  assert.equal(publicApproval.decidedActor?.type, "rest-api");
  assert.equal(publicExecution.executedActor?.type, "remote-mcp");

  const publicJson = JSON.stringify({ publicApproval, publicExecution, activity });
  for (const forbidden of [
    "mutationHash",
    "requestedRequestIdentityHash",
    "decidedRequestIdentityHash",
    "executedRequestIdentityHash",
    "raw-client-subject-must-not-project",
    "raw-operator-subject-must-not-project",
    "sourceIdentityHash",
    "remotePluginId",
    "marketplacePath",
    "installUrl",
    "/private/tokenpilot-runtime-sentinel"
  ]) {
    assert.equal(publicJson.includes(forbidden), false, `Public mutation read model leaked ${forbidden}`);
  }

  assert.throws(
    () =>
      publicService.getApproval({
        workspaceId: workspaceB,
        approvalId: consumedA.id
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "RUNTIME_RESOURCE_MUTATION_NOT_FOUND"
  );
  assert.throws(
    () =>
      publicService.getExecution({
        workspaceId: workspaceB,
        executionId: executionA.id
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "RUNTIME_RESOURCE_MUTATION_NOT_FOUND"
  );

  const skillEligibility = publicService.eligibility({
    snapshotId: snapshot.id,
    resourceId: skillResource.id,
    operation: "skill.enable"
  });
  assert.equal(skillEligibility.operation, "skill.enable");
  assert.equal(skillEligibility.eligible, true);
  const pluginEligibility = publicService.eligibility({
    snapshotId: snapshot.id,
    resourceId: pluginResource.id,
    operation: "plugin.install"
  });
  assert.equal(pluginEligibility.operation, "plugin.install");
  assert.equal(
    pluginEligibility.eligible,
    true,
    "Eligibility must evaluate the explicitly selected snapshot rather than a global latest observation"
  );

  const noPluginWrites = new RuntimeResourceMutationPublicService(
    repositories,
    inventory,
    { pluginMutationAvailable: false }
  );
  assert.equal(
    noPluginWrites.eligibility({
      snapshotId: snapshot.id,
      resourceId: pluginResource.id,
      operation: "plugin.install"
    }).code,
    "plugin-mutation-unavailable"
  );

  const builtServices = buildRuntimeResourceServices({
    repositories,
    profiles: new RuntimeProfileRegistry([]),
    adapters: new RuntimeResourceInventoryAdapterRegistry([]),
    pluginMutationAvailable: true
  });
  assert.ok(builtServices.mutations instanceof RuntimeResourceMutationPublicService);
  assert.equal(
    builtServices.mutations.eligibility({
      snapshotId: snapshot.id,
      resourceId: pluginResource.id,
      operation: "plugin.install"
    }).eligible,
    true
  );
} finally {
  database.close();
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_READ_MODEL_OK\n");
