import type { DatabaseSync } from "node:sqlite";

export const directProcessesMigration = {
  version: 10,
  name: "direct-host-managed-processes",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE direct_process_sessions (
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
        private_pid INTEGER NOT NULL CHECK (private_pid > 0),
        status TEXT NOT NULL CHECK (
          status IN ('running', 'exited', 'terminated', 'failed', 'stale')
        ),
        exit_code INTEGER,
        stale_reason TEXT,
        evidence_bundle_id TEXT REFERENCES evidence_bundles(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX direct_process_session_status_index
        ON direct_process_sessions(status, started_at);

      CREATE INDEX direct_process_session_workspace_index
        ON direct_process_sessions(workspace_id, status, started_at);

      CREATE INDEX direct_process_session_owner_index
        ON direct_process_sessions(session_id, status, started_at);

      CREATE TABLE direct_process_approvals (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('start', 'input', 'stop')),
        process_id TEXT REFERENCES direct_process_sessions(id) ON DELETE RESTRICT,
        action_hash TEXT NOT NULL,
        root_id TEXT,
        workdir TEXT,
        command TEXT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        repo_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE RESTRICT,
        writer_lease_id TEXT REFERENCES writer_leases(id) ON DELETE RESTRICT,
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
          (operation = 'start' AND root_id IS NOT NULL AND workdir IS NOT NULL AND command IS NOT NULL AND writer_lease_id IS NOT NULL AND input_hash IS NULL AND input_bytes IS NULL)
          OR
          (operation = 'input' AND process_id IS NOT NULL AND input_hash IS NOT NULL AND input_bytes IS NOT NULL)
          OR
          (operation = 'stop' AND process_id IS NOT NULL AND input_hash IS NULL AND input_bytes IS NULL)
        )
      ) STRICT;

      CREATE INDEX direct_process_approval_status_index
        ON direct_process_approvals(status, expires_at);

      CREATE INDEX direct_process_approval_process_index
        ON direct_process_approvals(process_id, status, created_at)
        WHERE process_id IS NOT NULL;

      CREATE TABLE direct_process_audit (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('start', 'input', 'stop', 'cleanup')),
        process_id TEXT NOT NULL,
        action_hash TEXT NOT NULL,
        approval_id TEXT REFERENCES direct_process_approvals(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'unknown')),
        error_code TEXT,
        terminal_reason TEXT,
        exit_code INTEGER,
        output_bytes INTEGER NOT NULL DEFAULT 0 CHECK (output_bytes >= 0),
        output_truncated INTEGER NOT NULL DEFAULT 0 CHECK (output_truncated IN (0, 1)),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX direct_process_audit_process_index
        ON direct_process_audit(process_id, created_at);

      CREATE INDEX direct_process_audit_approval_index
        ON direct_process_audit(approval_id, created_at)
        WHERE approval_id IS NOT NULL;
    `);
  }
} as const;
