import type { ActorType } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import type { GovernanceLedger } from "../governance/governance-ledger.js";
import type {
  GovernanceActorProvenance,
  GovernedExternalActionApprovalRecord,
  GovernedExternalActionApprovalStatus,
  GovernedExternalActionExecutionRecord,
  GovernedExternalActionVerificationStatus,
} from "../governance/governed-external-action-repository.js";

export interface CapabilityRouterMutationActorProjection {
  type: ActorType;
  identityHash: string | null;
}

export interface CapabilityRouterMutationApprovalProjection {
  id: string;
  targetId: "local-device";
  providerId: string;
  providerDisplayName: string | null;
  protocolFamily: "mcp-legacy-stdio" | "mcp-streamable-http" | null;
  toolName: string;
  requestedActor: CapabilityRouterMutationActorProjection | null;
  decidedActor: CapabilityRouterMutationActorProjection | null;
  status: GovernedExternalActionApprovalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface CapabilityRouterMutationExecutionProjection {
  id: string;
  approvalId: string;
  targetId: "local-device";
  providerId: string;
  toolName: string;
  verificationStatus: GovernedExternalActionVerificationStatus;
  errorCode: string | null;
  executedActor: CapabilityRouterMutationActorProjection | null;
  startedAt: string;
  finishedAt: string | null;
}

function actorProjection(
  actor: GovernanceActorProvenance,
): CapabilityRouterMutationActorProjection | null {
  return actor.actorType
    ? { type: actor.actorType, identityHash: actor.actorIdentityHash }
    : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

function protocolFamily(
  value: unknown,
): CapabilityRouterMutationApprovalProjection["protocolFamily"] {
  return value === "mcp-legacy-stdio" || value === "mcp-streamable-http"
    ? value
    : null;
}

function assertLocalDevice(
  targetId: string,
): asserts targetId is "local-device" {
  if (targetId !== "local-device") {
    throw new ServiceError(
      "CAPABILITY_ROUTER_MUTATION_NOT_FOUND",
      "Capability Router mutation record is not available for the local device",
    );
  }
}

function assertCapabilityRouterApproval(
  record: GovernedExternalActionApprovalRecord,
): asserts record is GovernedExternalActionApprovalRecord & {
  targetId: "local-device";
} {
  assertLocalDevice(record.targetId);
  if (record.publicSummary.action !== "Provider-native mutation") {
    throw new ServiceError(
      "CAPABILITY_ROUTER_MUTATION_NOT_FOUND",
      "Governed external action is not a Capability Router mutation",
    );
  }
}

function projectApproval(
  record: GovernedExternalActionApprovalRecord,
): CapabilityRouterMutationApprovalProjection {
  assertCapabilityRouterApproval(record);
  return {
    id: record.id,
    targetId: record.targetId,
    providerId: record.providerId,
    providerDisplayName: boundedString(
      record.publicSummary.providerDisplayName,
      160,
    ),
    protocolFamily: protocolFamily(record.publicSummary.protocolFamily),
    toolName: record.toolName,
    requestedActor: actorProjection(record.requestedActor),
    decidedActor: actorProjection(record.decidedActor),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    decidedAt: record.decidedAt,
    consumedAt: record.consumedAt,
    revision: record.revision,
  };
}

function projectExecution(
  record: GovernedExternalActionExecutionRecord,
): CapabilityRouterMutationExecutionProjection {
  assertLocalDevice(record.targetId);
  return {
    id: record.id,
    approvalId: record.approvalId,
    targetId: record.targetId,
    providerId: record.providerId,
    toolName: record.toolName,
    verificationStatus: record.verificationStatus,
    errorCode: boundedString(record.errorCode, 160),
    executedActor: actorProjection(record.executedActor),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

export class CapabilityRouterMutationPublicService {
  constructor(private readonly governance: GovernanceLedger) {}

  getApproval(approvalId: string): CapabilityRouterMutationApprovalProjection {
    return projectApproval(
      this.governance.externalActions.getApproval(approvalId),
    );
  }

  getExecution(
    executionId: string,
  ): CapabilityRouterMutationExecutionProjection {
    const execution = this.governance.externalActions.getExecution(executionId);
    assertCapabilityRouterApproval(
      this.governance.externalActions.getApproval(execution.approvalId),
    );
    return projectExecution(execution);
  }
}
