import type { ContinuityDatabase } from "../database.js";
import type {
  RuntimeRunRecord,
  RuntimeRunStatus
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface RuntimeRunRow {
  id: string;
  session_id: string;
  workspace_id: string;
  runtime_binding_id: string;
  thread_id: string;
  external_turn_id: string | null;
  status: RuntimeRunStatus;
  input_hash: string;
  input_length: number;
  handoff_id: string;
  evidence_bundle_id: string;
  writer_lease_id: string;
  model_loop_owner: "codex";
  approval_policy: "on-request";
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  error_code: string | null;
  revision: number;
}

function runFromRow(row: RuntimeRunRow): RuntimeRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    runtimeBindingId: row.runtime_binding_id,
    threadId: row.thread_id,
    externalTurnId: row.external_turn_id,
    status: row.status,
    inputHash: row.input_hash,
    inputLength: Number(row.input_length),
    handoffId: row.handoff_id,
    evidenceBundleId: row.evidence_bundle_id,
    writerLeaseId: row.writer_lease_id,
    modelLoopOwner: row.model_loop_owner,
    approvalPolicy: row.approval_policy,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    revision: Number(row.revision)
  };
}

export interface CreateRuntimeRunInput {
  id?: string;
  sessionId: string;
  workspaceId: string;
  runtimeBindingId: string;
  threadId: string;
  inputHash: string;
  inputLength: number;
  handoffId: string;
  evidenceBundleId: string;
  writerLeaseId: string;
  now?: string;
}

export class RuntimeRunRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateRuntimeRunInput): RuntimeRunRecord {
    const id = input.id ?? newRecordId("runtime_run");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO runtime_runs (
          id, session_id, workspace_id, runtime_binding_id, thread_id,
          external_turn_id, status, input_hash, input_length, handoff_id,
          evidence_bundle_id, writer_lease_id, model_loop_owner,
          approval_policy, started_at, updated_at, completed_at,
          error_code, revision
        ) VALUES (
          ?, ?, ?, ?, ?, NULL, 'starting', ?, ?, ?, ?, ?, 'codex',
          'on-request', ?, ?, NULL, NULL, 1
        )
      `)
      .run(
        id,
        input.sessionId,
        input.workspaceId,
        input.runtimeBindingId,
        input.threadId,
        input.inputHash,
        input.inputLength,
        input.handoffId,
        input.evidenceBundleId,
        input.writerLeaseId,
        now,
        now
      );
    return this.get(id);
  }

  get(id: string): RuntimeRunRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_runs WHERE id = ?")
      .get(id) as RuntimeRunRow | undefined;
    return runFromRow(requireRecord(row, "Runtime run", id));
  }

  getActiveBySession(sessionId: string): RuntimeRunRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_runs
        WHERE session_id = ?
          AND status IN ('starting', 'running', 'waiting-approval')
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get(sessionId) as RuntimeRunRow | undefined;
    return row ? runFromRow(row) : null;
  }

  findActiveByThread(threadId: string): RuntimeRunRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_runs
        WHERE thread_id = ?
          AND status IN ('starting', 'running', 'waiting-approval')
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get(threadId) as RuntimeRunRow | undefined;
    return row ? runFromRow(row) : null;
  }

  findByTurn(threadId: string, turnId: string): RuntimeRunRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_runs
        WHERE thread_id = ? AND external_turn_id = ?
        LIMIT 1
      `)
      .get(threadId, turnId) as RuntimeRunRow | undefined;
    return row ? runFromRow(row) : null;
  }

  attachTurn(
    id: string,
    turnId: string,
    expectedRevision: number,
    now?: string
  ): RuntimeRunRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_runs
        SET external_turn_id = ?, status = 'running', updated_at = ?,
            revision = revision + 1
        WHERE id = ? AND status = 'starting' AND revision = ?
      `)
      .run(turnId, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Runtime run", id, expectedRevision);
    return this.get(id);
  }

  updateStatus(
    id: string,
    status: RuntimeRunStatus,
    expectedRevision: number,
    options: {
      now?: string;
      completedAt?: string | null;
      errorCode?: string | null;
    } = {}
  ): RuntimeRunRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_runs
        SET status = ?, updated_at = ?, completed_at = ?, error_code = ?,
            revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(
        status,
        nowIso(options.now),
        options.completedAt ?? null,
        options.errorCode ?? null,
        id,
        expectedRevision
      );
    assertUpdated(result.changes, "Runtime run", id, expectedRevision);
    return this.get(id);
  }
}
