import type { DatabaseSync } from "node:sqlite";

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );
}

export const hostProcessScopesMigration = {
  version: 22,
  name: "host-process-scopes-and-authorities",
  foreignKeysOff: true,
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE host_process_authorities (
        id TEXT PRIMARY KEY,
        authorization_grant_id TEXT NOT NULL CHECK (length(authorization_grant_id) > 0),
        actor_type TEXT NOT NULL CHECK (length(actor_type) > 0),
        actor_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'expired')),
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        released_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX host_process_authority_grant_index
        ON host_process_authorities(authorization_grant_id, status, expires_at);
    `);

    const hasSessions = tableExists(database, "direct_process_sessions");
    const hasApprovals = tableExists(database, "direct_process_approvals");
    if (!hasSessions && !hasApprovals) return;
    if (hasSessions !== hasApprovals) {
      throw new Error(
        "Host Process schema is incomplete before v22 migration"
      );
    }

    database.exec(`
      CREATE TABLE direct_process_sessions_v22 (
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
            AND session_id IS NOT NULL
            AND writer_lease_id IS NOT NULL
            AND host_authority_id IS NULL
          )
          OR
          (
            scope = 'host'
            AND workspace_id IS NULL
            AND repo_id IS NULL
            AND session_id IS NULL
            AND writer_lease_id IS NULL
            AND host_authority_id IS NOT NULL
          )
        )
      ) STRICT;

      INSERT INTO direct_process_sessions_v22 (
        id, scope, root_id, workdir, command, command_hash, executor_id,
        workspace_id, repo_id, session_id, writer_lease_id, host_authority_id,
        private_pid, status, exit_code, stale_reason, evidence_bundle_id,
        started_at, completed_at, revision
      )
      SELECT
        id, 'workspace', root_id, workdir, command, command_hash, executor_id,
        workspace_id, repo_id, session_id, writer_lease_id, NULL,
        private_pid, status, exit_code, stale_reason, evidence_bundle_id,
        started_at, completed_at, revision
      FROM direct_process_sessions;

      DROP TABLE direct_process_sessions;
      ALTER TABLE direct_process_sessions_v22 RENAME TO direct_process_sessions;

      CREATE INDEX direct_process_session_status_index
        ON direct_process_sessions(status, started_at);

      CREATE INDEX direct_process_session_workspace_index
        ON direct_process_sessions(workspace_id, status, started_at)
        WHERE scope = 'workspace';

      CREATE INDEX direct_process_session_owner_index
        ON direct_process_sessions(session_id, status, started_at)
        WHERE scope = 'workspace';

      CREATE INDEX direct_process_session_host_authority_index
        ON direct_process_sessions(host_authority_id, status, started_at)
        WHERE scope = 'host';

      CREATE TABLE direct_process_approvals_v22 (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('start', 'input', 'stop')),
        process_id TEXT REFERENCES direct_process_sessions(id) ON DELETE RESTRICT,
        scope TEXT NOT NULL CHECK (scope IN ('workspace', 'host')),
        action_hash TEXT NOT NULL,
        root_id TEXT,
        workdir TEXT,
        command TEXT,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        repo_id TEXT,
        session_id TEXT REFERENCES development_sessions(id) ON DELETE RESTRICT,
        writer_lease_id TEXT REFERENCES writer_leases(id) ON DELETE RESTRICT,
        authorization_grant_id TEXT,
        executor_id TEXT NOT NULL,
        input_hash TEXT,
        input_bytes INTEGER CHECK (input_bytes IS NULL OR input_bytes >= 0),
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'approved', 'denied', 'consumed', 'expired')
        ),
        public_summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        consumed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        CHECK (
          (
            scope = 'workspace'
            AND workspace_id IS NOT NULL
            AND repo_id IS NOT NULL
            AND session_id IS NOT NULL
            AND writer_lease_id IS NOT NULL
            AND authorization_grant_id IS NULL
          )
          OR
          (
            scope = 'host'
            AND workspace_id IS NULL
            AND repo_id IS NULL
            AND session_id IS NULL
            AND writer_lease_id IS NULL
            AND authorization_grant_id IS NOT NULL
          )
        ),
        CHECK (
          (
            operation = 'start'
            AND root_id IS NOT NULL
            AND workdir IS NOT NULL
            AND command IS NOT NULL
            AND input_hash IS NULL
            AND input_bytes IS NULL
          )
          OR
          (
            operation = 'input'
            AND process_id IS NOT NULL
            AND input_hash IS NOT NULL
            AND input_bytes IS NOT NULL
          )
          OR
          (
            operation = 'stop'
            AND process_id IS NOT NULL
            AND input_hash IS NULL
            AND input_bytes IS NULL
          )
        )
      ) STRICT;

      INSERT INTO direct_process_approvals_v22 (
        id, operation, process_id, scope, action_hash, root_id, workdir, command,
        workspace_id, repo_id, session_id, writer_lease_id, authorization_grant_id,
        executor_id, input_hash, input_bytes, status, public_summary_json,
        created_at, expires_at, decided_at, consumed_at, revision
      )
      SELECT
        id, operation, process_id, 'workspace', action_hash, root_id, workdir, command,
        workspace_id, repo_id, session_id, writer_lease_id, NULL,
        executor_id, input_hash, input_bytes, status, public_summary_json,
        created_at, expires_at, decided_at, consumed_at, revision
      FROM direct_process_approvals;

      DROP TABLE direct_process_approvals;
      ALTER TABLE direct_process_approvals_v22 RENAME TO direct_process_approvals;

      CREATE INDEX direct_process_approval_status_index
        ON direct_process_approvals(status, expires_at);

      CREATE INDEX direct_process_approval_process_index
        ON direct_process_approvals(process_id, status, created_at)
        WHERE process_id IS NOT NULL;

      CREATE INDEX direct_process_approval_grant_index
        ON direct_process_approvals(authorization_grant_id, status, created_at)
        WHERE scope = 'host';
    `);
  }
} as const;
