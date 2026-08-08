import type { ContinuityDatabase } from "../database.js";
import type { DirectProcessRuntimeOwnershipRecord } from "../types.js";
import { ServiceError } from "../../application/service-error.js";
import { assertUpdated, nowIso } from "./repository-utils.js";

interface DirectProcessRuntimeOwnershipRow {
  process_id: string;
  supervisor_generation: string;
  attached_at: string;
  last_seen_at: string;
  revision: number;
}

function ownershipFromRow(
  row: DirectProcessRuntimeOwnershipRow
): DirectProcessRuntimeOwnershipRecord {
  return {
    processId: row.process_id,
    supervisorGeneration: row.supervisor_generation,
    attachedAt: row.attached_at,
    lastSeenAt: row.last_seen_at,
    revision: Number(row.revision)
  };
}

export class DirectProcessRuntimeOwnershipRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  attach(input: {
    processId: string;
    supervisorGeneration: string;
    now?: string;
  }): DirectProcessRuntimeOwnershipRecord {
    const existing = this.get(input.processId);
    if (existing) {
      if (existing.supervisorGeneration !== input.supervisorGeneration) {
        throw new ServiceError(
          "DIRECT_PROCESS_RUNTIME_OWNERSHIP_CONFLICT",
          "Managed process is already attached to another Process Supervisor generation",
          {
            details: {
              processId: input.processId,
              supervisorGeneration: existing.supervisorGeneration
            }
          }
        );
      }
      return existing;
    }

    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO direct_process_runtime_ownership (
          process_id, supervisor_generation, attached_at, last_seen_at, revision
        ) VALUES (?, ?, ?, ?, 1)
      `)
      .run(input.processId, input.supervisorGeneration, now, now);
    return this.require(input.processId);
  }

  get(processId: string): DirectProcessRuntimeOwnershipRecord | null {
    const row = this.database.sqlite
      .prepare(
        "SELECT * FROM direct_process_runtime_ownership WHERE process_id = ?"
      )
      .get(processId) as DirectProcessRuntimeOwnershipRow | undefined;
    return row ? ownershipFromRow(row) : null;
  }

  list(input: { supervisorGeneration?: string } = {}): DirectProcessRuntimeOwnershipRecord[] {
    const rows = input.supervisorGeneration
      ? (this.database.sqlite
          .prepare(`
            SELECT * FROM direct_process_runtime_ownership
            WHERE supervisor_generation = ?
            ORDER BY attached_at ASC, process_id ASC
          `)
          .all(input.supervisorGeneration) as unknown as DirectProcessRuntimeOwnershipRow[])
      : (this.database.sqlite
          .prepare(`
            SELECT * FROM direct_process_runtime_ownership
            ORDER BY attached_at ASC, process_id ASC
          `)
          .all() as unknown as DirectProcessRuntimeOwnershipRow[]);
    return rows.map(ownershipFromRow);
  }

  touch(input: {
    processId: string;
    supervisorGeneration: string;
    expectedRevision: number;
    now?: string;
  }): DirectProcessRuntimeOwnershipRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE direct_process_runtime_ownership
        SET last_seen_at = ?, revision = revision + 1
        WHERE process_id = ? AND supervisor_generation = ? AND revision = ?
      `)
      .run(
        nowIso(input.now),
        input.processId,
        input.supervisorGeneration,
        input.expectedRevision
      );
    assertUpdated(
      result.changes,
      "Direct process runtime ownership",
      input.processId,
      input.expectedRevision
    );
    return this.require(input.processId);
  }

  release(input: {
    processId: string;
    supervisorGeneration: string;
    expectedRevision: number;
  }): boolean {
    const result = this.database.sqlite
      .prepare(`
        DELETE FROM direct_process_runtime_ownership
        WHERE process_id = ? AND supervisor_generation = ? AND revision = ?
      `)
      .run(
        input.processId,
        input.supervisorGeneration,
        input.expectedRevision
      );
    if (Number(result.changes) === 0) {
      const existing = this.get(input.processId);
      if (!existing) {
        return false;
      }
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Direct process runtime ownership ${input.processId} changed concurrently`
      );
    }
    return true;
  }

  private require(processId: string): DirectProcessRuntimeOwnershipRecord {
    const ownership = this.get(processId);
    if (!ownership) {
      throw new ServiceError(
        "NOT_FOUND",
        `Direct process runtime ownership ${processId} was not found`
      );
    }
    return ownership;
  }
}
