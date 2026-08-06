import type { ContinuityDatabase } from "../database.js";
import type {
  DevelopmentSessionRecord,
  SessionMode,
  SessionStatus
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface SessionRow {
  id: string;
  project_id: string;
  workspace_id: string;
  task_id: string;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  active_runtime_binding_id: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  revision: number;
}

function sessionFromRow(row: SessionRow): DevelopmentSessionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    activeRuntimeBindingId: row.active_runtime_binding_id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    revision: Number(row.revision)
  };
}

export interface CreateSessionInput {
  id?: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  title: string;
  mode: SessionMode;
  status?: SessionStatus;
  startedAt?: string;
}

export class SessionRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateSessionInput): DevelopmentSessionRecord {
    const id = input.id ?? newRecordId("session");
    const startedAt = nowIso(input.startedAt);
    this.database.sqlite
      .prepare(`
        INSERT INTO development_sessions (
          id, project_id, workspace_id, task_id, title, mode, status,
          active_runtime_binding_id, started_at, updated_at, ended_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 1)
      `)
      .run(
        id,
        input.projectId,
        input.workspaceId,
        input.taskId,
        input.title,
        input.mode,
        input.status ?? "idle",
        startedAt,
        startedAt
      );
    return this.get(id);
  }

  get(id: string): DevelopmentSessionRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM development_sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    return sessionFromRow(requireRecord(row, "Development session", id));
  }

  listByTask(taskId: string): DevelopmentSessionRecord[] {
    const rows = this.database.sqlite
      .prepare(
        "SELECT * FROM development_sessions WHERE task_id = ? ORDER BY started_at ASC"
      )
      .all(taskId) as unknown as SessionRow[];
    return rows.map(sessionFromRow);
  }

  updateStatus(
    id: string,
    status: SessionStatus,
    expectedRevision: number,
    options: { now?: string; endedAt?: string | null } = {}
  ): DevelopmentSessionRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE development_sessions
        SET status = ?, updated_at = ?, ended_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(
        status,
        nowIso(options.now),
        options.endedAt ?? null,
        id,
        expectedRevision
      );
    assertUpdated(result.changes, "Development session", id, expectedRevision);
    return this.get(id);
  }

  bindRuntime(
    id: string,
    runtimeBindingId: string | null,
    expectedRevision: number,
    now?: string
  ): DevelopmentSessionRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE development_sessions
        SET active_runtime_binding_id = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(runtimeBindingId, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Development session", id, expectedRevision);
    return this.get(id);
  }
}
