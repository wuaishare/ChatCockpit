import type { DatabaseSync } from "node:sqlite";

export const directCommandsMigration = {
  version: 9,
  name: "direct-host-command-approvals-and-audit",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE direct_command_approvals (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        workdir TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        effect TEXT NOT NULL CHECK (effect IN ('read', 'write')),
        timeout_ms INTEGER NOT NULL CHECK (timeout_ms > 0 AND timeout_ms <= 15000),
        executor_id TEXT NOT NULL,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('workspace', 'pure-host')),
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        repo_id TEXT,
        session_id TEXT REFERENCES development_sessions(id) ON DELETE RESTRICT,
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
          (target_kind = 'workspace' AND workspace_id IS NOT NULL AND repo_id IS NOT NULL)
          OR
          (target_kind = 'pure-host' AND workspace_id IS NULL AND repo_id IS NULL AND session_id IS NULL)
        )
      ) STRICT;

      CREATE INDEX direct_command_approval_status_index
        ON direct_command_approvals(status, expires_at);

      CREATE INDEX direct_command_approval_workspace_index
        ON direct_command_approvals(workspace_id, status)
        WHERE workspace_id IS NOT NULL;

      CREATE TABLE direct_command_audit (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        workdir TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        effect TEXT NOT NULL CHECK (effect IN ('read', 'write')),
        executor_id TEXT NOT NULL,
        approval_id TEXT NOT NULL REFERENCES direct_command_approvals(id) ON DELETE RESTRICT,
        exit_code INTEGER,
        timed_out INTEGER NOT NULL CHECK (timed_out IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'unknown')),
        error_code TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX direct_command_audit_approval_index
        ON direct_command_audit(approval_id, created_at);

      CREATE INDEX direct_command_audit_root_index
        ON direct_command_audit(root_id, created_at);
    `);
  }
} as const;
