import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";
import type {
  CodexRuntimeBindingRecord,
  RunnerRuntimeBindingRecord,
  RuntimeBindingKind,
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
  runtime_kind: RuntimeBindingKind;
  external_session_id: string | null;
  external_run_id: string | null;
  source_external_id: string | null;
  relation: RuntimeBindingRelation;
  status: RuntimeBindingStatus;
  model_provider: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

function bindingFromRow(row: RuntimeBindingRow): RuntimeBindingRecord {
  const common = {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    runtimeKind: row.runtime_kind,
    externalSessionId: row.external_session_id,
    externalRunId: row.external_run_id,
    sourceExternalId: row.source_external_id,
    status: row.status,
    modelProvider: row.model_provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };

  if (row.runtime_kind === "codex-app-server") {
    if (!row.external_session_id || row.external_run_id !== null) {
      throw new ServiceError(
        "CONTINUITY_RECORD_INVALID",
        `Codex runtime binding ${row.id} has invalid external identity`
      );
    }
    return {
      ...common,
      runtimeKind: "codex-app-server",
      externalSessionId: row.external_session_id,
      externalRunId: null,
      externalThreadId: row.external_session_id,
      sourceThreadId: row.source_external_id,
      relation: row.relation as CodexRuntimeBindingRecord["relation"]
    };
  }

  if (!row.external_run_id || row.external_session_id !== null) {
    throw new ServiceError(
      "CONTINUITY_RECORD_INVALID",
      `Runner runtime binding ${row.id} has invalid external identity`
    );
  }
  return {
    ...common,
    runtimeKind: "tokenpilot-runner",
    externalSessionId: null,
    externalRunId: row.external_run_id,
    externalThreadId: null,
    sourceThreadId: null,
    relation: "queued"
  };
}

export interface ReplaceRuntimeBindingInput {
  id?: string;
  sessionId: string;
  workspaceId: string;
  externalThreadId: string;
  sourceThreadId?: string | null;
  relation: "bound" | "resumed" | "forked";
  modelProvider?: string | null;
  now?: string;
}

export interface ReplaceRunnerRuntimeBindingInput {
  id?: string;
  sessionId: string;
  workspaceId: string;
  externalRunId: string;
  sourceExternalId?: string | null;
  now?: string;
}

export class RuntimeBindingRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  replaceActive(input: ReplaceRuntimeBindingInput): CodexRuntimeBindingRecord {
    const binding = this.replaceGeneric({
      id: input.id,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      runtimeKind: "codex-app-server",
      externalSessionId: input.externalThreadId,
      externalRunId: null,
      sourceExternalId: input.sourceThreadId ?? null,
      relation: input.relation,
      modelProvider: input.modelProvider ?? null,
      now: input.now
    });
    if (binding.runtimeKind !== "codex-app-server") {
      throw new ServiceError(
        "CONTINUITY_RECORD_INVALID",
        `Runtime binding ${binding.id} is not a Codex binding`
      );
    }
    return binding;
  }

  replaceActiveRunner(
    input: ReplaceRunnerRuntimeBindingInput
  ): RunnerRuntimeBindingRecord {
    const binding = this.replaceGeneric({
      id: input.id,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      runtimeKind: "tokenpilot-runner",
      externalSessionId: null,
      externalRunId: input.externalRunId,
      sourceExternalId: input.sourceExternalId ?? null,
      relation: "queued",
      modelProvider: null,
      now: input.now
    });
    if (binding.runtimeKind !== "tokenpilot-runner") {
      throw new ServiceError(
        "CONTINUITY_RECORD_INVALID",
        `Runtime binding ${binding.id} is not a Runner binding`
      );
    }
    return binding;
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
  ): CodexRuntimeBindingRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_bindings
        WHERE runtime_kind = 'codex-app-server'
          AND external_session_id = ?
          AND status = 'active'
        LIMIT 1
      `)
      .get(externalThreadId) as RuntimeBindingRow | undefined;
    if (!row) return null;
    const binding = bindingFromRow(row);
    return binding.runtimeKind === "codex-app-server" ? binding : null;
  }

  findActiveByExternalRun(
    externalRunId: string
  ): RunnerRuntimeBindingRecord | null {
    const row = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_bindings
        WHERE runtime_kind = 'tokenpilot-runner'
          AND external_run_id = ?
          AND status = 'active'
        LIMIT 1
      `)
      .get(externalRunId) as RuntimeBindingRow | undefined;
    if (!row) return null;
    const binding = bindingFromRow(row);
    return binding.runtimeKind === "tokenpilot-runner" ? binding : null;
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

  private replaceGeneric(input: {
    id?: string;
    sessionId: string;
    workspaceId: string;
    runtimeKind: RuntimeBindingKind;
    externalSessionId: string | null;
    externalRunId: string | null;
    sourceExternalId: string | null;
    relation: RuntimeBindingRelation;
    modelProvider: string | null;
    now?: string;
  }): RuntimeBindingRecord {
    return this.database.transaction(() => {
      const activeExternal = input.externalSessionId
        ? this.findActiveByExternalThread(input.externalSessionId)
        : input.externalRunId
          ? this.findActiveByExternalRun(input.externalRunId)
          : null;
      if (activeExternal && activeExternal.sessionId !== input.sessionId) {
        const externalId = input.externalSessionId ?? input.externalRunId;
        throw new ServiceError(
          "RUNTIME_BINDING_CONFLICT",
          `Runtime identity ${externalId} is already bound to another active session`,
          {
            details: {
              bindingId: activeExternal.id,
              sessionId: activeExternal.sessionId,
              workspaceId: activeExternal.workspaceId,
              runtimeKind: activeExternal.runtimeKind
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
            id, session_id, workspace_id, runtime_kind,
            external_session_id, external_run_id, source_external_id,
            relation, status, model_provider, created_at, updated_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1)
        `)
        .run(
          id,
          input.sessionId,
          input.workspaceId,
          input.runtimeKind,
          input.externalSessionId,
          input.externalRunId,
          input.sourceExternalId,
          input.relation,
          input.modelProvider,
          now,
          now
        );
      return this.get(id);
    });
  }
}
