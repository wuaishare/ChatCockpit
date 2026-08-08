import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  DirectMutationApprovalRecord,
  DirectMutationOperation,
  DirectMutationTargetKind
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface DirectMutationApprovalRow {
  id: string;
  operation: DirectMutationOperation;
  root_id: string;
  relative_path: string;
  mutation_hash: string;
  executor_id: string;
  scope: "host";
  target_kind: DirectMutationTargetKind;
  workspace_id: string | null;
  repo_id: string | null;
  session_id: string | null;
  status: DirectMutationApprovalRecord["status"];
  public_summary_json: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  consumed_at: string | null;
  revision: number;
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
      "Stored Direct mutation approval summary is invalid"
    );
  }
}

function approvalFromRow(
  row: DirectMutationApprovalRow
): DirectMutationApprovalRecord {
  return {
    id: row.id,
    operation: row.operation,
    rootId: row.root_id,
    relativePath: row.relative_path,
    mutationHash: row.mutation_hash,
    executorId: row.executor_id,
    scope: "host",
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

export interface CreateDirectMutationApprovalInput {
  id?: string;
  operation: DirectMutationOperation;
  rootId: string;
  relativePath: string;
  mutationHash: string;
  executorId: string;
  targetKind: DirectMutationTargetKind;
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
  publicSummary: Record<string, unknown>;
  expiresAt: string;
  now?: string;
}

export class DirectMutationApprovalRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(
    input: CreateDirectMutationApprovalInput
  ): DirectMutationApprovalRecord {
    const id = input.id ?? newRecordId("direct_approval");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_mutation_approvals (
          id, operation, root_id, relative_path, mutation_hash, executor_id,
          scope, target_kind, workspace_id, repo_id, session_id, status,
          public_summary_json, created_at, expires_at, decided_at,
          consumed_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, 'host', ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, 1)
      `)
      .run(
        id,
        input.operation,
        input.rootId,
        input.relativePath,
        input.mutationHash,
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

  get(id: string): DirectMutationApprovalRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM direct_mutation_approvals WHERE id = ?")
      .get(id) as DirectMutationApprovalRow | undefined;
    return approvalFromRow(
      requireRecord(row, "Direct mutation approval", id)
    );
  }

  expireIfNeeded(id: string, now: string): DirectMutationApprovalRecord {
    const current = this.get(id);
    if (
      ["pending", "approved"].includes(current.status) &&
      current.expiresAt <= now
    ) {
      const result = this.database.sqlite
        .prepare(`
          UPDATE direct_mutation_approvals
          SET status = 'expired', revision = revision + 1
          WHERE id = ? AND revision = ? AND status IN ('pending', 'approved')
        `)
        .run(id, current.revision);
      assertUpdated(
        result.changes,
        "Direct mutation approval",
        id,
        current.revision
      );
    }
    return this.get(id);
  }

  decide(input: {
    id: string;
    decision: "approved" | "denied";
    expectedRevision: number;
    now?: string;
  }): DirectMutationApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_EXPIRED",
        "Host mutation approval expired"
      );
    }
    if (current.status !== "pending") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_INVALID",
        "Only a pending Host mutation approval can receive a decision"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(
        0,
        "Direct mutation approval",
        input.id,
        input.expectedRevision
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_mutation_approvals
        SET status = ?, decided_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'pending'
      `)
      .run(input.decision, now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct mutation approval",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }

  consume(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): DirectMutationApprovalRecord {
    const now = nowIso(input.now);
    const current = this.expireIfNeeded(input.id, now);
    if (current.status === "expired") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_EXPIRED",
        "Host mutation approval expired"
      );
    }
    if (current.status === "consumed") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_CONSUMED",
        "Host mutation approval was already consumed"
      );
    }
    if (current.status !== "approved") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_REQUIRED",
        "Host mutation requires an approved Direct Mutation approval"
      );
    }
    if (current.revision !== input.expectedRevision) {
      assertUpdated(
        0,
        "Direct mutation approval",
        input.id,
        input.expectedRevision
      );
    }
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_mutation_approvals
        SET status = 'consumed', consumed_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'approved'
      `)
      .run(now, input.id, input.expectedRevision);
    assertUpdated(
      result.changes,
      "Direct mutation approval",
      input.id,
      input.expectedRevision
    );
    return this.get(input.id);
  }
}
