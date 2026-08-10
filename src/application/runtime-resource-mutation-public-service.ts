import type { ActorType } from "./operation-context.js";
import {
  assessRuntimeResourceMutationEligibility,
  type RuntimeResourceMutationEligibilityCode,
  type RuntimeResourceMutationEligibilityStage
} from "./runtime-resource-mutation-eligibility.js";
import type { RuntimeResourceInventoryService } from "./runtime-resource-inventory-service.js";
import { ServiceError } from "./service-error.js";
import { runtimeProfileDescriptorSchema } from "../contracts/runtime-resources.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  RuntimeResourceMutationApprovalRecord,
  RuntimeResourceMutationApprovalStatus,
  RuntimeResourceMutationExecutionRecord,
  RuntimeResourceMutationOperation,
  RuntimeResourceMutationProviderMethod,
  RuntimeResourceMutationVerificationStatus
} from "../continuity/repositories/runtime-resource-mutation-repository.js";
import type { RuntimeResourceScope } from "../continuity/types.js";

export interface RuntimeResourceMutationActorProjection {
  type: ActorType;
  identityHash: string | null;
}

export interface RuntimeResourceMutationApprovalProjection {
  id: string;
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  resourceKind: "skill" | "plugin";
  resourceScope: RuntimeResourceScope;
  beforeSnapshotId: string;
  beforeFingerprint: string;
  requestedState: Record<string, boolean>;
  publicSummary: Record<string, string | boolean>;
  requestedActor: RuntimeResourceMutationActorProjection | null;
  decidedActor: RuntimeResourceMutationActorProjection | null;
  status: RuntimeResourceMutationApprovalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface RuntimeResourceMutationExecutionProjection {
  id: string;
  approvalId: string;
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  beforeSnapshotId: string;
  beforeFingerprint: string;
  afterSnapshotId: string | null;
  afterFingerprint: string | null;
  requestedState: Record<string, boolean>;
  observedState: Record<string, string | number | boolean> | null;
  providerMethod: RuntimeResourceMutationProviderMethod;
  verificationStatus: RuntimeResourceMutationVerificationStatus;
  errorCode: string | null;
  executedActor: RuntimeResourceMutationActorProjection | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RuntimeResourceMutationEligibilityProjection {
  operation: RuntimeResourceMutationOperation;
  eligible: boolean;
  code: RuntimeResourceMutationEligibilityCode;
  stage: RuntimeResourceMutationEligibilityStage;
  publicReason: string;
}

function actorProjection(
  type: ActorType | null,
  identityHash: string | null
): RuntimeResourceMutationActorProjection | null {
  return type ? { type, identityHash } : null;
}

function booleanState(value: Record<string, unknown>): Record<string, boolean> {
  const projected: Record<string, boolean> = {};
  for (const key of ["enabled", "installed"] as const) {
    if (typeof value[key] === "boolean") projected[key] = value[key];
  }
  return projected;
}

function observedState(
  value: Record<string, unknown> | null
): Record<string, string | number | boolean> | null {
  if (!value) return null;
  const projected: Record<string, string | number | boolean> = {};
  for (const key of ["enabled", "installed", "missing"] as const) {
    if (typeof value[key] === "boolean") projected[key] = value[key];
  }
  if (typeof value.authPolicy === "string" && value.authPolicy.length <= 120) {
    projected.authPolicy = value.authPolicy;
  }
  if (
    typeof value.appsNeedingAuthCount === "number" &&
    Number.isFinite(value.appsNeedingAuthCount)
  ) {
    projected.appsNeedingAuthCount = value.appsNeedingAuthCount;
  }
  return projected;
}

function publicSummary(
  value: Record<string, unknown>
): Record<string, string | boolean> {
  const projected: Record<string, string | boolean> = {};
  for (const key of [
    "resourceId",
    "displayName",
    "kind",
    "scope",
    "runtimeProfileId"
  ] as const) {
    if (typeof value[key] === "string") projected[key] = value[key];
  }
  for (const key of [
    "beforeEnabled",
    "requestedEnabled",
    "beforeInstalled",
    "requestedInstalled"
  ] as const) {
    if (typeof value[key] === "boolean") projected[key] = value[key];
  }
  return projected;
}

function approvalProjection(
  record: RuntimeResourceMutationApprovalRecord
): RuntimeResourceMutationApprovalProjection {
  if (!record.workspaceId) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
      "Runtime Resource mutation approval is not available in this Workspace"
    );
  }
  return {
    id: record.id,
    operation: record.operation,
    runtimeProfileId: record.runtimeProfileId,
    workspaceId: record.workspaceId,
    resourceId: record.resourceId,
    resourceKind: record.resourceKind,
    resourceScope: record.resourceScope,
    beforeSnapshotId: record.beforeSnapshotId,
    beforeFingerprint: record.beforeFingerprint,
    requestedState: booleanState(record.requestedState),
    publicSummary: publicSummary(record.publicSummary),
    requestedActor: actorProjection(
      record.requestedActorType,
      record.requestedActorIdentityHash
    ),
    decidedActor: actorProjection(
      record.decidedActorType,
      record.decidedActorIdentityHash
    ),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    decidedAt: record.decidedAt,
    consumedAt: record.consumedAt,
    revision: record.revision
  };
}

