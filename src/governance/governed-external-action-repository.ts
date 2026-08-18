import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { ActorType } from "../application/operation-context.js";
import { ServiceError } from "../application/service-error.js";

export interface GovernanceStorage {
  readonly sqlite: DatabaseSync;
  transaction<T>(operation: () => T): T;
}

export type GovernedExternalActionApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "stale"
  | "consumed";

export type GovernedExternalActionVerificationStatus =
  | "executing"
  | "succeeded"
  | "failed-external"
  | "failed-projection"
  | "stale";

export interface GovernanceActorProvenance {
  actorType: ActorType | null;
  actorIdentityHash: string | null;
  requestIdentityHash: string | null;
}

export interface GovernedExternalActionApprovalRecord {
  id: string;
  targetId: string;
  providerId: string;
  toolName: string;
  argumentsHash: string;
  publicSummary: Record<string, unknown>;
  requestedActor: GovernanceActorProvenance;
  decidedActor: GovernanceActorProvenance;
  status: GovernedExternalActionApprovalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface GovernedExternalActionExecutionRecord {
  id: string;
  approvalId: string;
  targetId: string;
  providerId: string;
  toolName: string;
  argumentsHash: string;
  verificationStatus: GovernedExternalActionVerificationStatus;
  errorCode: string | null;
  executedActor: GovernanceActorProvenance;
  startedAt: string;
  finishedAt: string | null;
}

interface ApprovalRow {
  id: string;
  target_id: string;
  provider_id: string;
  tool_name: string;
  arguments_hash: string;
  public_summary_json: string;
  requested_actor_type: ActorType | null;
  requested_actor_identity_hash: string | null;
  requested_request_identity_hash: string | null;
  decided_actor_type: ActorType | null;
  decided_actor_identity_hash: string | null;
  decided_request_identity_hash: string | null;
  status: GovernedExternalActionApprovalStatus;
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
  target_id: string;
  provider_id: string;
  tool_name: string;
  arguments_hash: string;
  verification_status: GovernedExternalActionVerificationStatus;
  error_code: string | null;
  executed_actor_type: ActorType | null;
  executed_actor_identity_hash: string | null;
  executed_request_identity_hash: string | null;
  started_at: string;
  finished_at: string | null;
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(
      "GOVERNANCE_DATA_INVALID",
      "Stored governed external action summary is invalid"
    );
  }
}

function approvalFromRow(row: ApprovalRow): GovernedExternalActionApprovalRecord {
  return {
    id: row.id,
    targetId: row.target_id,
    providerId: row.provider_id,
    toolName: row.tool_name,
    argumentsHash: row.arguments_hash,
    publicSummary: parseObject(row.public_summary_json),
    requestedActor: {
      actorType: row.requested_actor_type,
      actorIdentityHash: row.requested_actor_identity_hash,
      requestIdentityHash: row.requested_request_identity_hash
    },
    decidedActor: {
      actorType: row.decided_actor_type,
      actorIdentityHash: row.decided_actor_identity_hash,
      requestIdentityHash: row.decided_request_identity_hash
    },
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
    revision: Number(row.revision)
  };
}

