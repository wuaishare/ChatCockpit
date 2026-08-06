import type { DatabaseSync } from "node:sqlite";

export const genericRuntimeBindingsMigration = {
  version: 4,
  name: "generic-runtime-bindings",
  foreignKeysOff: true,
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE runtime_bindings_next (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('codex-app-server', 'tokenpilot-runner')),
        external_session_id TEXT,
        external_run_id TEXT,
        source_external_id TEXT,
        relation TEXT NOT NULL CHECK (relation IN ('bound', 'resumed', 'forked', 'queued')),
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'released', 'stale')),
        model_provider TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        CHECK (
          (runtime_kind = 'codex-app-server' AND external_session_id IS NOT NULL AND external_run_id IS NULL)
          OR
          (runtime_kind = 'tokenpilot-runner' AND external_session_id IS NULL AND external_run_id IS NOT NULL)
        )
      ) STRICT;

      INSERT INTO runtime_bindings_next (
        id,
        session_id,
        workspace_id,
        runtime_kind,
        external_session_id,
        external_run_id,
        source_external_id,
        relation,
        status,
        model_provider,
        created_at,
        updated_at,
        revision
      )
      SELECT
        id,
        session_id,
        workspace_id,
        runtime_kind,
        external_thread_id,
        NULL,
        source_thread_id,
        relation,
        status,
        model_provider,
        created_at,
        updated_at,
        revision
      FROM runtime_bindings;

      DROP TABLE runtime_bindings;
      ALTER TABLE runtime_bindings_next RENAME TO runtime_bindings;

      CREATE UNIQUE INDEX runtime_binding_one_active_per_session
      ON runtime_bindings(session_id)
      WHERE status = 'active';

      CREATE UNIQUE INDEX runtime_binding_one_active_external_session
      ON runtime_bindings(runtime_kind, external_session_id)
      WHERE status = 'active' AND external_session_id IS NOT NULL;

      CREATE UNIQUE INDEX runtime_binding_one_active_external_run
      ON runtime_bindings(runtime_kind, external_run_id)
      WHERE status = 'active' AND external_run_id IS NOT NULL;

      CREATE INDEX runtime_bindings_workspace_idx
      ON runtime_bindings(workspace_id, created_at DESC);
    `);
  }
} as const;
