import type { DatabaseSync } from "node:sqlite";

export const directMutationsMigration = {
  version: 8,
  name: "direct-host-mutation-approvals-and-audit",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE direct_mutation_approvals (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('files.write', 'files.edit')),
        root_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        mutation_hash TEXT NOT NULL,
        executor_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope = 'host'),
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
          (target_kind = 'workspace' AND workspace_id IS NOT NULL AND repo_id IS NOT NULL AND session_id IS NOT NULL)
          OR
          (target_kind = 'pure-host' AND workspace_id IS NULL AND repo_id IS NULL AND session_id IS NULL)
        )
      ) STRICT;

      CREATE INDEX direct_mutation_approval_status_index
        ON direct_mutation_approvals(status, expires_at);

      CREATE INDEX direct_mutation_approval_workspace_index
        ON direct_mutation_approvals(workspace_id, status)
        WHERE workspace_id IS NOT NULL;

      CREATE TABLE direct_mutation_audit (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('files.write', 'files.edit')),
        root_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        before_hash TEXT,
        after_hash TEXT,
        executor_id TEXT NOT NULL,
        approval_id TEXT NOT NULL REFERENCES direct_mutation_approvals(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'unknown')),
        error_code TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX direct_mutation_audit_approval_index
        ON direct_mutation_audit(approval_id, created_at);

      CREATE INDEX direct_mutation_audit_root_index
        ON direct_mutation_audit(root_id, created_at);
    `);
  }
} as const;
