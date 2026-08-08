import type { ContinuityDatabase } from "../database.js";
import type {
  DirectMutationAuditRecord,
  DirectMutationAuditStatus,
  DirectMutationOperation
} from "../types.js";
import { newRecordId, nowIso, requireRecord } from "./repository-utils.js";

interface DirectMutationAuditRow {
  id: string;
  operation: DirectMutationOperation;
  root_id: string;
  relative_path: string;
  before_hash: string | null;
  after_hash: string | null;
  executor_id: string;
  approval_id: string;
  status: DirectMutationAuditStatus;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

function auditFromRow(row: DirectMutationAuditRow): DirectMutationAuditRecord {
  return {
    id: row.id,
    operation: row.operation,
    rootId: row.root_id,
    relativePath: row.relative_path,
    beforeHash: row.before_hash,
    afterHash: row.after_hash,
    executorId: row.executor_id,
    approvalId: row.approval_id,
    status: row.status,
    errorCode: row.error_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

export interface CreateDirectMutationAuditInput {
  id?: string;
  operation: DirectMutationOperation;
  rootId: string;
  relativePath: string;
  beforeHash: string | null;
  afterHash: string | null;
  executorId: string;
  approvalId: string;
  status: DirectMutationAuditStatus;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  now?: string;
}

export class DirectMutationAuditRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateDirectMutationAuditInput): DirectMutationAuditRecord {
    const id = input.id ?? newRecordId("direct_audit");
    const createdAt = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_mutation_audit (
          id, operation, root_id, relative_path, before_hash, after_hash,
          executor_id, approval_id, status, error_code, started_at,
          completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.operation,
        input.rootId,
        input.relativePath,
        input.beforeHash,
        input.afterHash,
        input.executorId,
        input.approvalId,
        input.status,
        input.errorCode,
        input.startedAt,
        input.completedAt,
        createdAt
      );
    return this.get(id);
  }

  get(id: string): DirectMutationAuditRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM direct_mutation_audit WHERE id = ?")
      .get(id) as DirectMutationAuditRow | undefined;
    return auditFromRow(requireRecord(row, "Direct mutation audit", id));
  }
}
