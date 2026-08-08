import type { DatabaseSync } from "node:sqlite";

export const directProcessSidecarRuntimeMigration = {
  version: 13,
  name: "direct-host-process-sidecar-runtime",
  foreignKeysOff: true,
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE direct_process_sessions_v13 (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        workdir TEXT NOT NULL,
        command TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        executor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        repo_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE RESTRICT,
        writer_lease_id TEXT NOT NULL REFERENCES writer_leases(id) ON DELETE RESTRICT,
        private_pid INTEGER CHECK (private_pid IS NULL OR private_pid > 0),
        status TEXT NOT NULL CHECK (
          status IN ('starting', 'running', 'exited', 'terminated', 'failed', 'stale')
        ),
        exit_code INTEGER,
        stale_reason TEXT,
        evidence_bundle_id TEXT REFERENCES evidence_bundles(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      INSERT INTO direct_process_sessions_v13 (
        id, root_id, workdir, command, command_hash, executor_id,
        workspace_id, repo_id, session_id, writer_lease_id, private_pid,
        status, exit_code, stale_reason, evidence_bundle_id, started_at,
        completed_at, revision
      )
      SELECT
        id, root_id, workdir, command, command_hash, executor_id,
        workspace_id, repo_id, session_id, writer_lease_id, private_pid,
        status, exit_code, stale_reason, evidence_bundle_id, started_at,
        completed_at, revision
      FROM direct_process_sessions;

      DROP TABLE direct_process_sessions;
      ALTER TABLE direct_process_sessions_v13 RENAME TO direct_process_sessions;

      CREATE INDEX direct_process_session_status_index
        ON direct_process_sessions(status, started_at);

      CREATE INDEX direct_process_session_workspace_index
        ON direct_process_sessions(workspace_id, status, started_at);

      CREATE INDEX direct_process_session_owner_index
        ON direct_process_sessions(session_id, status, started_at);
    `);
  }
} as const;
