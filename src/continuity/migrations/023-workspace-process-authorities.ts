import type { DatabaseSync } from "node:sqlite";

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );
}

export const workspaceProcessAuthoritiesMigration = {
  version: 23,
  name: "workspace-process-core-writer-authorities",
  foreignKeysOff: true,
  up(database: DatabaseSync): void {
    if (!tableExists(database, "direct_process_sessions")) return;

    database.exec(`
      CREATE TABLE direct_process_sessions_v23 (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('workspace', 'host')),
        root_id TEXT NOT NULL,
        workdir TEXT NOT NULL,
        command TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        executor_id TEXT NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        repo_id TEXT,
        session_id TEXT REFERENCES development_sessions(id) ON DELETE RESTRICT,
        writer_lease_id TEXT REFERENCES writer_leases(id) ON DELETE RESTRICT,
        core_writer_authority_id TEXT REFERENCES core_writer_authorities(id) ON DELETE RESTRICT,
        host_authority_id TEXT REFERENCES host_process_authorities(id) ON DELETE RESTRICT,
        private_pid INTEGER CHECK (private_pid IS NULL OR private_pid > 0),
        status TEXT NOT NULL CHECK (
          status IN ('starting', 'running', 'exited', 'terminated', 'failed', 'stale')
        ),
        exit_code INTEGER,
        stale_reason TEXT,
        evidence_bundle_id TEXT REFERENCES evidence_bundles(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        CHECK (
          (
            scope = 'workspace'
            AND workspace_id IS NOT NULL
            AND repo_id IS NOT NULL
            AND host_authority_id IS NULL
            AND (writer_lease_id IS NULL OR session_id IS NOT NULL)
            AND NOT (writer_lease_id IS NOT NULL AND core_writer_authority_id IS NOT NULL)
          )
          OR
          (
            scope = 'host'
            AND workspace_id IS NULL
            AND repo_id IS NULL
            AND session_id IS NULL
            AND writer_lease_id IS NULL
            AND core_writer_authority_id IS NULL
            AND host_authority_id IS NOT NULL
          )
        )
      ) STRICT;

      INSERT INTO direct_process_sessions_v23 (
        id, scope, root_id, workdir, command, command_hash, executor_id,
        workspace_id, repo_id, session_id, writer_lease_id, core_writer_authority_id,
        host_authority_id, private_pid, status, exit_code, stale_reason,
        evidence_bundle_id, started_at, completed_at, revision
      )
      SELECT
        id, scope, root_id, workdir, command, command_hash, executor_id,
        workspace_id, repo_id, session_id, writer_lease_id, NULL,
        host_authority_id, private_pid, status, exit_code, stale_reason,
        evidence_bundle_id, started_at, completed_at, revision
      FROM direct_process_sessions;

      DROP TABLE direct_process_sessions;
      ALTER TABLE direct_process_sessions_v23 RENAME TO direct_process_sessions;

      CREATE INDEX direct_process_session_status_index
        ON direct_process_sessions(status, started_at);

      CREATE INDEX direct_process_session_workspace_index
        ON direct_process_sessions(workspace_id, status, started_at)
        WHERE scope = 'workspace';

      CREATE INDEX direct_process_session_owner_index
        ON direct_process_sessions(session_id, status, started_at)
        WHERE scope = 'workspace' AND session_id IS NOT NULL;

      CREATE INDEX direct_process_session_core_writer_authority_index
        ON direct_process_sessions(core_writer_authority_id, status, started_at)
        WHERE scope = 'workspace' AND core_writer_authority_id IS NOT NULL;

      CREATE INDEX direct_process_session_host_authority_index
        ON direct_process_sessions(host_authority_id, status, started_at)
        WHERE scope = 'host';
    `);
  }
} as const;
