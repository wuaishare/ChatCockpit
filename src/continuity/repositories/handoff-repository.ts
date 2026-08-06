import type { ContinuityDatabase } from "../database.js";
import type {
  HandoffCheckpointRecord,
  HandoffMode,
  HandoffStatus,
  SessionMode
} from "../types.js";
import {
  assertUpdated,
  booleanFromSql,
  jsonStringArray,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface HandoffRow {
  id: string;
  task_id: string;
  session_id: string;
  workspace_id: string;
  from_mode: SessionMode;
  to_mode: HandoffMode;
  goal: string;
  completed_items_json: string;
  pending_items_json: string;
  changed_files_json: string;
  risks_json: string;
  next_action: string;
  git_head: string | null;
  git_branch: string | null;
  git_dirty: number;
  diff_artifact_id: string | null;
  evidence_bundle_id: string | null;
  status: HandoffStatus;
  created_at: string;
  accepted_at: string | null;
  revision: number;
}

function handoffFromRow(row: HandoffRow): HandoffCheckpointRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    fromMode: row.from_mode,
    toMode: row.to_mode,
    goal: row.goal,
    completedItems: jsonStringArray(row.completed_items_json),
    pendingItems: jsonStringArray(row.pending_items_json),
    changedFiles: jsonStringArray(row.changed_files_json),
    risks: jsonStringArray(row.risks_json),
    nextAction: row.next_action,
    gitHead: row.git_head,
    gitBranch: row.git_branch,
    gitDirty: booleanFromSql(row.git_dirty),
    diffArtifactId: row.diff_artifact_id,
    evidenceBundleId: row.evidence_bundle_id,
    status: row.status,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    revision: Number(row.revision)
  };
}

export interface CreateHandoffInput {
  id?: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  fromMode: SessionMode;
  toMode?: HandoffMode;
  goal: string;
  completedItems?: string[];
  pendingItems?: string[];
  changedFiles?: string[];
  risks?: string[];
  nextAction: string;
  gitHead?: string | null;
  gitBranch?: string | null;
  gitDirty?: boolean;
  diffArtifactId?: string | null;
  evidenceBundleId?: string | null;
  now?: string;
}

export class HandoffRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateHandoffInput): HandoffCheckpointRecord {
    const id = input.id ?? newRecordId("handoff");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO handoff_checkpoints (
          id, task_id, session_id, workspace_id, from_mode, to_mode, goal,
          completed_items_json, pending_items_json, changed_files_json,
          risks_json, next_action, git_head, git_branch, git_dirty,
          diff_artifact_id, evidence_bundle_id, status, created_at,
          accepted_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, 1)
      `)
      .run(
        id,
        input.taskId,
        input.sessionId,
        input.workspaceId,
        input.fromMode,
        input.toMode ?? "unassigned",
        input.goal,
        JSON.stringify(input.completedItems ?? []),
        JSON.stringify(input.pendingItems ?? []),
        JSON.stringify(input.changedFiles ?? []),
        JSON.stringify(input.risks ?? []),
        input.nextAction,
        input.gitHead ?? null,
        input.gitBranch ?? null,
        input.gitDirty ? 1 : 0,
        input.diffArtifactId ?? null,
        input.evidenceBundleId ?? null,
        now
      );
    return this.get(id);
  }

  get(id: string): HandoffCheckpointRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM handoff_checkpoints WHERE id = ?")
      .get(id) as HandoffRow | undefined;
    return handoffFromRow(requireRecord(row, "Handoff checkpoint", id));
  }

  getReadyForTask(taskId: string): HandoffCheckpointRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM handoff_checkpoints
        WHERE task_id = ? AND status = 'ready'
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(taskId) as HandoffRow | undefined;
    return row ? handoffFromRow(row) : null;
  }

  latestForTask(taskId: string): HandoffCheckpointRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM handoff_checkpoints
        WHERE task_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(taskId) as HandoffRow | undefined;
    return row ? handoffFromRow(row) : null;
  }

  markReady(
    id: string,
    expectedRevision: number
  ): HandoffCheckpointRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE handoff_checkpoints
        SET status = 'ready', revision = revision + 1
        WHERE id = ? AND status = 'draft' AND revision = ?
      `)
      .run(id, expectedRevision);
    assertUpdated(result.changes, "Handoff checkpoint", id, expectedRevision);
    return this.get(id);
  }

  supersede(
    id: string,
    expectedRevision: number
  ): HandoffCheckpointRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE handoff_checkpoints
        SET status = 'superseded', revision = revision + 1
        WHERE id = ? AND status IN ('draft', 'ready') AND revision = ?
      `)
      .run(id, expectedRevision);
    assertUpdated(result.changes, "Handoff checkpoint", id, expectedRevision);
    return this.get(id);
  }

  cancel(
    id: string,
    expectedRevision: number
  ): HandoffCheckpointRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE handoff_checkpoints
        SET status = 'superseded', revision = revision + 1
        WHERE id = ? AND status = 'ready' AND revision = ?
      `)
      .run(id, expectedRevision);
    assertUpdated(result.changes, "Handoff checkpoint", id, expectedRevision);
    return this.get(id);
  }

  accept(
    id: string,
    expectedRevision: number,
    acceptedAt?: string
  ): HandoffCheckpointRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE handoff_checkpoints
        SET status = 'accepted', accepted_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'ready' AND revision = ?
      `)
      .run(nowIso(acceptedAt), id, expectedRevision);
    assertUpdated(result.changes, "Handoff checkpoint", id, expectedRevision);
    return this.get(id);
  }
}
