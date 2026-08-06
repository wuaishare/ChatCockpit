import type { DatabaseSync } from "node:sqlite";

export const initialContinuityMigration = {
  version: 1,
  name: "initial-continuity-schema",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        default_workspace_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        repo_id TEXT NOT NULL,
        private_path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('checkout', 'worktree')),
        branch TEXT,
        head_commit TEXT,
        dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('ready', 'missing', 'blocked', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        UNIQUE(project_id, repo_id, private_path)
      ) STRICT;

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        spec_id TEXT,
        plan_id TEXT,
        parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('backlog', 'ready', 'in-progress', 'blocked', 'review', 'completed', 'cancelled')
        ),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
        active_session_id TEXT,
        latest_handoff_id TEXT,
        latest_evidence_bundle_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE TABLE development_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('chat-direct', 'codex-session', 'async-agent')),
        status TEXT NOT NULL CHECK (
          status IN ('idle', 'running', 'waiting-approval', 'handoff-ready', 'completed', 'failed')
        ),
        active_runtime_binding_id TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE TABLE writer_leases (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        holder_type TEXT NOT NULL CHECK (holder_type IN ('chat-direct', 'codex-session', 'async-agent')),
        holder_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'expired', 'revoked')),
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        released_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE UNIQUE INDEX writer_lease_one_active_per_workspace
        ON writer_leases(workspace_id)
        WHERE status = 'active';

      CREATE TABLE handoff_checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        from_mode TEXT NOT NULL CHECK (from_mode IN ('chat-direct', 'codex-session', 'async-agent')),
        to_mode TEXT NOT NULL CHECK (to_mode IN ('chat-direct', 'codex-session', 'async-agent', 'unassigned')),
        goal TEXT NOT NULL,
        completed_items_json TEXT NOT NULL,
        pending_items_json TEXT NOT NULL,
        changed_files_json TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        next_action TEXT NOT NULL,
        git_head TEXT,
        git_branch TEXT,
        git_dirty INTEGER NOT NULL CHECK (git_dirty IN (0, 1)),
        diff_artifact_id TEXT,
        evidence_bundle_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'accepted', 'superseded')),
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE UNIQUE INDEX handoff_one_ready_per_task
        ON handoff_checkpoints(task_id)
        WHERE status = 'ready';

      CREATE TABLE evidence_bundles (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('collecting', 'complete', 'incomplete')),
        required_item_count INTEGER NOT NULL DEFAULT 0 CHECK (required_item_count >= 0),
        passed_item_count INTEGER NOT NULL DEFAULT 0 CHECK (passed_item_count >= 0),
        failed_item_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_item_count >= 0),
        skipped_item_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_item_count >= 0),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE TABLE evidence_items (
        id TEXT PRIMARY KEY,
        bundle_id TEXT NOT NULL REFERENCES evidence_bundles(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (
          kind IN ('command', 'test', 'build', 'lint', 'typecheck', 'diff', 'review', 'screenshot', 'manual')
        ),
        label TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'not-run')),
        required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
        command TEXT,
        exit_code INTEGER,
        artifact_id TEXT,
        summary TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE idempotency_results (
        operation_name TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (operation_name, idempotency_key)
      ) STRICT;

      CREATE INDEX workspace_project_index ON workspaces(project_id);
      CREATE INDEX task_project_status_index ON tasks(project_id, status);
      CREATE INDEX session_task_status_index ON development_sessions(task_id, status);
      CREATE INDEX handoff_task_created_index ON handoff_checkpoints(task_id, created_at DESC);
      CREATE INDEX evidence_task_created_index ON evidence_bundles(task_id, created_at DESC);
    `);
  }
} as const;