function executionProjection(
  record: RuntimeResourceMutationExecutionRecord
): RuntimeResourceMutationExecutionProjection {
  if (!record.workspaceId) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
      "Runtime Resource mutation execution is not available in this Workspace"
    );
  }
  return {
    id: record.id,
    approvalId: record.approvalId,
    operation: record.operation,
    runtimeProfileId: record.runtimeProfileId,
    workspaceId: record.workspaceId,
    resourceId: record.resourceId,
    beforeSnapshotId: record.beforeSnapshotId,
    beforeFingerprint: record.beforeFingerprint,
    afterSnapshotId: record.afterSnapshotId,
    afterFingerprint: record.afterFingerprint,
    requestedState: booleanState(record.requestedState),
    observedState: observedState(record.observedState),
    providerMethod: record.providerMethod,
    verificationStatus: record.verificationStatus,
    errorCode: record.errorCode,
    executedActor: actorProjection(
      record.executedActorType,
      record.executedActorIdentityHash
    ),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt
  };
}

export class RuntimeResourceMutationPublicService {
  private readonly pluginMutationAvailable: boolean;

  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly inventory: RuntimeResourceInventoryService,
    options: { pluginMutationAvailable?: boolean } = {}
  ) {
    this.pluginMutationAvailable = options.pluginMutationAvailable ?? false;
  }

  eligibility(input: {
    snapshotId: string;
    resourceId: string;
    operation: RuntimeResourceMutationOperation;
  }): RuntimeResourceMutationEligibilityProjection {
    const inspected = this.inventory.inspectSnapshotResource(
      input.snapshotId,
      input.resourceId
    );
    const parsedProfile = runtimeProfileDescriptorSchema.safeParse(
      inspected.snapshot.profile
    );
    if (!parsedProfile.success) {
      throw new ServiceError(
        "CONTINUITY_DATA_INVALID",
        "Stored Runtime Resource Profile projection is invalid"
      );
    }
    const result = assessRuntimeResourceMutationEligibility({
      profile: parsedProfile.data,
      resource: inspected.resource,
      operation: input.operation,
      pluginMutationAvailable: this.pluginMutationAvailable
    });
    return { operation: input.operation, ...result };
  }

  getApproval(input: {
    workspaceId: string;
    approvalId: string;
  }): RuntimeResourceMutationApprovalProjection {
    const record = this.repositories.runtimeResourceMutations.getApproval(
      input.approvalId
    );
    if (record.workspaceId !== input.workspaceId) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
        "Runtime Resource mutation approval is not available in this Workspace"
      );
    }
    return approvalProjection(record);
  }

  getExecution(input: {
    workspaceId: string;
    executionId: string;
  }): RuntimeResourceMutationExecutionProjection {
    const record = this.repositories.runtimeResourceMutations.getExecution(
      input.executionId
    );
    if (record.workspaceId !== input.workspaceId) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
        "Runtime Resource mutation execution is not available in this Workspace"
      );
    }
    return executionProjection(record);
  }

  activity(input: {
    workspaceId: string;
    resourceId?: string;
    approvalStatus?: RuntimeResourceMutationApprovalStatus;
    limit?: number;
  }): {
    approvals: RuntimeResourceMutationApprovalProjection[];
    executions: RuntimeResourceMutationExecutionProjection[];
  } {
    return {
      approvals: this.repositories.runtimeResourceMutations
        .listApprovals({
          workspaceId: input.workspaceId,
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          ...(input.approvalStatus ? { status: input.approvalStatus } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {})
        })
        .map(approvalProjection),
      executions: this.repositories.runtimeResourceMutations
        .listExecutions({
          workspaceId: input.workspaceId,
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {})
        })
        .map(executionProjection)
    };
  }
}
