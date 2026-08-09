import type { DatabaseSync } from "node:sqlite";

export const runtimeRecoveryAttemptsMigration = {
  version: 14,
  name: "runtime-recovery-attempts",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE runtime_recovery_attempts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
        session_id TEXT REFERENCES development_sessions(id) ON DELETE RESTRICT,
        source_binding_id TEXT REFERENCES runtime_bindings(id) ON DELETE RESTRICT,
        provider_kind TEXT NOT NULL CHECK (length(provider_kind) > 0),
        protocol_kind TEXT NOT NULL CHECK (
          protocol_kind IN ('native-app-server', 'runner', 'chat-direct', 'acp')
        ),
        classification TEXT NOT NULL CHECK (
          classification IN (
            'healthy',
            'recoverable',
            'binding-missing',
            'provider-unavailable',
            'provider-auth-required',
            'provider-version-unsupported',
            'provider-protocol-incompatible',
            'external-runtime-missing',
            'external-runtime-busy',
            'external-runtime-identity-mismatch',
            'writer-conflict',
            'pending-approval',
            'active-run',
            'handoff-required',
            'blocked'
          )
        ),
        assessment_hash TEXT NOT NULL CHECK (
          length(assessment_hash) = 64 AND assessment_hash NOT GLOB '*[^0-9a-f]*'
        ),
        selected_action TEXT CHECK (
          selected_action IS NULL OR selected_action IN (
            'resume-bound-codex',
            'fork-bound-codex',
            'bind-existing-codex-thread',
            'continue-via-handoff',
            'continue-chat-direct',
            'reconcile-runner-binding'
          )
        ),
        status TEXT NOT NULL CHECK (
          status IN ('prepared', 'applied', 'blocked', 'failed', 'superseded', 'expired')
        ),
        resulting_binding_id TEXT REFERENCES runtime_bindings(id) ON DELETE RESTRICT,
        public_summary_json TEXT NOT NULL,
        compatibility_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        CHECK (
          (status = 'prepared' AND resolved_at IS NULL) OR
          (status <> 'prepared' AND resolved_at IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX runtime_recovery_attempt_workspace_index
        ON runtime_recovery_attempts(workspace_id, created_at DESC);

      CREATE INDEX runtime_recovery_attempt_task_index
        ON runtime_recovery_attempts(task_id, created_at DESC);

      CREATE INDEX runtime_recovery_attempt_status_index
        ON runtime_recovery_attempts(status, expires_at);
    `);
  }
} as const;
