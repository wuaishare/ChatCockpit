import { randomUUID } from "node:crypto";

import type { OperationContext } from "../application/operation-context.js";
import type { ContinuityDatabase } from "../continuity/database.js";
import type { JobControlAction, JobProcessState } from "../core/job-processes.js";
import { buildGovernanceActorProvenance } from "./governance-hash.js";

export interface OperationalActivityControlEventRecord {
  sequence: number;
  id: string;
  jobId: string;
  action: JobControlAction;
  resultingState: JobProcessState;
  processRevision: number;
  actorType: OperationContext["actorType"];
  actorIdentityHash: string | null;
  requestIdentityHash: string;
  createdAt: string;
}

interface Row {
  sequence: number;
  id: string;
  job_id: string;
  action: JobControlAction;
  resulting_state: JobProcessState;
  process_revision: number;
  actor_type: OperationContext["actorType"];
  actor_identity_hash: string | null;
  request_identity_hash: string;
  created_at: string;
}

function fromRow(row: Row): OperationalActivityControlEventRecord {
  return {
    sequence: Number(row.sequence),
    id: row.id,
    jobId: row.job_id,
    action: row.action,
    resultingState: row.resulting_state,
    processRevision: Number(row.process_revision),
    actorType: row.actor_type,
    actorIdentityHash: row.actor_identity_hash,
    requestIdentityHash: row.request_identity_hash,
    createdAt: row.created_at
  };
}

export class OperationalActivityControlEventRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  append(
    context: OperationContext,
    input: {
      jobId: string;
      action: JobControlAction;
      resultingState: JobProcessState;
      processRevision: number;
    }
  ): OperationalActivityControlEventRecord {
    const actor = buildGovernanceActorProvenance(context);
    if (!actor.actorType || !actor.requestIdentityHash) {
      throw new Error("Operational Activity control event requires actor and request identity");
    }
    const id = `activity_control_${randomUUID()}`;
    this.database.sqlite.prepare(`
      INSERT INTO operational_activity_control_events (
        id, job_id, action, resulting_state, process_revision, actor_type,
        actor_identity_hash, request_identity_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.jobId, input.action, input.resultingState, input.processRevision,
      actor.actorType, actor.actorIdentityHash, actor.requestIdentityHash, context.now
    );
    return this.get(id)!;
  }

  get(id: string): OperationalActivityControlEventRecord | null {
    const row = this.database.sqlite.prepare(`
      SELECT * FROM operational_activity_control_events WHERE id = ?
    `).get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  listForJob(
    jobId: string,
    options: { afterSequence?: number; limit?: number } = {}
  ): OperationalActivityControlEventRecord[] {
    const afterSequence = Math.max(0, Math.floor(options.afterSequence ?? 0));
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 100)));
    const rows = this.database.sqlite.prepare(`
      SELECT * FROM operational_activity_control_events
      WHERE job_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(jobId, afterSequence, limit) as unknown as Row[];
    return rows.map(fromRow);
  }
}
