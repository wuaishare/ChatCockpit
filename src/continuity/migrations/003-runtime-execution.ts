import type { DatabaseSync } from "node:sqlite";

export const runtimeExecutionMigration = {
  version: 3,
  name: "runtime-runs-approvals-and-events",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE runtime_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        runtime_binding_id TEXT NOT NULL REFERENCES runtime_bindings(id) ON DELETE RESTRICT,
        thread_id TEXT NOT NULL,
        external_turn_id TEXT,
        status TEXT NOT NULL CHECK (
          status IN (
            'starting', 'running', 'waiting-approval', 'completed',
            'failed', 'interrupted', 'stale'
          )
        ),
        input_hash TEXT NOT NULL,
        input_length INTEGER NOT NULL CHECK (input_length >= 0),
        handoff_id TEXT NOT NULL REFERENCES handoff_checkpoints(id) ON DELETE RESTRICT,
        evidence_bundle_id TEXT NOT NULL REFERENCES evidence_bundles(id) ON DELETE RESTRICT,
        writer_lease_id TEXT NOT NULL REFERENCES writer_leases(id) ON DELETE RESTRICT,
        model_loop_owner TEXT NOT NULL CHECK (model_loop_owner = 'codex'),
        approval_policy TEXT NOT NULL CHECK (approval_policy = 'on-request'),
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE UNIQUE INDEX runtime_run_one_active_per_session
        ON runtime_runs(session_id)
        WHERE status IN ('starting', 'running', 'waiting-approval');

      CREATE UNIQUE INDEX runtime_run_external_turn_unique
        ON runtime_runs(thread_id, external_turn_id)
        WHERE external_turn_id IS NOT NULL;

      CREATE INDEX runtime_run_workspace_status_index
        ON runtime_runs(workspace_id, status);

      CREATE TABLE runtime_approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runtime_runs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        item_id TEXT,
        request_key TEXT NOT NULL UNIQUE,
        server_request_id_json TEXT NOT NULL,
        request_method TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('command-execution', 'file-change', 'permissions', 'unsupported')
        ),
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'responded', 'resolved', 'cancelled', 'stale')
        ),
        public_summary_json TEXT NOT NULL,
        private_request_json TEXT NOT NULL,
        decision_json TEXT,
        received_at TEXT NOT NULL,
        responded_at TEXT,
        resolved_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX runtime_approval_run_status_index
        ON runtime_approvals(run_id, status, received_at);

      CREATE INDEX runtime_approval_session_status_index
        ON runtime_approvals(session_id, status, received_at);

      CREATE TABLE runtime_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT REFERENCES runtime_runs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        item_id TEXT,
        method TEXT NOT NULL,
        category TEXT NOT NULL CHECK (
          category IN ('lifecycle', 'approval', 'item', 'warning', 'error', 'other')
        ),
        public_payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX runtime_event_session_sequence_index
        ON runtime_events(session_id, sequence);

      CREATE INDEX runtime_event_run_sequence_index
        ON runtime_events(run_id, sequence);
    `);
  }
} as const;
