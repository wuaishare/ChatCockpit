import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  DirectProcessApprovalRecord,
  DirectProcessOperation,
  DirectProcessScope
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface DirectProcessApprovalRow {
  id: string;
  operation: DirectProcessOperation;
  process_id: string | null;
  scope: DirectProcessScope;
  action_hash: string;
  root_id: string | null;
  workdir: string | null;
  command: string | null;
  workspace_id: string | null;
  repo_id: string | null;
  session_id: string | null;
  writer_lease_id: string | null;
  authorization_grant_id: string | null;
  executor_id: string;
  input_hash: string | null;
  input_bytes: number | null;
  status: DirectProcessApprovalRecord["status"];
  public_summary_json: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  consumed_at: string | null;
  revision: number;
}

function parsePublicSummary(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid public summary");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      "Stored Direct process approval summary is invalid"
    );
  }
}

function approvalFromRow(row: DirectProcessApprovalRow): DirectProcessApprovalRecord {
  return {
    id: row.id,
    operation: row.operation,
    processId: row.process_id,
    scope: row.scope,
    actionHash: row.action_hash,
    rootId: row.root_id,
    workdir: row.workdir,
    command: row.command,
    workspaceId: row.workspace_id,
    repoId: row.repo_id,
    sessionId: row.session_id,
    writerLeaseId: row.writer_lease_id,
    authorizationGrantId: row.authorization_grant_id,
    executorId: row.executor_id,
    inputHash: row.input_hash,
    inputBytes: row.input_bytes === null ? null : Number(row.input_bytes),
    status: row.status,
    publicSummary: parsePublicSummary(row.public_summary_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
    revision: Number(row.revision)
  };
}

export interface CreateDirectProcessApprovalInput {
  id?: string;
  operation: DirectProcessOperation;
  processId?: string | null;
  scope?: DirectProcessScope;
  actionHash: string;
  rootId?: string | null;
  workdir?: string | null;
  command?: string | null;
  workspaceId?: string | null;
  repoId?: string | null;
  sessionId?: string | null;
  writerLeaseId?: string | null;
  authorizationGrantId?: string | null;
  executorId: string;
  inputHash?: string | null;
  inputBytes?: number | null;
  publicSummary: Record<string, unknown>;
  expiresAt: string;
  now?: string;
}

export class DirectProcessApprovalRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateDirectProcessApprovalInput): DirectProcessApprovalRecord {
    const id = input.id ?? newRecordId("direct_process_approval");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_process_approvals (
          id, operation, process_id, scope, action_hash, root_id, workdir, command,
          workspace_id, repo_id, session_id, writer_lease_id, authorization_grant_id,
          executor_id, input_hash, input_bytes, status, public_summary_json, created_at,
          expires_at, decided_at, consumed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, 1)
      `)
      .run(
        id,
        input.operation,
        input.processId ?? null,
        input.scope ?? "workspace",
        input.actionHash,
        input.rootId ?? null,
        input.workdir ?? null,
        input.command ?? null,
        input.workspaceId ?? null,
        input.repoId ?? null,
        input.sessionId ?? null,
        input.writerLeaseId ?? null,
        input.authorizationGrantId ?? null,
        input.executorId,
        input.inputHash ?? null,
        input.inputBytes ?? null,
        JSON.stringify(input.publicSummary),
        now,
        input.expiresAt
      );
    return this.get(id);
  }

  get(id: string): DirectProcessApprovalRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM direct_process_approvals WHERE id = ?")
      .get(id) as DirectProcessApprovalRow | undefined;
    return approvalFromRow(requireRecord(row, "Direct process approval", id));
  }

  countPending(now: string): number {
    const row = this.database.sqlite
      .prepare(`
        SELECT COUNT(*) AS count
        FROM direct_process_approvals
        WHERE status = 'pending' AND expires_at > ?
      `)
      .get(now) as { count: number };
    return Number(row.count);
  }

  listPending(now: string, limit = 50): DirectProcessApprovalRecord[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = this.database.sqlite
      .prepare(`
        SELECT *
        FROM direct_process_approvals
        WHERE status = 'pending' AND expires_at > ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `)
      .all(now, boundedLimit) as unknown as DirectProcessApprovalRow[];
    return rows.map(approvalFromRow);
  }

  expireIfNeeded(id: string, now: string): DirectProcessApprovalRecord {
    const current = this.get(id);
    if (["pending", "approved"].includes(current.status) && current.expiresAt <= now) {
      const result = this.database.sqlite
        .prepare(`
          UPDATE direct_process_approvals
          SET status = 'expired', revision = revision + 1
          WHERE id = ? AND revision = ? AND status IN ('pending', 'approved')
        `)
        .run(id, current.revision);
      assertUpdated(
        result.changes,
        "Direct process approval",
        id,
        current.revision
      );
    }
    return this.get(id);
  }

  decide(input: {
    id: string;
    decision: "approved" | "denied";
    expectedRevision: number;
    now?: string;
  }): DirectProcessApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_EXPIRED",
        "Host process approval expired"
      );
    }
    if (current.status !== "pending") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_INVALID",
        "Only a pending Host process approval can receive a decision"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(0, "Direct process approval", input.id, input.expectedRevision);
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_approvals
        SET status = ?, decided_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'pending'
      `)
      .run(input.decision, now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct process approval",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }

  consume(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): DirectProcessApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_EXPIRED",
        "Host process approval expired"
      );
    }
    if (current.status === "consumed") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_CONSUMED",
        "Host process approval was already consumed"
      );
    }
    if (current.status !== "approved") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_REQUIRED",
        "Host process requires an approved Direct Process approval"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(0, "Direct process approval", input.id, input.expectedRevision);
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_approvals
        SET status = 'consumed', consumed_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'approved'
      `)
      .run(now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct process approval",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }
}
