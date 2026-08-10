import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type { RuntimeResourceScope } from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

export type RuntimeResourceMutationOperation =
  | "skill.enable"
  | "skill.disable"
  | "plugin.install"
  | "plugin.uninstall";
export type RuntimeResourceMutationProviderMethod =
  | "skills/config/write"
  | "plugin/install"
  | "plugin/uninstall";
export type RuntimeResourceMutationApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "stale"
  | "consumed";
export type RuntimeResourceMutationVerificationStatus =
  | "executing"
  | "verified"
  | "failed-external"
  | "failed-verification"
  | "stale";

export interface RuntimeResourceMutationApprovalRecord {
  id: string;
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string | null;
  resourceId: string;
  resourceKind: "skill" | "plugin";
  resourceScope: RuntimeResourceScope;
  beforeSnapshotId: string;
  beforeFingerprint: string;
  requestedState: Record<string, unknown>;
  mutationHash: string;
  publicSummary: Record<string, unknown>;
  status: RuntimeResourceMutationApprovalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface RuntimeResourceMutationExecutionRecord {
  id: string;
  approvalId: string;
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string | null;
  resourceId: string;
  beforeSnapshotId: string;
  beforeFingerprint: string;
  afterSnapshotId: string | null;
  afterFingerprint: string | null;
  requestedState: Record<string, unknown>;
  observedState: Record<string, unknown> | null;
  providerMethod: RuntimeResourceMutationProviderMethod;
  verificationStatus: RuntimeResourceMutationVerificationStatus;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface ApprovalRow {
  id: string;
  operation: RuntimeResourceMutationOperation;
  runtime_profile_id: string;
  workspace_id: string | null;
  resource_id: string;
  resource_kind: "skill" | "plugin";
  resource_scope: RuntimeResourceScope;
  before_snapshot_id: string;
  before_fingerprint: string;
  requested_state_json: string;
  mutation_hash: string;
  public_summary_json: string;
  status: RuntimeResourceMutationApprovalStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  decided_at: string | null;
  consumed_at: string | null;
  revision: number;
}

interface ExecutionRow {
  id: string;
  approval_id: string;
  operation: RuntimeResourceMutationOperation;
  runtime_profile_id: string;
  workspace_id: string | null;
  resource_id: string;
  before_snapshot_id: string;
  before_fingerprint: string;
  after_snapshot_id: string | null;
  after_fingerprint: string | null;
  requested_state_json: string;
  observed_state_json: string | null;
  provider_method: RuntimeResourceMutationProviderMethod;
  verification_status: RuntimeResourceMutationVerificationStatus;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      `Stored Runtime Resource mutation ${label} is invalid`
    );
  }
}

function approvalFromRow(row: ApprovalRow): RuntimeResourceMutationApprovalRecord {
  return {
    id: row.id,
    operation: row.operation,
    runtimeProfileId: row.runtime_profile_id,
    workspaceId: row.workspace_id,
    resourceId: row.resource_id,
    resourceKind: row.resource_kind,
    resourceScope: row.resource_scope,
    beforeSnapshotId: row.before_snapshot_id,
    beforeFingerprint: row.before_fingerprint,
    requestedState: parseObject(row.requested_state_json, "requested state"),
    mutationHash: row.mutation_hash,
    publicSummary: parseObject(row.public_summary_json, "public summary"),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
    revision: Number(row.revision)
  };
}

