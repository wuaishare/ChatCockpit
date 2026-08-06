import type { ContinuityDatabase } from "../database.js";
import type {
  TaskExecutionPolicy,
  TaskPriority,
  TaskRecord,
  TaskStatus
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface TaskRow {
  id: string;
  project_id: string;
  workspace_id: string;
  spec_id: string | null;
  spec_version: number | null;
  plan_id: string | null;
  plan_version: number | null;
  parent_task_id: string | null;
  title: string;
  goal: string;
  status: TaskStatus;
  priority: TaskPriority;
  execution_policy: TaskExecutionPolicy;
  active_session_id: string | null;
  latest_handoff_id: string | null;
  latest_evidence_bundle_id: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

function taskFromRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    specId: row.spec_id,
    specVersion: row.spec_version === null ? null : Number(row.spec_version),
    planId: row.plan_id,
    planVersion: row.plan_version === null ? null : Number(row.plan_version),
    parentTaskId: row.parent_task_id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    priority: row.priority,
    executionPolicy: row.execution_policy,
    activeSessionId: row.active_session_id,
    latestHandoffId: row.latest_handoff_id,
    latestEvidenceBundleId: row.latest_evidence_bundle_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };
}

export interface CreateTaskInput {
  id?: string;
  projectId: string;
  workspaceId: string;
  specId?: string | null;
  specVersion?: number | null;
  planId?: string | null;
  planVersion?: number | null;
  parentTaskId?: string | null;
  title: string;
  goal: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  executionPolicy?: TaskExecutionPolicy;
  now?: string;
}

export class TaskRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateTaskInput): TaskRecord {
    const id = input.id ?? newRecordId("task");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO tasks (
          id, project_id, workspace_id, spec_id, spec_version,
          plan_id, plan_version, parent_task_id,
          title, goal, status, priority, execution_policy, active_session_id,
          latest_handoff_id, latest_evidence_bundle_id,
          created_at, updated_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1)
      `)
      .run(
        id,
        input.projectId,
        input.workspaceId,
        input.specId ?? null,
        input.specVersion ?? null,
        input.planId ?? null,
        input.planVersion ?? null,
        input.parentTaskId ?? null,
        input.title,
        input.goal,
        input.status ?? "backlog",
        input.priority ?? "normal",
        input.executionPolicy ?? "planning-optional",
        now,
        now
      );
    return this.get(id);
  }

  get(id: string): TaskRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as TaskRow | undefined;
    return taskFromRow(requireRecord(row, "Task", id));
  }

  listByWorkspace(workspaceId: string): TaskRecord[] {
    const rows = this.database.sqlite
      .prepare(
        "SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC, created_at ASC"
      )
      .all(workspaceId) as unknown as TaskRow[];
    return rows.map(taskFromRow);
  }

  listByProject(projectId: string, status?: TaskStatus): TaskRecord[] {
    const rows = status
      ? (this.database.sqlite
          .prepare(
            "SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY created_at ASC"
          )
          .all(projectId, status) as unknown as TaskRow[])
      : (this.database.sqlite
          .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
          .all(projectId) as unknown as TaskRow[]);
    return rows.map(taskFromRow);
  }

  updateStatus(
    id: string,
    status: TaskStatus,
    expectedRevision: number,
    now?: string
  ): TaskRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE tasks
        SET status = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(status, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Task", id, expectedRevision);
    return this.get(id);
  }

  bindSession(
    id: string,
    sessionId: string | null,
    expectedRevision: number,
    now?: string
  ): TaskRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE tasks
        SET active_session_id = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(sessionId, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Task", id, expectedRevision);
    return this.get(id);
  }

  bindDocuments(
    id: string,
    input: {
      specId: string | null;
      specVersion: number | null;
      planId: string | null;
      planVersion: number | null;
      expectedRevision: number;
      now?: string;
    }
  ): TaskRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE tasks
        SET spec_id = ?, spec_version = ?, plan_id = ?, plan_version = ?,
            updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(
        input.specId,
        input.specVersion,
        input.planId,
        input.planVersion,
        nowIso(input.now),
        id,
        input.expectedRevision
      );
    assertUpdated(
      result.changes,
      "Task",
      id,
      input.expectedRevision
    );
    return this.get(id);
  }

  setLatestHandoff(
    id: string,
    handoffId: string,
    expectedRevision: number,
    now?: string
  ): TaskRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE tasks
        SET latest_handoff_id = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(handoffId, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Task", id, expectedRevision);
    return this.get(id);
  }

  setLatestEvidenceBundle(
    id: string,
    bundleId: string,
    expectedRevision: number,
    now?: string
  ): TaskRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE tasks
        SET latest_evidence_bundle_id = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(bundleId, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Task", id, expectedRevision);
    return this.get(id);
  }
}
