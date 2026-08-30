import type { ContinuityDatabase } from "../database.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

export interface HostProcessAuthorityRecord {
  id: string;
  authorizationGrantId: string;
  actorType: string;
  actorId: string | null;
  status: "active" | "released" | "expired";
  acquiredAt: string;
  expiresAt: string;
  releasedAt: string | null;
  revision: number;
}

interface HostProcessAuthorityRow {
  id: string;
  authorization_grant_id: string;
  actor_type: string;
  actor_id: string | null;
  status: "active" | "released" | "expired";
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
  revision: number;
}

function fromRow(row: HostProcessAuthorityRow): HostProcessAuthorityRecord {
  return {
    id: row.id,
    authorizationGrantId: row.authorization_grant_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    status: row.status,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    revision: Number(row.revision)
  };
}

export interface AcquireHostProcessAuthorityInput {
  authorizationGrantId: string;
  actorType: string;
  actorId: string | null;
  expiresAt: string;
  now?: string;
}

export class HostProcessAuthorityRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  acquire(input: AcquireHostProcessAuthorityInput): HostProcessAuthorityRecord {
    const now = nowIso(input.now);
    const id = newRecordId("host_process_authority");
    this.database.sqlite
      .prepare(`
        INSERT INTO host_process_authorities (
          id, authorization_grant_id, actor_type, actor_id,
          status, acquired_at, expires_at, released_at, revision
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, 1)
      `)
      .run(
        id,
        input.authorizationGrantId,
        input.actorType,
        input.actorId,
        now,
        input.expiresAt
      );
    return this.get(id);
  }

  get(id: string): HostProcessAuthorityRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM host_process_authorities WHERE id = ?")
      .get(id) as HostProcessAuthorityRow | undefined;
    return fromRow(requireRecord(row, "Host process authority", id));
  }

  renew(
    id: string,
    input: {
      authorizationGrantId: string;
      expectedRevision: number;
      expiresAt: string;
      now?: string;
    }
  ): HostProcessAuthorityRecord {
    const now = nowIso(input.now);
    this.reconcileExpired(now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE host_process_authorities
        SET expires_at = ?, revision = revision + 1
        WHERE id = ? AND authorization_grant_id = ?
          AND status = 'active' AND revision = ?
      `)
      .run(
        input.expiresAt,
        id,
        input.authorizationGrantId,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Host process authority", id, input.expectedRevision);
    return this.get(id);
  }

  release(
    id: string,
    input: {
      authorizationGrantId: string;
      expectedRevision: number;
      now?: string;
    }
  ): HostProcessAuthorityRecord {
    const now = nowIso(input.now);
    const result = this.database.sqlite
      .prepare(`
        UPDATE host_process_authorities
        SET status = 'released', released_at = ?, revision = revision + 1
        WHERE id = ? AND authorization_grant_id = ?
          AND status = 'active' AND revision = ?
      `)
      .run(
        now,
        id,
        input.authorizationGrantId,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Host process authority", id, input.expectedRevision);
    return this.get(id);
  }

  reconcileExpired(now = new Date().toISOString()): number {
    const result = this.database.sqlite
      .prepare(`
        UPDATE host_process_authorities
        SET status = 'expired', released_at = ?, revision = revision + 1
        WHERE status = 'active' AND expires_at <= ?
      `)
      .run(now, now);
    return Number(result.changes);
  }
}
