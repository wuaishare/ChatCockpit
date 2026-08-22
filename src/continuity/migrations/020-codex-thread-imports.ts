import type { DatabaseSync } from "node:sqlite";

export const codexThreadImportsMigration = {
  version: 20,
  name: "codex-thread-imports",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE codex_thread_imports (
        id TEXT PRIMARY KEY,
        source_thread_id TEXT NOT NULL CHECK (length(source_thread_id) > 0),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (state IN ('assessed', 'importing', 'ready', 'failed')),
        assessment_hash TEXT NOT NULL CHECK (
          length(assessment_hash) = 64 AND assessment_hash NOT GLOB '*[^0-9a-f]*'
        ),
        expires_at TEXT NOT NULL,
        source_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
        source_session_id TEXT REFERENCES development_sessions(id) ON DELETE RESTRICT,
        handoff_id TEXT REFERENCES handoff_checkpoints(id) ON DELETE RESTRICT,
        continuation_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
        continuation_session_id TEXT REFERENCES development_sessions(id) ON DELETE RESTRICT,
        context_json TEXT,
        context_truncated INTEGER NOT NULL DEFAULT 0 CHECK (context_truncated IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE UNIQUE INDEX codex_thread_import_source_workspace_unique
      ON codex_thread_imports(source_thread_id, workspace_id);

      CREATE INDEX codex_thread_import_workspace_index
      ON codex_thread_imports(workspace_id, created_at DESC);
    `);
  }
} as const;
