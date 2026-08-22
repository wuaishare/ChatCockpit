import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  CodexThreadImportRecord,
  CodexThreadImportState
} from "../types.js";
import {
  assertUpdated,
  booleanFromSql,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface CodexThreadImportRow {
  id: string;
  source_thread_id: string;
  project_id: string;
  workspace_id: string;
  state: CodexThreadImportState;
  assessment_hash: string;
  expires_at: string;
  source_task_id: string | null;
  source_session_id: string | null;
  handoff_id: string | null;
  continuation_task_id: string | null;
  continuation_session_id: string | null;
  context_json: string | null;
  context_truncated: number;
  created_at: string;
  updated_at: string;
  revision: number;
}

function publicRecord(row: CodexThreadImportRow): CodexThreadImportRecord {
  return {
    id: row.id,
    sourceThreadId: row.source_thread_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    state: row.state,
    assessmentHash: row.assessment_hash,
    expiresAt: row.expires_at,
    sourceTaskId: row.source_task_id,
    sourceSessionId: row.source_session_id,
    handoffId: row.handoff_id,
    continuationTaskId: row.continuation_task_id,
    continuationSessionId: row.continuation_session_id,
    contextTruncated: booleanFromSql(row.context_truncated),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };
}

export interface CreateCodexThreadImportAssessmentInput {
  id?: string;
  sourceThreadId: string;
  projectId: string;
  workspaceId: string;
  assessmentHash: string;
  expiresAt: string;
  now?: string;
}

export class CodexThreadImportRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  createAssessment(
    input: CreateCodexThreadImportAssessmentInput
  ): CodexThreadImportRecord {
    const id = input.id ?? newRecordId("codex_import");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO codex_thread_imports (
          id, source_thread_id, project_id, workspace_id, state,
          assessment_hash, expires_at, source_task_id, source_session_id,
          handoff_id, continuation_task_id, continuation_session_id,
          context_json, context_truncated, created_at, updated_at, revision
        ) VALUES (?, ?, ?, ?, 'assessed', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?, 1)
      `)
      .run(
        id,
        input.sourceThreadId,
        input.projectId,
        input.workspaceId,
        input.assessmentHash,
        input.expiresAt,
        now,
        now
      );
    return this.get(id);
  }

  get(id: string): CodexThreadImportRecord {
    return publicRecord(this.getRow(id));
  }

  findBySourceThreadWorkspace(
    sourceThreadId: string,
    workspaceId: string
  ): CodexThreadImportRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM codex_thread_imports
        WHERE source_thread_id = ? AND workspace_id = ?
        LIMIT 1
      `)
      .get(sourceThreadId, workspaceId) as CodexThreadImportRow | undefined;
    return row ? publicRecord(row) : null;
  }

  refreshAssessment(input: {
    id: string;
    assessmentHash: string;
    expiresAt: string;
    expectedRevision: number;
    now?: string;
  }): CodexThreadImportRecord {
    const current = this.get(input.id);
    if (!(["assessed", "failed"] as CodexThreadImportState[]).includes(current.state)) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_ALREADY_ACTIVE",
        "Only assessed or failed Codex thread imports can be reassessed"
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE codex_thread_imports
        SET state = 'assessed', assessment_hash = ?, expires_at = ?,
            updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND state IN ('assessed', 'failed')
      `)
      .run(
        input.assessmentHash,
        input.expiresAt,
        nowIso(input.now),
        input.id,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Codex thread import", input.id, input.expectedRevision);
    return this.get(input.id);
  }

  beginExecution(input: {
    id: string;
    expectedRevision: number;
    assessmentHash: string;
    now?: string;
  }): CodexThreadImportRecord {
    const current = this.get(input.id);
    if (current.assessmentHash !== input.assessmentHash) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STALE",
        "Codex thread import assessment hash no longer matches"
      );
    }
    if (current.state === "importing") return current;
    if (current.state === "ready") return current;
    if (!(["assessed", "failed"] as CodexThreadImportState[]).includes(current.state)) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STATE_INVALID",
        "Codex thread import is not executable"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(0, "Codex thread import", input.id, input.expectedRevision);
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE codex_thread_imports
        SET state = 'importing', updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND state IN ('assessed', 'failed')
          AND assessment_hash = ?
      `)
      .run(
        nowIso(input.now),
        input.id,
        input.expectedRevision,
        input.assessmentHash
      );
    assertUpdated(result.changes, "Codex thread import", input.id, input.expectedRevision);
    return this.get(input.id);
  }

  recordSource(input: {
    id: string;
    sourceTaskId: string;
    sourceSessionId: string;
    expectedRevision: number;
    now?: string;
  }): CodexThreadImportRecord {
    return this.updateIds(
      input.id,
      input.expectedRevision,
      "source_task_id = ?, source_session_id = ?",
      [input.sourceTaskId, input.sourceSessionId],
      input.now
    );
  }

  recordHandoff(input: {
    id: string;
    handoffId: string;
    expectedRevision: number;
    now?: string;
  }): CodexThreadImportRecord {
    return this.updateIds(
      input.id,
      input.expectedRevision,
      "handoff_id = ?",
      [input.handoffId],
      input.now
    );
  }

  recordContinuation(input: {
    id: string;
    continuationTaskId: string;
    continuationSessionId: string;
    expectedRevision: number;
    now?: string;
  }): CodexThreadImportRecord {
    return this.updateIds(
      input.id,
      input.expectedRevision,
      "continuation_task_id = ?, continuation_session_id = ?",
      [input.continuationTaskId, input.continuationSessionId],
      input.now
    );
  }

  markReady(input: {
    id: string;
    context: unknown;
    contextTruncated: boolean;
    expectedRevision: number;
    now?: string;
  }): CodexThreadImportRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE codex_thread_imports
        SET state = 'ready', context_json = ?, context_truncated = ?,
            updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND state = 'importing'
      `)
      .run(
        JSON.stringify(input.context),
        input.contextTruncated ? 1 : 0,
        nowIso(input.now),
        input.id,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Codex thread import", input.id, input.expectedRevision);
    return this.get(input.id);
  }

  markFailed(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): CodexThreadImportRecord {
    const current = this.get(input.id);
    if (current.state === "ready") return current;
    const result = this.database.sqlite
      .prepare(`
        UPDATE codex_thread_imports
        SET state = 'failed', updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND state = 'importing'
      `)
      .run(nowIso(input.now), input.id, input.expectedRevision);
    assertUpdated(result.changes, "Codex thread import", input.id, input.expectedRevision);
    return this.get(input.id);
  }

  readContext(id: string): unknown | null {
    const row = this.getRow(id);
    if (row.context_json === null) return null;
    try {
      return JSON.parse(row.context_json) as unknown;
    } catch {
      throw new ServiceError(
        "CONTINUITY_DATA_INVALID",
        "Stored Codex thread context is invalid"
      );
    }
  }

  private getRow(id: string): CodexThreadImportRow {
    const row = this.database.sqlite
      .prepare("SELECT * FROM codex_thread_imports WHERE id = ?")
      .get(id) as CodexThreadImportRow | undefined;
    return requireRecord(row, "Codex thread import", id);
  }

  private updateIds(
    id: string,
    expectedRevision: number,
    assignmentSql: string,
    values: string[],
    now?: string
  ): CodexThreadImportRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE codex_thread_imports
        SET ${assignmentSql}, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND state = 'importing'
      `)
      .run(...values, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Codex thread import", id, expectedRevision);
    return this.get(id);
  }
}
