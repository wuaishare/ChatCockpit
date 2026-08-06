import type { DatabaseSync } from "node:sqlite";

export const runtimeBindingsMigration = {
  version: 2,
  name: "runtime-bindings-and-pending-idempotency",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE runtime_bindings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('codex-app-server')),
        external_thread_id TEXT NOT NULL,
        source_thread_id TEXT,
        relation TEXT NOT NULL CHECK (relation IN ('bound', 'resumed', 'forked')),
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'released', 'stale')),
        model_provider TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE UNIQUE INDEX runtime_binding_one_active_per_session
        ON runtime_bindings(session_id)
        WHERE status = 'active';

      CREATE UNIQUE INDEX runtime_binding_one_active_per_external_thread
        ON runtime_bindings(runtime_kind, external_thread_id)
        WHERE status = 'active';

      CREATE INDEX runtime_binding_workspace_status_index
        ON runtime_bindings(workspace_id, status);

      ALTER TABLE idempotency_results RENAME TO idempotency_results_v1;

      CREATE TABLE idempotency_results (
        operation_name TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (operation_name, idempotency_key),
        CHECK (
          (status = 'pending' AND result_json IS NULL) OR
          (status = 'completed' AND result_json IS NOT NULL)
        )
      ) STRICT;

      INSERT INTO idempotency_results (
        operation_name, idempotency_key, fingerprint, status,
        result_json, created_at, updated_at
      )
      SELECT
        operation_name, idempotency_key, fingerprint, 'completed',
        result_json, created_at, created_at
      FROM idempotency_results_v1;

      DROP TABLE idempotency_results_v1;
    `);
  }
} as const;
