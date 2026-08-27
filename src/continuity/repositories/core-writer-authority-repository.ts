import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

export interface CoreWriterAuthorityRecord {
  id: string;
  workspaceId: string;
  holderRequestId: string;
  actorType: string;
  actorId: string | null;
  authorizationGrantId: string | null;
  status: "active" | "released" | "expired";
  acquiredAt: string;
  expiresAt: string;
  releasedAt: string | null;
  revision: number;
}

interface CoreWriterAuthorityRow {
  id: string;
  workspace_id: string;
  holder_request_id: string;
  actor_type: string;
  actor_id: string | null;
  authorization_grant_id: string | null;
  status: "active" | "released" | "expired";
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
  revision: number;
}

function fromRow(row: CoreWriterAuthorityRow): CoreWriterAuthorityRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    holderRequestId: row.holder_request_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    authorizationGrantId: row.authorization_grant_id,
    status: row.status,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    revision: Number(row.revision)
  };
}

export interface AcquireCoreWriterAuthorityInput {
  workspaceId: string;
  holderRequestId: string;
  actorType: string;
  actorId: string | null;
  authorizationGrantId: string | null;
  expiresAt: string;
  now?: string;
}
export class CoreWriterAuthorityRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  acquire(input: AcquireCoreWriterAuthorityInput): CoreWriterAuthorityRecord {
    const now = nowIso(input.now);
    return this.database.transaction(() => {
      this.reconcileExpired(now);
      this.database.sqlite
        .prepare(`
          UPDATE writer_leases
          SET status = 'expired', released_at = ?, revision = revision + 1
          WHERE status = 'active' AND expires_at <= ?
        `)
        .run(now, now);

      const continuityLease = this.database.sqlite
        .prepare(`
          SELECT id, session_id, holder_type, holder_id, expires_at
          FROM writer_leases
          WHERE workspace_id = ? AND status = 'active'
          LIMIT 1
        `)
        .get(input.workspaceId) as {
          id: string;
          session_id: string;
          holder_type: string;
          holder_id: string;
          expires_at: string;
        } | undefined;
      if (continuityLease) {
        throw new ServiceError(
          "WRITER_LEASE_CONFLICT",
          "A Continuity writer already owns the workspace",
          {
            details: {
              workspaceId: input.workspaceId,
              leaseId: continuityLease.id,
              sessionId: continuityLease.session_id,
              holderType: continuityLease.holder_type,
              holderId: continuityLease.holder_id,
              expiresAt: continuityLease.expires_at
            }
          }
        );
      }

      const existing = this.getActive(input.workspaceId);
      if (existing) {
        throw new ServiceError(
          "WRITER_LEASE_CONFLICT",
          "Another Core request already owns the workspace",
          {
            details: {
              workspaceId: input.workspaceId,
              authorityId: existing.id,
              holderRequestId: existing.holderRequestId,
              actorType: existing.actorType,
              expiresAt: existing.expiresAt
            }
          }
        );
      }
      const id = newRecordId("core_writer_authority");
      this.database.sqlite
        .prepare(`
          INSERT INTO core_writer_authorities (
            id, workspace_id, holder_request_id, actor_type, actor_id,
            authorization_grant_id, status, acquired_at, expires_at,
            released_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, 1)
        `)
        .run(
          id,
          input.workspaceId,
          input.holderRequestId,
          input.actorType,
          input.actorId,
          input.authorizationGrantId,
          now,
          input.expiresAt
        );
      return this.get(id);
    });
  }

  get(id: string): CoreWriterAuthorityRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM core_writer_authorities WHERE id = ?")
      .get(id) as CoreWriterAuthorityRow | undefined;
    return fromRow(requireRecord(row, "Core writer authority", id));
  }

  getActive(workspaceId: string): CoreWriterAuthorityRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM core_writer_authorities
        WHERE workspace_id = ? AND status = 'active'
        LIMIT 1
      `)
      .get(workspaceId) as CoreWriterAuthorityRow | undefined;
    return row ? fromRow(row) : null;
  }

  renew(
    id: string,
    input: {
      holderRequestId: string;
      expectedRevision: number;
      expiresAt: string;
      now?: string;
    }
  ): CoreWriterAuthorityRecord {
    const now = nowIso(input.now);
    this.reconcileExpired(now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE core_writer_authorities
        SET expires_at = ?, revision = revision + 1
        WHERE id = ? AND holder_request_id = ?
          AND status = 'active' AND revision = ?
      `)
      .run(input.expiresAt, id, input.holderRequestId, input.expectedRevision);
    assertUpdated(result.changes, "Core writer authority", id, input.expectedRevision);
    return this.get(id);
  }

  release(
    id: string,
    input: {
      holderRequestId: string;
      expectedRevision: number;
      now?: string;
    }
  ): CoreWriterAuthorityRecord {
    const now = nowIso(input.now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE core_writer_authorities
        SET status = 'released', released_at = ?, revision = revision + 1
        WHERE id = ? AND holder_request_id = ?
          AND status = 'active' AND revision = ?
      `)
      .run(now, id, input.holderRequestId, input.expectedRevision);
    assertUpdated(result.changes, "Core writer authority", id, input.expectedRevision);
    return this.get(id);
  }
  reconcileExpired(now = new Date().toISOString()): number {
    const result = this.database.sqlite
      .prepare(`
        UPDATE core_writer_authorities
        SET status = 'expired', released_at = ?, revision = revision + 1
        WHERE status = 'active' AND expires_at <= ?
      `)
      .run(now, now);
    return Number(result.changes);
  }
}
