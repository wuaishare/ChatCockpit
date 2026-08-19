import type { OperationContext } from "../application/operation-context.js";
import type { ContinuityDatabase } from "../continuity/database.js";
import { buildGovernanceActorProvenance } from "./governance-hash.js";

export type OperationalActivityProvenanceKind = "agent-session" | "job";

export interface OperationalActivityProvenanceRecord {
  activityId: string;
  activityKind: OperationalActivityProvenanceKind;
  authorizationGrantId: string | null;
  actorType: OperationContext["actorType"];
  actorIdentityHash: string | null;
  requestIdentityHash: string;
  traceId: string;
  workerInstanceId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  activity_id: string;
  activity_kind: OperationalActivityProvenanceKind;
  authorization_grant_id: string | null;
  actor_type: OperationContext["actorType"];
  actor_identity_hash: string | null;
  request_identity_hash: string;
  trace_id: string;
  worker_instance_id: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: Row): OperationalActivityProvenanceRecord {
  return {
    activityId: row.activity_id,
    activityKind: row.activity_kind,
    authorizationGrantId: row.authorization_grant_id,
    actorType: row.actor_type,
    actorIdentityHash: row.actor_identity_hash,
    requestIdentityHash: row.request_identity_hash,
    traceId: row.trace_id,
    workerInstanceId: row.worker_instance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function traceId(requestIdentityHash: string): string {
  return `trace_${requestIdentityHash.slice(0, 32)}`;
}

export class OperationalActivityProvenanceRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  recordFromContext(
    context: OperationContext,
    input: { activityId: string; activityKind: OperationalActivityProvenanceKind }
  ): OperationalActivityProvenanceRecord {
    const actor = buildGovernanceActorProvenance(context);
    const authorizationGrantId =
      context.actorType === "remote-mcp" && context.actorId
        ? context.actorId
        : null;
    if (!actor.actorType || !actor.requestIdentityHash) {
      throw new Error("Operational Activity provenance requires actor and request identity");
    }
    const requestIdentityHash = actor.requestIdentityHash;
    const existing = this.get(input.activityId);
    if (existing) {
      if (existing.activityKind !== input.activityKind) {
        throw new Error(`Operational Activity ${input.activityId} provenance kind mismatch`);
      }
      return existing;
    }
    this.database.sqlite.prepare(`
      INSERT INTO operational_activity_provenance (
        activity_id, activity_kind, authorization_grant_id, actor_type,
        actor_identity_hash, request_identity_hash, trace_id,
        worker_instance_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      input.activityId,
      input.activityKind,
      authorizationGrantId,
      actor.actorType,
      actor.actorIdentityHash,
      requestIdentityHash,
      traceId(requestIdentityHash),
      context.now,
      context.now
    );
    return this.get(input.activityId)!;
  }

  get(activityId: string): OperationalActivityProvenanceRecord | null {
    const table = this.database.sqlite.prepare(`
      SELECT 1 AS present FROM sqlite_master
      WHERE type = 'table' AND name = 'operational_activity_provenance'
    `).get() as { present: number } | undefined;
    if (!table) return null;
    const row = this.database.sqlite.prepare(`
      SELECT * FROM operational_activity_provenance WHERE activity_id = ?
    `).get(activityId) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  assignWorker(
    activityId: string,
    workerInstanceId: string,
    now: string
  ): OperationalActivityProvenanceRecord {
    const result = this.database.sqlite.prepare(`
      UPDATE operational_activity_provenance
      SET worker_instance_id = ?, updated_at = ?
      WHERE activity_id = ?
    `).run(workerInstanceId, now, activityId);
    if (result.changes !== 1) {
      throw new Error(`Operational Activity provenance not found: ${activityId}`);
    }
    return this.get(activityId)!;
  }
}
