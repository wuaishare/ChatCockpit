import type {
  RuntimeRecoveryAction,
  RuntimeRecoveryClassification,
  RuntimeRecoveryProtocolKind
} from "../continuity/types.js";

export type RuntimeCompatibilityStatus =
  | "ready"
  | "unavailable"
  | "auth-required"
  | "version-unsupported"
  | "protocol-incompatible"
  | "degraded";

export interface RuntimeCompatibilityDescriptor {
  providerKind: string;
  protocolKind: RuntimeRecoveryProtocolKind;
  available: boolean;
  executableSource: "path" | "custom" | "bundled" | "internal" | null;
  executableVersion: string | null;
  minimumSupportedVersion: string | null;
  testedVersionRange: string | null;
  protocolFamily: string | null;
  protocolVersion: string | null;
  schemaFingerprint: string | null;
  compatibilityStatus: RuntimeCompatibilityStatus;
  publicReason: string | null;
  probedAt: string;
}

export interface RecoverableExternalSession {
  externalSessionId: string;
  providerKind: string;
  protocolKind: RuntimeRecoveryProtocolKind;
  projectId: string | null;
  workspaceId: string | null;
  repoId: string | null;
  status: string;
  preview: string;
  createdAt: number | null;
  updatedAt: number | null;
  recencyAt: number | null;
}

export interface ExternalSessionInspection extends RecoverableExternalSession {
  exists: boolean;
  authoritative: boolean;
  busy: boolean;
  identityMatched: boolean;
}

export interface RecoveryAdapterExecutionInput {
  action: RuntimeRecoveryAction;
  projectId: string;
  workspaceId: string;
  repoId: string;
  externalSessionId?: string | null;
  sourceExternalSessionId?: string | null;
  lastTurnId?: string | null;
}

export interface RecoveryAdapterExecutionResult {
  externalSession: ExternalSessionInspection | null;
  relation: "bound" | "resumed" | "forked" | "reconciled" | "continued";
}

export interface RuntimeRecoveryAdapter {
  readonly providerKind: string;
  readonly protocolKind: RuntimeRecoveryProtocolKind;
  probeCompatibility(): Promise<RuntimeCompatibilityDescriptor>;
  listRecoverableSessions(input: {
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<RecoverableExternalSession[]>;
  inspectExternalSession(input: {
    externalSessionId: string;
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<ExternalSessionInspection>;
  executeRecovery(
    input: RecoveryAdapterExecutionInput
  ): Promise<RecoveryAdapterExecutionResult>;
}

export interface RecoveryBlocker {
  code: RuntimeRecoveryClassification;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeRecoveryAssessmentProjection {
  recoveryId: string;
  classification: RuntimeRecoveryClassification;
  blockers: RecoveryBlocker[];
  availableActions: RuntimeRecoveryAction[];
  compatibility: RuntimeCompatibilityDescriptor;
  candidates: RecoverableExternalSession[];
  externalSession: ExternalSessionInspection | null;
  assessmentHash: string;
  expiresAt: string;
}
