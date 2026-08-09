import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  RuntimeRecoveryAction,
  RuntimeRecoveryAttemptRecord,
  RuntimeRecoveryAttemptStatus,
  RuntimeRecoveryClassification,
  RuntimeRecoveryProtocolKind
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface RuntimeRecoveryAttemptRow {
  id: string;
  project_id: string;
  workspace_id: string;
  task_id: string;
  session_id: string | null;
  source_binding_id: string | null;
  provider_kind: string;
  protocol_kind: RuntimeRecoveryProtocolKind;
  classification: RuntimeRecoveryClassification;
  assessment_hash: string;
  selected_action: RuntimeRecoveryAction | null;
  status: RuntimeRecoveryAttemptStatus;
  resulting_binding_id: string | null;
  public_summary_json: string;
  compatibility_json: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  revision: number;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      `Stored Runtime Recovery ${label} is invalid`
    );
  }
}

function attemptFromRow(row: RuntimeRecoveryAttemptRow): RuntimeRecoveryAttemptRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    sourceBindingId: row.source_binding_id,
    providerKind: row.provider_kind,
    protocolKind: row.protocol_kind,
    classification: row.classification,
    assessmentHash: row.assessment_hash,
    selectedAction: row.selected_action,
    status: row.status,
    resultingBindingId: row.resulting_binding_id,
    publicSummary: parseObject(row.public_summary_json, "public summary"),
    compatibility: parseObject(row.compatibility_json, "compatibility descriptor"),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    revision: Number(row.revision)
  };
}

export interface CreateRuntimeRecoveryAttemptInput {
  id?: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  sessionId?: string | null;
  sourceBindingId?: string | null;
  providerKind: string;
  protocolKind: RuntimeRecoveryProtocolKind;
  classification: RuntimeRecoveryClassification;
  assessmentHash: string;
  publicSummary: Record<string, unknown>;
  compatibility: Record<string, unknown>;
  expiresAt: string;
  now?: string;
}

export class RuntimeRecoveryAttemptRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateRuntimeRecoveryAttemptInput): RuntimeRecoveryAttemptRecord {
    const id = input.id ?? newRecordId("recovery");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO runtime_recovery_attempts (
          id, project_id, workspace_id, task_id, session_id, source_binding_id,
          provider_kind, protocol_kind, classification, assessment_hash,
          selected_action, status, resulting_binding_id, public_summary_json,
          compatibility_json, created_at, expires_at, resolved_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'prepared', NULL, ?, ?, ?, ?, NULL, 1)
      `)
      .run(
        id,
        input.projectId,
        input.workspaceId,
        input.taskId,
        input.sessionId ?? null,
        input.sourceBindingId ?? null,
        input.providerKind,
        input.protocolKind,
        input.classification,
        input.assessmentHash,
        JSON.stringify(input.publicSummary),
        JSON.stringify(input.compatibility),
        now,
        input.expiresAt
      );
    return this.get(id);
  }

  get(id: string): RuntimeRecoveryAttemptRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_recovery_attempts WHERE id = ?")
      .get(id) as RuntimeRecoveryAttemptRow | undefined;
    return attemptFromRow(requireRecord(row, "Runtime recovery attempt", id));
  }

  list(input: {
    workspaceId?: string;
    taskId?: string;
    status?: RuntimeRecoveryAttemptStatus;
    limit?: number;
  } = {}): RuntimeRecoveryAttemptRecord[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (input.workspaceId) {
      conditions.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input.taskId) {
      conditions.push("task_id = ?");
      params.push(input.taskId);
    }
    if (input.status) {
      conditions.push("status = ?");
      params.push(input.status);
    }
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    params.push(limit);
    const rows = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_recovery_attempts
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(...params) as unknown as RuntimeRecoveryAttemptRow[];
    return rows.map(attemptFromRow);
  }

  expireIfNeeded(id: string, now: string): RuntimeRecoveryAttemptRecord {
    const current = this.get(id);
    if (current.status === "prepared" && current.expiresAt <= now) {
      const result = this.database.sqlite
        .prepare(`
          UPDATE runtime_recovery_attempts
          SET status = 'expired', resolved_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND status = 'prepared'
        `)
        .run(now, id, current.revision);
      assertUpdated(result.changes, "Runtime recovery attempt", id, current.revision);
    }
    return this.get(id);
  }

  reserveAction(input: {
    id: string;
    action: RuntimeRecoveryAction;
    expectedRevision: number;
    now?: string;
  }): RuntimeRecoveryAttemptRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_EXPIRED",
        "Runtime Recovery assessment expired"
      );
    }
    if (current.status !== "prepared") {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_INVALID",
        "Only a prepared Runtime Recovery attempt can reserve an action"
      );
    }
    if (current.selectedAction !== null) {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_IN_PROGRESS",
        "Runtime Recovery attempt already has an execution action reserved"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(0, "Runtime recovery attempt", input.id, input.expectedRevision);
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_recovery_attempts
        SET selected_action = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'prepared'
          AND selected_action IS NULL
      `)
      .run(input.action, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Runtime recovery attempt",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }

  resolve(input: {
    id: string;
    status: Exclude<RuntimeRecoveryAttemptStatus, "prepared" | "expired">;
    selectedAction?: RuntimeRecoveryAction | null;
    resultingBindingId?: string | null;
    expectedRevision: number;
    now?: string;
  }): RuntimeRecoveryAttemptRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_EXPIRED",
        "Runtime Recovery assessment expired"
      );
    }
    if (current.status !== "prepared") {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_INVALID",
        "Only a prepared Runtime Recovery attempt can be resolved"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(0, "Runtime recovery attempt", input.id, input.expectedRevision);
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_recovery_attempts
        SET status = ?, selected_action = ?, resulting_binding_id = ?,
            resolved_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'prepared'
      `)
      .run(
        input.status,
        input.selectedAction ?? null,
        input.resultingBindingId ?? null,
        now,
        input.id,
        input.expectedRevision
      );
    assertUpdated(
      result.changes,
      "Runtime recovery attempt",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }
}