function executionFromRow(row: ExecutionRow): RuntimeResourceMutationExecutionRecord {
  return {
    id: row.id,
    approvalId: row.approval_id,
    operation: row.operation,
    runtimeProfileId: row.runtime_profile_id,
    workspaceId: row.workspace_id,
    resourceId: row.resource_id,
    beforeSnapshotId: row.before_snapshot_id,
    beforeFingerprint: row.before_fingerprint,
    afterSnapshotId: row.after_snapshot_id,
    afterFingerprint: row.after_fingerprint,
    requestedState: parseObject(row.requested_state_json, "requested state"),
    observedState: row.observed_state_json
      ? parseObject(row.observed_state_json, "observed state")
      : null,
    providerMethod: row.provider_method,
    verificationStatus: row.verification_status,
    errorCode: row.error_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

export class RuntimeResourceMutationRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  createApproval(input: {
    id?: string;
    operation: RuntimeResourceMutationOperation;
    runtimeProfileId: string;
    workspaceId: string | null;
    resourceId: string;
    resourceKind: "skill" | "plugin";
    resourceScope: RuntimeResourceScope;
    beforeSnapshotId: string;
    beforeFingerprint: string;
    requestedState: Record<string, unknown>;
    mutationHash: string;
    publicSummary: Record<string, unknown>;
    expiresAt: string;
    now?: string;
  }): RuntimeResourceMutationApprovalRecord {
    const id = input.id ?? newRecordId("resource_mutation_approval");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO runtime_resource_mutation_approvals (
          id, operation, runtime_profile_id, workspace_id, resource_id,
          resource_kind, resource_scope, before_snapshot_id, before_fingerprint,
          requested_state_json, mutation_hash, public_summary_json, status,
          created_at, updated_at, expires_at, decided_at, consumed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, 1)
      `)
      .run(
        id,
        input.operation,
        input.runtimeProfileId,
        input.workspaceId,
        input.resourceId,
        input.resourceKind,
        input.resourceScope,
        input.beforeSnapshotId,
        input.beforeFingerprint,
        JSON.stringify(input.requestedState),
        input.mutationHash,
        JSON.stringify(input.publicSummary),
        now,
        now,
        input.expiresAt
      );
    return this.getApproval(id);
  }

  getApproval(id: string): RuntimeResourceMutationApprovalRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_resource_mutation_approvals WHERE id = ?")
      .get(id) as ApprovalRow | undefined;
    return approvalFromRow(requireRecord(row, "Runtime Resource mutation approval", id));
  }

  expireIfNeeded(id: string, now: string): RuntimeResourceMutationApprovalRecord {
    const current = this.getApproval(id);
    if (["pending", "approved"].includes(current.status) && current.expiresAt <= now) {
      const result = this.database.sqlite
        .prepare(`
          UPDATE runtime_resource_mutation_approvals
          SET status = 'expired', updated_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND status IN ('pending', 'approved')
        `)
        .run(now, id, current.revision);
      assertUpdated(
        result.changes,
        "Runtime Resource mutation approval",
        id,
        current.revision
      );
    }
    return this.getApproval(id);
  }

  markStale(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): RuntimeResourceMutationApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "stale") {
      return current;
    }
    if (current.status === "expired") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_EXPIRED",
        "Runtime Resource mutation approval expired"
      );
    }
    if (current.status !== "approved") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_REQUIRED",
        "Only an approved Runtime Resource mutation can become stale"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(
        0,
        "Runtime Resource mutation approval",
        input.id,
        input.expectedRevision
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_resource_mutation_approvals
        SET status = 'stale', updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'approved'
      `)
      .run(now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Runtime Resource mutation approval",
      input.id,
      input.expectedRevision
    );
    return this.getApproval(input.id);
  }

  decide(input: {
    id: string;
    decision: "approved" | "denied";
    expectedRevision: number;
    now?: string;
  }): RuntimeResourceMutationApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_EXPIRED",
        "Runtime Resource mutation approval expired"
      );
    }
    if (current.status === "stale") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Runtime Resource mutation approval is stale and cannot be decided"
      );
    }
    if (current.status !== "pending") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_REQUIRED",
        "Only a pending Runtime Resource mutation approval can receive a decision"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(
        0,
        "Runtime Resource mutation approval",
        input.id,
        input.expectedRevision
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_resource_mutation_approvals
        SET status = ?, decided_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'pending'
      `)
      .run(input.decision, now, now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Runtime Resource mutation approval",
      input.id,
      input.expectedRevision
    );
    return this.getApproval(input.id);
  }

  consume(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): RuntimeResourceMutationApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_EXPIRED",
        "Runtime Resource mutation approval expired"
      );
    }
    if (current.status === "stale") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Runtime Resource mutation approval is stale and cannot be consumed"
      );
    }
    if (current.status === "consumed") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_CONSUMED",
        "Runtime Resource mutation approval was already consumed"
      );
    }
    if (current.status !== "approved") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_REQUIRED",
        "Runtime Resource mutation requires an approved intent"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(
        0,
        "Runtime Resource mutation approval",
        input.id,
        input.expectedRevision
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_resource_mutation_approvals
        SET status = 'consumed', consumed_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'approved'
      `)
      .run(now, now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Runtime Resource mutation approval",
      input.id,
      input.expectedRevision
    );
    return this.getApproval(input.id);
  }

  createExecution(input: {
    id?: string;
    approval: RuntimeResourceMutationApprovalRecord;
    providerMethod: RuntimeResourceMutationProviderMethod;
    now?: string;
  }): RuntimeResourceMutationExecutionRecord {
    const id = input.id ?? newRecordId("resource_mutation_execution");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO runtime_resource_mutation_executions (
          id, approval_id, operation, runtime_profile_id, workspace_id,
          resource_id, before_snapshot_id, before_fingerprint,
          after_snapshot_id, after_fingerprint, requested_state_json,
          observed_state_json, provider_method, verification_status,
          error_code, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, 'executing', NULL, ?, NULL)
      `)
      .run(
        id,
        input.approval.id,
        input.approval.operation,
        input.approval.runtimeProfileId,
        input.approval.workspaceId,
        input.approval.resourceId,
        input.approval.beforeSnapshotId,
        input.approval.beforeFingerprint,
        JSON.stringify(input.approval.requestedState),
        input.providerMethod,
        now
      );
    return this.getExecution(id);
  }

  getExecution(id: string): RuntimeResourceMutationExecutionRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_resource_mutation_executions WHERE id = ?")
      .get(id) as ExecutionRow | undefined;
    return executionFromRow(requireRecord(row, "Runtime Resource mutation execution", id));
  }

  finishExecution(input: {
    id: string;
    status: Exclude<RuntimeResourceMutationVerificationStatus, "executing">;
    afterSnapshotId?: string | null;
    afterFingerprint?: string | null;
    observedState?: Record<string, unknown> | null;
    errorCode?: string | null;
    now?: string;
  }): RuntimeResourceMutationExecutionRecord {
    const now = nowIso(input.now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_resource_mutation_executions
        SET after_snapshot_id = ?, after_fingerprint = ?, observed_state_json = ?,
            verification_status = ?, error_code = ?, finished_at = ?
        WHERE id = ? AND verification_status = 'executing'
      `)
      .run(
        input.afterSnapshotId ?? null,
        input.afterFingerprint ?? null,
        input.observedState ? JSON.stringify(input.observedState) : null,
        input.status,
        input.errorCode ?? null,
        now,
        input.id
      );
    if (result.changes !== 1) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Runtime Resource mutation execution ${input.id} is no longer executing`
      );
    }
    return this.getExecution(input.id);
  }
}
