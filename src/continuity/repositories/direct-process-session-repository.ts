import type { ContinuityDatabase } from "../database.js";
import type {
  DirectProcessSessionRecord,
  DirectProcessStatus
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface DirectProcessSessionRow {
  id: string;
  root_id: string;
  workdir: string;
  command: string;
  command_hash: string;
  executor_id: string;
  workspace_id: string;
  repo_id: string;
  session_id: string;
  writer_lease_id: string;
  private_pid: number | null;
  status: DirectProcessStatus;
  exit_code: number | null;
  stale_reason: string | null;
  evidence_bundle_id: string | null;
  started_at: string;
  completed_at: string | null;
  revision: number;
}

function sessionFromRow(row: DirectProcessSessionRow): DirectProcessSessionRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    workdir: row.workdir,
    command: row.command,
    commandHash: row.command_hash,
    executorId: row.executor_id,
    workspaceId: row.workspace_id,
    repoId: row.repo_id,
    sessionId: row.session_id,
    writerLeaseId: row.writer_lease_id,
    privatePid: row.private_pid === null ? null : Number(row.private_pid),
    status: row.status,
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    staleReason: row.stale_reason,
    evidenceBundleId: row.evidence_bundle_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    revision: Number(row.revision)
  };
}

export interface CreateDirectProcessSessionInput {
  id?: string;
  rootId: string;
  workdir: string;
  command: string;
  commandHash: string;
  executorId: string;
  workspaceId: string;
  repoId: string;
  sessionId: string;
  writerLeaseId: string;
  evidenceBundleId?: string | null;
  now?: string;
}

export interface CreateRunningDirectProcessSessionInput
  extends CreateDirectProcessSessionInput {
  privatePid: number;
}

export class DirectProcessSessionRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  createStarting(
    input: CreateDirectProcessSessionInput
  ): DirectProcessSessionRecord {
    const id = input.id ?? newRecordId("host_process");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_process_sessions (
          id, root_id, workdir, command, command_hash, executor_id,
          workspace_id, repo_id, session_id, writer_lease_id, private_pid,
          status, exit_code, stale_reason, evidence_bundle_id, started_at,
          completed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'starting', NULL, NULL, ?, ?, NULL, 1)
      `)
      .run(
        id,
        input.rootId,
        input.workdir,
        input.command,
        input.commandHash,
        input.executorId,
        input.workspaceId,
        input.repoId,
        input.sessionId,
        input.writerLeaseId,
        input.evidenceBundleId ?? null,
        now
      );
    return this.get(id);
  }

  createRunning(
    input: CreateRunningDirectProcessSessionInput
  ): DirectProcessSessionRecord {
    const id = input.id ?? newRecordId("host_process");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_process_sessions (
          id, root_id, workdir, command, command_hash, executor_id,
          workspace_id, repo_id, session_id, writer_lease_id, private_pid,
          status, exit_code, stale_reason, evidence_bundle_id, started_at,
          completed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, ?, ?, NULL, 1)
      `)
      .run(
        id,
        input.rootId,
        input.workdir,
        input.command,
        input.commandHash,
        input.executorId,
        input.workspaceId,
        input.repoId,
        input.sessionId,
        input.writerLeaseId,
        input.privatePid,
        input.evidenceBundleId ?? null,
        now
      );
    return this.get(id);
  }

  get(id: string): DirectProcessSessionRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM direct_process_sessions WHERE id = ?")
      .get(id) as DirectProcessSessionRow | undefined;
    return sessionFromRow(requireRecord(row, "Direct process session", id));
  }

  list(input: {
    workspaceId?: string;
    sessionId?: string;
    status?: DirectProcessStatus;
  } = {}): DirectProcessSessionRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (input.workspaceId) {
      clauses.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input.sessionId) {
      clauses.push("session_id = ?");
      params.push(input.sessionId);
    }
    if (input.status) {
      clauses.push("status = ?");
      params.push(input.status);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.sqlite
      .prepare(
        `SELECT * FROM direct_process_sessions${where} ORDER BY started_at ASC, id ASC`
      )
      .all(...params) as unknown as DirectProcessSessionRow[];
    return rows.map(sessionFromRow);
  }

  countActive(input: { workspaceId?: string; sessionId?: string } = {}): number {
    return this.countByStatusClause("status IN ('starting', 'running')", input);
  }

  countRunning(input: { workspaceId?: string; sessionId?: string } = {}): number {
    return this.countByStatusClause("status = 'running'", input);
  }

  attachStarted(input: {
    id: string;
    privatePid: number;
    expectedRevision: number;
  }): DirectProcessSessionRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_sessions
        SET private_pid = ?, status = 'running', revision = revision + 1
        WHERE id = ? AND status = 'starting' AND revision = ?
      `)
      .run(input.privatePid, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct process session",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }

  setEvidenceBundle(input: {
    id: string;
    evidenceBundleId: string;
    expectedRevision: number;
  }): DirectProcessSessionRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_sessions
        SET evidence_bundle_id = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(input.evidenceBundleId, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct process session",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }

  complete(input: {
    id: string;
    status: Exclude<DirectProcessStatus, "starting" | "running" | "stale">;
    exitCode?: number | null;
    expectedRevision: number;
    now?: string;
  }): DirectProcessSessionRecord {
    const now = nowIso(input.now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_sessions
        SET status = ?, exit_code = ?, stale_reason = NULL, completed_at = ?,
            revision = revision + 1
        WHERE id = ? AND status IN ('starting', 'running') AND revision = ?
      `)
      .run(
        input.status,
        input.exitCode ?? null,
        now,
        input.id,
        input.expectedRevision
      );
    assertUpdated(
      result.changes,
      "Direct process session",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }

  markStale(input: {
    id: string;
    reason: string;
    expectedRevision: number;
    now?: string;
  }): DirectProcessSessionRecord {
    const now = nowIso(input.now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_sessions
        SET status = 'stale', stale_reason = ?, completed_at = ?,
            revision = revision + 1
        WHERE id = ? AND status IN ('starting', 'running') AND revision = ?
      `)
      .run(input.reason, now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct process session",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }

  markAllRunningStale(input: {
    reason: string;
    now?: string;
  }): number {
    const now = nowIso(input.now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_sessions
        SET status = 'stale', stale_reason = ?, completed_at = ?,
            revision = revision + 1
        WHERE status IN ('starting', 'running')
      `)
      .run(input.reason, now);
    return Number(result.changes);
  }

  private countByStatusClause(
    statusClause: string,
    input: { workspaceId?: string; sessionId?: string }
  ): number {
    const clauses = [statusClause];
    const params: string[] = [];
    if (input.workspaceId) {
      clauses.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input.sessionId) {
      clauses.push("session_id = ?");
      params.push(input.sessionId);
    }
    const row = this.database.sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM direct_process_sessions WHERE ${clauses.join(" AND ")}`
      )
      .get(...params) as { count: number };
    return Number(row.count);
  }
}
