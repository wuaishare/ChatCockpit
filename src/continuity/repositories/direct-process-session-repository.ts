import type { ContinuityDatabase } from "../database.js";
import type {
  DirectProcessScope,
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
  scope: DirectProcessScope;
  root_id: string;
  workdir: string;
  command: string;
  command_hash: string;
  executor_id: string;
  workspace_id: string | null;
  repo_id: string | null;
  session_id: string | null;
  writer_lease_id: string | null;
  host_authority_id: string | null;
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
    scope: row.scope,
    rootId: row.root_id,
    workdir: row.workdir,
    command: row.command,
    commandHash: row.command_hash,
    executorId: row.executor_id,
    workspaceId: row.workspace_id,
    repoId: row.repo_id,
    sessionId: row.session_id,
    writerLeaseId: row.writer_lease_id,
    hostAuthorityId: row.host_authority_id,
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
  scope?: DirectProcessScope;
  rootId: string;
  workdir: string;
  command: string;
  commandHash: string;
  executorId: string;
  workspaceId?: string | null;
  repoId?: string | null;
  sessionId?: string | null;
  writerLeaseId?: string | null;
  hostAuthorityId?: string | null;
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
          id, scope, root_id, workdir, command, command_hash, executor_id,
          workspace_id, repo_id, session_id, writer_lease_id, host_authority_id,
          private_pid, status, exit_code, stale_reason, evidence_bundle_id,
          started_at, completed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'starting', NULL, NULL, ?, ?, NULL, 1)
      `)
      .run(
        id,
        input.scope ?? "workspace",
        input.rootId,
        input.workdir,
        input.command,
        input.commandHash,
        input.executorId,
        input.workspaceId ?? null,
        input.repoId ?? null,
        input.sessionId ?? null,
        input.writerLeaseId ?? null,
        input.hostAuthorityId ?? null,
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
          id, scope, root_id, workdir, command, command_hash, executor_id,
          workspace_id, repo_id, session_id, writer_lease_id, host_authority_id,
          private_pid, status, exit_code, stale_reason, evidence_bundle_id,
          started_at, completed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, ?, ?, NULL, 1)
      `)
      .run(
        id,
        input.scope ?? "workspace",
        input.rootId,
        input.workdir,
        input.command,
        input.commandHash,
        input.executorId,
        input.workspaceId ?? null,
        input.repoId ?? null,
        input.sessionId ?? null,
        input.writerLeaseId ?? null,
        input.hostAuthorityId ?? null,
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
    scope?: DirectProcessScope;
    workspaceId?: string;
    sessionId?: string;
    hostAuthorityId?: string;
    status?: DirectProcessStatus;
  } = {}): DirectProcessSessionRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (input.scope) {
      clauses.push("scope = ?");
      params.push(input.scope);
    }
    if (input.workspaceId) {
      clauses.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input.sessionId) {
      clauses.push("session_id = ?");
      params.push(input.sessionId);
    }
    if (input.hostAuthorityId) {
      clauses.push("host_authority_id = ?");
      params.push(input.hostAuthorityId);
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

  countActive(input: {
    scope?: DirectProcessScope;
    workspaceId?: string;
    sessionId?: string;
    hostAuthorityId?: string;
  } = {}): number {
    return this.countByStatusClause("status IN ('starting', 'running')", input);
  }

  countRunning(input: {
    scope?: DirectProcessScope;
    workspaceId?: string;
    sessionId?: string;
    hostAuthorityId?: string;
  } = {}): number {
    return this.countByStatusClause("status = 'running'", input);
  }

  attachManaged(input: {
    id: string;
    expectedRevision: number;
  }): DirectProcessSessionRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_sessions
        SET status = 'running', revision = revision + 1
        WHERE id = ? AND status = 'starting' AND private_pid IS NULL AND revision = ?
      `)
      .run(input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct process session",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
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
    input: {
      scope?: DirectProcessScope;
      workspaceId?: string;
      sessionId?: string;
      hostAuthorityId?: string;
    }
  ): number {
    const clauses = [statusClause];
    const params: string[] = [];
    if (input.scope) {
      clauses.push("scope = ?");
      params.push(input.scope);
    }
    if (input.workspaceId) {
      clauses.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input.sessionId) {
      clauses.push("session_id = ?");
      params.push(input.sessionId);
    }
    if (input.hostAuthorityId) {
      clauses.push("host_authority_id = ?");
      params.push(input.hostAuthorityId);
    }
    const row = this.database.sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM direct_process_sessions WHERE ${clauses.join(" AND ")}`
      )
      .get(...params) as { count: number };
    return Number(row.count);
  }
}
