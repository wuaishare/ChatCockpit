import type { ContinuityDatabase } from "../database.js";
import type {
  DirectCommandAuditRecord,
  DirectCommandAuditStatus,
  DirectCommandEffect
} from "../types.js";
import {
  booleanFromSql,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface DirectCommandAuditRow {
  id: string;
  root_id: string;
  workdir: string;
  command_hash: string;
  effect: DirectCommandEffect;
  executor_id: string;
  approval_id: string;
  exit_code: number | null;
  timed_out: number;
  status: DirectCommandAuditStatus;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

function auditFromRow(row: DirectCommandAuditRow): DirectCommandAuditRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    workdir: row.workdir,
    commandHash: row.command_hash,
    effect: row.effect,
    executorId: row.executor_id,
    approvalId: row.approval_id,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    timedOut: booleanFromSql(row.timed_out),
    status: row.status,
    errorCode: row.error_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

export interface CreateDirectCommandAuditInput {
  id?: string;
  rootId: string;
  workdir: string;
  commandHash: string;
  effect: DirectCommandEffect;
  executorId: string;
  approvalId: string;
  exitCode?: number | null;
  timedOut?: boolean;
  status: DirectCommandAuditStatus;
  errorCode?: string | null;
  startedAt: string;
  completedAt?: string | null;
  now?: string;
}

export class DirectCommandAuditRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateDirectCommandAuditInput): DirectCommandAuditRecord {
    const id = input.id ?? newRecordId("direct_command_audit");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_command_audit (
          id, root_id, workdir, command_hash, effect, executor_id,
          approval_id, exit_code, timed_out, status, error_code, started_at,
          completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.rootId,
        input.workdir,
        input.commandHash,
        input.effect,
        input.executorId,
        input.approvalId,
        input.exitCode ?? null,
        input.timedOut ? 1 : 0,
        input.status,
        input.errorCode ?? null,
        input.startedAt,
        input.completedAt ?? null,
        now
      );
    return this.get(id);
  }

  get(id: string): DirectCommandAuditRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM direct_command_audit WHERE id = ?")
      .get(id) as DirectCommandAuditRow | undefined;
    return auditFromRow(requireRecord(row, "Direct command audit", id));
  }

  listByApproval(approvalId: string): DirectCommandAuditRecord[] {
    const rows = this.database.sqlite
      .prepare(
        "SELECT * FROM direct_command_audit WHERE approval_id = ? ORDER BY created_at ASC"
      )
      .all(approvalId) as unknown as DirectCommandAuditRow[];
    return rows.map(auditFromRow);
  }
}
