import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  DirectCommandApprovalRecord,
  DirectCommandEffect,
  DirectCommandTargetKind
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface DirectCommandApprovalRow {
  id: string;
  root_id: string;
  workdir: string;
  command: string;
  args_json: string;
  command_hash: string;
  effect: DirectCommandEffect;
  timeout_ms: number;
  executor_id: string;
  target_kind: DirectCommandTargetKind;
  workspace_id: string | null;
  repo_id: string | null;
  session_id: string | null;
  status: DirectCommandApprovalRecord["status"];
  public_summary_json: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  consumed_at: string | null;
  revision: number;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      throw new Error("invalid string array");
    }
    return parsed;
  } catch {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      "Stored Direct command approval arguments are invalid"
    );
  }
}

function parsePublicSummary(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid public summary");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      "Stored Direct command approval summary is invalid"
    );
  }
}

function approvalFromRow(row: DirectCommandApprovalRow): DirectCommandApprovalRecord {
  return {
    id: row.id,
    rootId: row.root_id,
    workdir: row.workdir,
    command: row.command,
    args: parseStringArray(row.args_json),
    commandHash: row.command_hash,
    effect: row.effect,
    timeoutMs: Number(row.timeout_ms),
    executorId: row.executor_id,
    targetKind: row.target_kind,
    workspaceId: row.workspace_id,
    repoId: row.repo_id,
    sessionId: row.session_id,
    status: row.status,
    publicSummary: parsePublicSummary(row.public_summary_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
    revision: Number(row.revision)
  };
}

export interface CreateDirectCommandApprovalInput {
  id?: string;
  rootId: string;
  workdir: string;
  command: string;
  args: string[];
  commandHash: string;
  effect: DirectCommandEffect;
  timeoutMs: number;
  executorId: string;
  targetKind: DirectCommandTargetKind;
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
  publicSummary: Record<string, unknown>;
  expiresAt: string;
  now?: string;
}

export class DirectCommandApprovalRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateDirectCommandApprovalInput): DirectCommandApprovalRecord {
    const id = input.id ?? newRecordId("direct_command_approval");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_command_approvals (
          id, root_id, workdir, command, args_json, command_hash, effect,
          timeout_ms, executor_id, target_kind, workspace_id, repo_id,
          session_id, status, public_summary_json, created_at, expires_at,
          decided_at, consumed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, 1)
      `)
      .run(
        id,
        input.rootId,
        input.workdir,
        input.command,
        JSON.stringify(input.args),
        input.commandHash,
        input.effect,
        input.timeoutMs,
        input.executorId,
        input.targetKind,
        input.workspaceId,
        input.repoId,
        input.sessionId,
        JSON.stringify(input.publicSummary),
        now,
        input.expiresAt
      );
    return this.get(id);
  }

  get(id: string): DirectCommandApprovalRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM direct_command_approvals WHERE id = ?")
      .get(id) as DirectCommandApprovalRow | undefined;
    return approvalFromRow(requireRecord(row, "Direct command approval", id));
  }

  countPending(now: string): number {
    const row = this.database.sqlite
      .prepare(`
        SELECT COUNT(*) AS count
        FROM direct_command_approvals
        WHERE status = 'pending' AND expires_at > ?
      `)
      .get(now) as { count: number };
    return Number(row.count);
  }

  expireIfNeeded(id: string, now: string): DirectCommandApprovalRecord {
    const current = this.get(id);
    if (["pending", "approved"].includes(current.status) && current.expiresAt <= now) {
      const result = this.database.sqlite
        .prepare(`
          UPDATE direct_command_approvals
          SET status = 'expired', revision = revision + 1
          WHERE id = ? AND revision = ? AND status IN ('pending', 'approved')
        `)
        .run(id, current.revision);
      assertUpdated(result.changes, "Direct command approval", id, current.revision);
    }
    return this.get(id);
  }

  decide(input: {
    id: string;
    decision: "approved" | "denied";
    expectedRevision: number;
    now?: string;
  }): DirectCommandApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_EXPIRED",
        "Host command approval expired"
      );
    }
    if (current.status !== "pending") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_INVALID",
        "Only a pending Host command approval can receive a decision"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(0, "Direct command approval", input.id, input.expectedRevision);
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_command_approvals
        SET status = ?, decided_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'pending'
      `)
      .run(input.decision, now, input.id, input.expectedRevision);
    assertUpdated(result.changes, "Direct command approval", input.id, input.expectedRevision);
    return this.get(input.id);
  }

  consume(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): DirectCommandApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_EXPIRED",
        "Host command approval expired"
      );
    }
    if (current.status === "consumed") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_CONSUMED",
        "Host command approval was already consumed"
      );
    }
    if (current.status !== "approved") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_REQUIRED",
        "Host command requires an approved Direct Command approval"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(0, "Direct command approval", input.id, input.expectedRevision);
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_command_approvals
        SET status = 'consumed', consumed_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'approved'
      `)
      .run(now, input.id, input.expectedRevision);
    assertUpdated(result.changes, "Direct command approval", input.id, input.expectedRevision);
    return this.get(input.id);
  }
}
