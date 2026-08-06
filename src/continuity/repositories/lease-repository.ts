import type { ContinuityDatabase } from "../database.js";
import type { SessionMode, WriterLeaseRecord } from "../types.js";
import { ServiceError } from "../../application/service-error.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface LeaseRow {
  id: string;
  workspace_id: string;
  session_id: string;
  holder_type: SessionMode;
  holder_id: string;
  status: "active" | "released" | "expired" | "revoked";
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
  released_at: string | null;
  revision: number;
}

function leaseFromRow(row: LeaseRow): WriterLeaseRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    holderType: row.holder_type,
    holderId: row.holder_id,
    status: row.status,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    revision: Number(row.revision)
  };
}

export interface AcquireLeaseInput {
  id?: string;
  workspaceId: string;
  sessionId: string;
  holderType: SessionMode;
  holderId: string;
  expiresAt: string;
  now?: string;
}

export class LeaseRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  acquire(input: AcquireLeaseInput): WriterLeaseRecord {
    const now = nowIso(input.now);
    return this.database.transaction(() => {
      this.reconcileExpired(now);
      const existing = this.getActive(input.workspaceId);
      if (existing) {
        throw new ServiceError(
          "WRITER_LEASE_CONFLICT",
          `Workspace ${input.workspaceId} is already owned by ${existing.holderType}`,
          {
            details: {
              leaseId: existing.id,
              sessionId: existing.sessionId,
              holderType: existing.holderType,
              holderId: existing.holderId,
              expiresAt: existing.expiresAt
            }
          }
        );
      }

      const id = input.id ?? newRecordId("lease");
      this.database.sqlite
        .prepare(`
          INSERT INTO writer_leases (
            id, workspace_id, session_id, holder_type, holder_id, status,
            acquired_at, heartbeat_at, expires_at, released_at, revision
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, 1)
        `)
        .run(
          id,
          input.workspaceId,
          input.sessionId,
          input.holderType,
          input.holderId,
          now,
          now,
          input.expiresAt
        );
      return this.get(id);
    });
  }

  get(id: string): WriterLeaseRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM writer_leases WHERE id = ?")
      .get(id) as LeaseRow | undefined;
    return leaseFromRow(requireRecord(row, "Writer lease", id));
  }

  getActive(workspaceId: string): WriterLeaseRecord | null {
    const row = this.database.sqlite
      .prepare(
        "SELECT * FROM writer_leases WHERE workspace_id = ? AND status = 'active' LIMIT 1"
      )
      .get(workspaceId) as LeaseRow | undefined;
    return row ? leaseFromRow(row) : null;
  }

  heartbeat(
    id: string,
    input: {
      sessionId: string;
      holderId: string;
      expiresAt: string;
      expectedRevision: number;
      now?: string;
    }
  ): WriterLeaseRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE writer_leases
        SET heartbeat_at = ?, expires_at = ?, revision = revision + 1
        WHERE id = ? AND session_id = ? AND holder_id = ?
          AND status = 'active' AND revision = ?
      `)
      .run(
        nowIso(input.now),
        input.expiresAt,
        id,
        input.sessionId,
        input.holderId,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Writer lease", id, input.expectedRevision);
    return this.get(id);
  }

  release(
    id: string,
    input: {
      sessionId: string;
      holderId: string;
      expectedRevision: number;
      now?: string;
    }
  ): WriterLeaseRecord {
    const now = nowIso(input.now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE writer_leases
        SET status = 'released', released_at = ?, heartbeat_at = ?,
            revision = revision + 1
        WHERE id = ? AND session_id = ? AND holder_id = ?
          AND status = 'active' AND revision = ?
      `)
      .run(
        now,
        now,
        id,
        input.sessionId,
        input.holderId,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Writer lease", id, input.expectedRevision);
    return this.get(id);
  }

  reconcileExpired(now = new Date().toISOString()): number {
    const result = this.database.sqlite
      .prepare(`
        UPDATE writer_leases
        SET status = 'expired', released_at = ?, revision = revision + 1
        WHERE status = 'active' AND expires_at <= ?
      `)
      .run(now, now);
    return Number(result.changes);
  }
}
