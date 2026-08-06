import type { ContinuityDatabase } from "../database.js";
import type {
  RuntimeApprovalKind,
  RuntimeApprovalRecord,
  RuntimeApprovalStatus
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface RuntimeApprovalRow {
  id: string;
  run_id: string;
  session_id: string;
  workspace_id: string;
  thread_id: string;
  turn_id: string;
  item_id: string | null;
  request_key: string;
  server_request_id_json: string;
  request_method: string;
  kind: RuntimeApprovalKind;
  status: RuntimeApprovalStatus;
  public_summary_json: string;
  private_request_json: string;
  decision_json: string | null;
  received_at: string;
  responded_at: string | null;
  resolved_at: string | null;
  revision: number;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The database invariant is reported below.
  }
  throw new Error(`${label} is not a JSON object`);
}

function approvalFromRow(row: RuntimeApprovalRow): RuntimeApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    requestMethod: row.request_method,
    kind: row.kind,
    status: row.status,
    publicSummary: parseObject(row.public_summary_json, "Approval public summary"),
    decision: row.decision_json
      ? parseObject(row.decision_json, "Approval decision")
      : null,
    receivedAt: row.received_at,
    respondedAt: row.responded_at,
    resolvedAt: row.resolved_at,
    revision: Number(row.revision)
  };
}

export interface CreateRuntimeApprovalInput {
  id?: string;
  runId: string;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  turnId: string;
  itemId?: string | null;
  requestKey: string;
  serverRequestId: string | number;
  requestMethod: string;
  kind: RuntimeApprovalKind;
  publicSummary: Record<string, unknown>;
  privateRequest: Record<string, unknown>;
  now?: string;
}

export interface PrivateRuntimeApproval {
  record: RuntimeApprovalRecord;
  requestKey: string;
  serverRequestId: string | number;
  privateRequest: Record<string, unknown>;
}

export class RuntimeApprovalRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateRuntimeApprovalInput): RuntimeApprovalRecord {
    const id = input.id ?? newRecordId("runtime_approval");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO runtime_approvals (
          id, run_id, session_id, workspace_id, thread_id, turn_id,
          item_id, request_key, server_request_id_json, request_method,
          kind, status, public_summary_json, private_request_json,
          decision_json, received_at, responded_at, resolved_at, revision
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL,
          ?, NULL, NULL, 1
        )
      `)
      .run(
        id,
        input.runId,
        input.sessionId,
        input.workspaceId,
        input.threadId,
        input.turnId,
        input.itemId ?? null,
        input.requestKey,
        JSON.stringify(input.serverRequestId),
        input.requestMethod,
        input.kind,
        JSON.stringify(input.publicSummary),
        JSON.stringify(input.privateRequest),
        now
      );
    return this.get(id);
  }

  get(id: string): RuntimeApprovalRecord {
    return approvalFromRow(this.getRow(id));
  }

  getPrivate(id: string): PrivateRuntimeApproval {
    const row = this.getRow(id);
    return {
      record: approvalFromRow(row),
      requestKey: row.request_key,
      serverRequestId: JSON.parse(row.server_request_id_json) as string | number,
      privateRequest: parseObject(row.private_request_json, "Approval private request")
    };
  }

  findByRequestKey(requestKey: string): RuntimeApprovalRecord | null {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_approvals WHERE request_key = ?")
      .get(requestKey) as RuntimeApprovalRow | undefined;
    return row ? approvalFromRow(row) : null;
  }

  listPendingByWorkspace(workspaceId: string): RuntimeApprovalRecord[] {
    const rows = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_approvals
        WHERE workspace_id = ? AND status IN ('pending', 'responded')
        ORDER BY received_at ASC
      `)
      .all(workspaceId) as unknown as RuntimeApprovalRow[];
    return rows.map(approvalFromRow);
  }

  listPending(sessionId?: string): RuntimeApprovalRecord[] {
    const rows = sessionId
      ? (this.database.sqlite
          .prepare(`
            SELECT * FROM runtime_approvals
            WHERE session_id = ? AND status IN ('pending', 'responded')
            ORDER BY received_at ASC
          `)
          .all(sessionId) as unknown as RuntimeApprovalRow[])
      : (this.database.sqlite
          .prepare(`
            SELECT * FROM runtime_approvals
            WHERE status IN ('pending', 'responded')
            ORDER BY received_at ASC
          `)
          .all() as unknown as RuntimeApprovalRow[]);
    return rows.map(approvalFromRow);
  }

  markResponded(
    id: string,
    decision: Record<string, unknown>,
    expectedRevision: number,
    respondedAt?: string
  ): RuntimeApprovalRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_approvals
        SET status = CASE
              WHEN status = 'resolved' THEN 'resolved'
              ELSE 'responded'
            END,
            decision_json = ?, responded_at = ?, revision = revision + 1
        WHERE id = ? AND status IN ('pending', 'resolved') AND revision = ?
      `)
      .run(JSON.stringify(decision), nowIso(respondedAt), id, expectedRevision);
    assertUpdated(result.changes, "Runtime approval", id, expectedRevision);
    return this.get(id);
  }

  markResolvedByRequestKey(
    requestKey: string,
    resolvedAt?: string
  ): RuntimeApprovalRecord | null {
    const existing = this.findByRequestKey(requestKey);
    if (!existing || !["pending", "responded"].includes(existing.status)) {
      return existing;
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_approvals
        SET status = 'resolved', resolved_at = ?, revision = revision + 1
        WHERE request_key = ? AND status IN ('pending', 'responded')
      `)
      .run(nowIso(resolvedAt), requestKey);
    if (Number(result.changes) !== 1) {
      return this.findByRequestKey(requestKey);
    }
    return this.findByRequestKey(requestKey);
  }

  markStale(id: string, expectedRevision: number): RuntimeApprovalRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_approvals
        SET status = 'stale', revision = revision + 1
        WHERE id = ? AND status IN ('pending', 'responded') AND revision = ?
      `)
      .run(id, expectedRevision);
    assertUpdated(result.changes, "Runtime approval", id, expectedRevision);
    return this.get(id);
  }

  private getRow(id: string): RuntimeApprovalRow {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_approvals WHERE id = ?")
      .get(id) as RuntimeApprovalRow | undefined;
    return requireRecord(row, "Runtime approval", id);
  }
}
