import type { ContinuityDatabase } from "../database.js";
import type {
  DirectProcessAuditOperation,
  DirectProcessAuditRecord,
  DirectProcessAuditStatus
} from "../types.js";
import {
  booleanFromSql,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface DirectProcessAuditRow {
  id: string;
  operation: DirectProcessAuditOperation;
  process_id: string;
  action_hash: string;
  approval_id: string | null;
  status: DirectProcessAuditStatus;
  error_code: string | null;
  terminal_reason: string | null;
  exit_code: number | null;
  output_bytes: number;
  output_truncated: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

function auditFromRow(row: DirectProcessAuditRow): DirectProcessAuditRecord {
  return {
    id: row.id,
    operation: row.operation,
    processId: row.process_id,
    actionHash: row.action_hash,
    approvalId: row.approval_id,
    status: row.status,
    errorCode: row.error_code,
    terminalReason: row.terminal_reason,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    outputBytes: Number(row.output_bytes),
    outputTruncated: booleanFromSql(row.output_truncated),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

export interface CreateDirectProcessAuditInput {
  id?: string;
  operation: DirectProcessAuditOperation;
  processId: string;
  actionHash: string;
  approvalId?: string | null;
  status: DirectProcessAuditStatus;
  errorCode?: string | null;
  terminalReason?: string | null;
  exitCode?: number | null;
  outputBytes?: number;
  outputTruncated?: boolean;
  startedAt: string;
  completedAt?: string | null;
  now?: string;
}

export class DirectProcessAuditRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateDirectProcessAuditInput): DirectProcessAuditRecord {
    const id = input.id ?? newRecordId("direct_process_audit");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_process_audit (
          id, operation, process_id, action_hash, approval_id, status,
          error_code, terminal_reason, exit_code, output_bytes,
          output_truncated, started_at, completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.operation,
        input.processId,
        input.actionHash,
        input.approvalId ?? null,
        input.status,
        input.errorCode ?? null,
        input.terminalReason ?? null,
        input.exitCode ?? null,
        input.outputBytes ?? 0,
        input.outputTruncated ? 1 : 0,
        input.startedAt,
        input.completedAt ?? null,
        now
      );
    return this.get(id);
  }

  get(id: string): DirectProcessAuditRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM direct_process_audit WHERE id = ?")
      .get(id) as DirectProcessAuditRow | undefined;
    return auditFromRow(requireRecord(row, "Direct process audit", id));
  }

  listByProcess(processId: string): DirectProcessAuditRecord[] {
    const rows = this.database.sqlite
      .prepare(
        "SELECT * FROM direct_process_audit WHERE process_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(processId) as unknown as DirectProcessAuditRow[];
    return rows.map(auditFromRow);
  }

  listByApproval(approvalId: string): DirectProcessAuditRecord[] {
    const rows = this.database.sqlite
      .prepare(
        "SELECT * FROM direct_process_audit WHERE approval_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(approvalId) as unknown as DirectProcessAuditRow[];
    return rows.map(auditFromRow);
  }
}