function executionFromRow(
  row: ExecutionRow
): GovernedExternalActionExecutionRecord {
  return {
    id: row.id,
    approvalId: row.approval_id,
    targetId: row.target_id,
    providerId: row.provider_id,
    toolName: row.tool_name,
    argumentsHash: row.arguments_hash,
    verificationStatus: row.verification_status,
    errorCode: row.error_code,
    executedActor: {
      actorType: row.executed_actor_type,
      actorIdentityHash: row.executed_actor_identity_hash,
      requestIdentityHash: row.executed_request_identity_hash
    },
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function requireApproval(
  row: ApprovalRow | undefined,
  id: string
): GovernedExternalActionApprovalRecord {
  if (!row) {
    throw new ServiceError(
      "GOVERNED_EXTERNAL_ACTION_APPROVAL_NOT_FOUND",
      "Governed external action approval was not found"
    );
  }
  return approvalFromRow(row);
}

function requireExecution(
  row: ExecutionRow | undefined,
  id: string
): GovernedExternalActionExecutionRecord {
  if (!row) {
    throw new ServiceError(
      "GOVERNED_EXTERNAL_ACTION_EXECUTION_NOT_FOUND",
      "Governed external action execution was not found"
    );
  }
  return executionFromRow(row);
}

function assertRevision(
  changes: number | bigint,
  id: string,
  revision: number
): void {
  if (Number(changes) === 0) {
    throw new ServiceError(
      "REVISION_CONFLICT",
      `Governed external action approval ${id} no longer has revision ${revision}`
    );
  }
}

export class GovernedExternalActionRepository {
  constructor(private readonly database: GovernanceStorage) {}

  createApproval(input: {
    id?: string;
    targetId: string;
    providerId: string;
    toolName: string;
    argumentsHash: string;
    publicSummary: Record<string, unknown>;
    requestedActor?: GovernanceActorProvenance;
    expiresAt: string;
    now?: string;
  }): GovernedExternalActionApprovalRecord {
    const id = input.id ?? `external_action_approval_${randomUUID()}`;
    const now = nowIso(input.now);
    const actor = input.requestedActor ?? {
      actorType: null,
      actorIdentityHash: null,
      requestIdentityHash: null
    };
    this.database.sqlite
      .prepare(`
        INSERT INTO governed_external_action_approvals (
          id, target_id, provider_id, tool_name, arguments_hash,
          public_summary_json,
          requested_actor_type, requested_actor_identity_hash,
          requested_request_identity_hash,
          decided_actor_type, decided_actor_identity_hash,
          decided_request_identity_hash,
          status, created_at, updated_at, expires_at,
          decided_at, consumed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL,
          'pending', ?, ?, ?, NULL, NULL, 1)
      `)
      .run(
        id,
        input.targetId,
        input.providerId,
        input.toolName,
        input.argumentsHash,
        JSON.stringify(input.publicSummary),
        actor.actorType,
        actor.actorIdentityHash,
        actor.requestIdentityHash,
        now,
        now,
        input.expiresAt
      );
    return this.getApproval(id);
  }

  getApproval(id: string): GovernedExternalActionApprovalRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM governed_external_action_approvals WHERE id = ?")
      .get(id) as ApprovalRow | undefined;
    return requireApproval(row, id);
  }

  countPending(now: string): number {
    const row = this.database.sqlite
      .prepare(`
        SELECT COUNT(*) AS count
        FROM governed_external_action_approvals
        WHERE status = 'pending' AND expires_at > ?
      `)
      .get(now) as { count: number };
    return Number(row.count);
  }

  expireIfNeeded(id: string, now: string): GovernedExternalActionApprovalRecord {
    const current = this.getApproval(id);
    if (
      ["pending", "approved"].includes(current.status) &&
      current.expiresAt <= now
    ) {
      const result = this.database.sqlite
        .prepare(`
          UPDATE governed_external_action_approvals
          SET status = 'expired', updated_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND status IN ('pending', 'approved')
        `)
        .run(now, id, current.revision);
      assertRevision(result.changes, id, current.revision);
    }
    return this.getApproval(id);
  }

  decide(input: {
    id: string;
    expectedRevision: number;
    decision: "approved" | "denied";
    decidedActor?: GovernanceActorProvenance;
    now?: string;
  }): GovernedExternalActionApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_APPROVAL_EXPIRED",
        "Governed external action approval expired"
      );
    }
    if (current.status !== "pending") {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_APPROVAL_INVALID",
        "Only a pending governed external action approval can receive a decision"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertRevision(0, input.id, input.expectedRevision);
    }
    const actor = input.decidedActor ?? {
      actorType: null,
      actorIdentityHash: null,
      requestIdentityHash: null
    };
    const result = this.database.sqlite
      .prepare(`
        UPDATE governed_external_action_approvals
        SET status = ?, decided_actor_type = ?, decided_actor_identity_hash = ?,
            decided_request_identity_hash = ?, decided_at = ?, updated_at = ?,
            revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'pending'
      `)
      .run(
        input.decision,
        actor.actorType,
        actor.actorIdentityHash,
        actor.requestIdentityHash,
        now,
        now,
        input.id,
        input.expectedRevision
      );
    assertRevision(result.changes, input.id, input.expectedRevision);
    return this.getApproval(input.id);
  }

  markStale(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): GovernedExternalActionApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (!["pending", "approved"].includes(current.status)) {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_APPROVAL_INVALID",
        "Only a pending or approved governed external action can become stale"
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE governed_external_action_approvals
        SET status = 'stale', updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status IN ('pending', 'approved')
      `)
      .run(now, input.id, input.expectedRevision);
    assertRevision(result.changes, input.id, input.expectedRevision);
    return this.getApproval(input.id);
  }

  consume(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): GovernedExternalActionApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_APPROVAL_EXPIRED",
        "Governed external action approval expired"
      );
    }
    if (current.status === "consumed") {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_APPROVAL_CONSUMED",
        "Governed external action approval was already consumed"
      );
    }
    if (current.status !== "approved") {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_APPROVAL_REQUIRED",
        "Governed external action requires an approved operator decision"
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE governed_external_action_approvals
        SET status = 'consumed', consumed_at = ?, updated_at = ?,
            revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'approved'
      `)
      .run(now, now, input.id, input.expectedRevision);
    assertRevision(result.changes, input.id, input.expectedRevision);
    return this.getApproval(input.id);
  }

  createExecution(input: {
    id?: string;
    approvalId: string;
    executedActor?: GovernanceActorProvenance;
    now?: string;
  }): GovernedExternalActionExecutionRecord {
    const approval = this.getApproval(input.approvalId);
    if (approval.status !== "consumed") {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_APPROVAL_REQUIRED",
        "Governed external action execution requires a consumed approval"
      );
    }
    const id = input.id ?? `external_action_execution_${randomUUID()}`;
    const now = nowIso(input.now);
    const actor = input.executedActor ?? {
      actorType: null,
      actorIdentityHash: null,
      requestIdentityHash: null
    };
    this.database.sqlite
      .prepare(`
        INSERT INTO governed_external_action_executions (
          id, approval_id, target_id, provider_id, tool_name, arguments_hash,
          verification_status, error_code,
          executed_actor_type, executed_actor_identity_hash,
          executed_request_identity_hash, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'executing', NULL, ?, ?, ?, ?, NULL)
      `)
      .run(
        id,
        approval.id,
        approval.targetId,
        approval.providerId,
        approval.toolName,
        approval.argumentsHash,
        actor.actorType,
        actor.actorIdentityHash,
        actor.requestIdentityHash,
        now
      );
    return this.getExecution(id);
  }

  getExecution(id: string): GovernedExternalActionExecutionRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM governed_external_action_executions WHERE id = ?")
      .get(id) as ExecutionRow | undefined;
    return requireExecution(row, id);
  }

  finishExecution(input: {
    id: string;
    status: Exclude<GovernedExternalActionVerificationStatus, "executing">;
    errorCode?: string | null;
    now?: string;
  }): GovernedExternalActionExecutionRecord {
    const now = nowIso(input.now);
    const current = this.getExecution(input.id);
    if (current.verificationStatus !== "executing") {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_EXECUTION_INVALID",
        "Only an executing governed external action can be finished"
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE governed_external_action_executions
        SET verification_status = ?, error_code = ?, finished_at = ?
        WHERE id = ? AND verification_status = 'executing'
      `)
      .run(input.status, input.errorCode ?? null, now, input.id);
    if (Number(result.changes) === 0) {
      throw new ServiceError(
        "GOVERNED_EXTERNAL_ACTION_EXECUTION_INVALID",
        "Governed external action execution changed before completion"
      );
    }
    return this.getExecution(input.id);
  }
}
