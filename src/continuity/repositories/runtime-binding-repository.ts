import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  RuntimeBindingRecord,
  RuntimeBindingRelation,
  RuntimeBindingStatus
} from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface RuntimeBindingRow {
  id: string;
  session_id: string;
  workspace_id: string;
  runtime_kind: "codex-app-server";
  external_thread_id: string;
  source_thread_id: string | null;
  relation: RuntimeBindingRelation;
  status: RuntimeBindingStatus;
  model_provider: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

function bindingFromRow(row: RuntimeBindingRow): RuntimeBindingRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    runtimeKind: row.runtime_kind,
    externalThreadId: row.external_thread_id,
    sourceThreadId: row.source_thread_id,
    relation: row.relation,
    status: row.status,
    modelProvider: row.model_provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };
}

export interface ReplaceRuntimeBindingInput {
  id?: string;
  sessionId: string;
  workspaceId: string;
  externalThreadId: string;
  sourceThreadId?: string | null;
  relation: RuntimeBindingRelation;
  modelProvider?: string | null;
  now?: string;
}

export class RuntimeBindingRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  replaceActive(input: ReplaceRuntimeBindingInput): RuntimeBindingRecord {
    return this.database.transaction(() => {
      const activeExternal = this.findActiveByExternalThread(
        input.externalThreadId
      );
      if (activeExternal && activeExternal.sessionId !== input.sessionId) {
        throw new ServiceError(
          "RUNTIME_BINDING_CONFLICT",
          `Codex thread ${input.externalThreadId} is already bound to another active session`,
          {
            details: {
              bindingId: activeExternal.id,
              sessionId: activeExternal.sessionId,
              workspaceId: activeExternal.workspaceId
            }
          }
        );
      }

      const now = nowIso(input.now);
      this.database.sqlite
        .prepare(`
          UPDATE runtime_bindings
          SET status = 'superseded', updated_at = ?, revision = revision + 1
          WHERE session_id = ? AND status = 'active'
        `)
        .run(now, input.sessionId);

      const id = input.id ?? newRecordId("runtime_binding");
      this.database.sqlite
        .prepare(`
          INSERT INTO runtime_bindings (
            id, session_id, workspace_id, runtime_kind, external_thread_id,
            source_thread_id, relation, status, model_provider,
            created_at, updated_at, revision
          ) VALUES (?, ?, ?, 'codex-app-server', ?, ?, ?, 'active', ?, ?, ?, 1)
        `)
        .run(
          id,
          input.sessionId,
          input.workspaceId,
          input.externalThreadId,
          input.sourceThreadId ?? null,
          input.relation,
          input.modelProvider ?? null,
          now,
          now
        );
      return this.get(id);
    });
  }

  get(id: string): RuntimeBindingRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_bindings WHERE id = ?")
      .get(id) as RuntimeBindingRow | undefined;
    return bindingFromRow(requireRecord(row, "Runtime binding", id));
  }

  findActiveBySession(sessionId: string): RuntimeBindingRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_bindings
        WHERE session_id = ? AND status = 'active'
        LIMIT 1
      `)
      .get(sessionId) as RuntimeBindingRow | undefined;
    return row ? bindingFromRow(row) : null;
  }

  findActiveByExternalThread(
    externalThreadId: string
  ): RuntimeBindingRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_bindings
        WHERE runtime_kind = 'codex-app-server'
          AND external_thread_id = ?
          AND status = 'active'
        LIMIT 1
      `)
      .get(externalThreadId) as RuntimeBindingRow | undefined;
    return row ? bindingFromRow(row) : null;
  }

  release(
    id: string,
    expectedRevision: number,
    now?: string
  ): RuntimeBindingRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE runtime_bindings
        SET status = 'released', updated_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'active' AND revision = ?
      `)
      .run(nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Runtime binding", id, expectedRevision);
    return this.get(id);
  }
}
