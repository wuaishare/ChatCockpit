import type { DatabaseSync } from "node:sqlite";

export const runtimeResourceMutationsMigration = {
  version: 16,
  name: "runtime-resource-mutations",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE runtime_resource_mutation_approvals (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (
          operation IN ('skill.enable', 'skill.disable')
        ),
        runtime_profile_id TEXT NOT NULL CHECK (length(runtime_profile_id) > 0),
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        resource_id TEXT NOT NULL CHECK (length(resource_id) > 0),
        resource_kind TEXT NOT NULL CHECK (resource_kind = 'skill'),
        resource_scope TEXT NOT NULL CHECK (
          resource_scope IN ('user', 'workspace', 'runtime', 'registry', 'unknown')
        ),
        before_snapshot_id TEXT NOT NULL
          REFERENCES runtime_resource_snapshots(id) ON DELETE RESTRICT,
        before_fingerprint TEXT NOT NULL CHECK (
          length(before_fingerprint) = 64
          AND before_fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
        requested_state_json TEXT NOT NULL,
        mutation_hash TEXT NOT NULL CHECK (
          length(mutation_hash) = 64
          AND mutation_hash NOT GLOB '*[^0-9a-f]*'
        ),
        public_summary_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'approved', 'denied', 'expired', 'stale', 'consumed')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        consumed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX runtime_resource_mutation_approval_resource_index
        ON runtime_resource_mutation_approvals(
          runtime_profile_id,
          resource_id,
          created_at DESC
        );

      CREATE INDEX runtime_resource_mutation_approval_status_index
        ON runtime_resource_mutation_approvals(status, expires_at);

      CREATE TABLE runtime_resource_mutation_executions (
        id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL UNIQUE
          REFERENCES runtime_resource_mutation_approvals(id) ON DELETE RESTRICT,
        operation TEXT NOT NULL CHECK (
          operation IN ('skill.enable', 'skill.disable')
        ),
        runtime_profile_id TEXT NOT NULL CHECK (length(runtime_profile_id) > 0),
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        resource_id TEXT NOT NULL CHECK (length(resource_id) > 0),
        before_snapshot_id TEXT NOT NULL
          REFERENCES runtime_resource_snapshots(id) ON DELETE RESTRICT,
        before_fingerprint TEXT NOT NULL CHECK (
          length(before_fingerprint) = 64
          AND before_fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
        after_snapshot_id TEXT
          REFERENCES runtime_resource_snapshots(id) ON DELETE RESTRICT,
        after_fingerprint TEXT CHECK (
          after_fingerprint IS NULL OR (
            length(after_fingerprint) = 64
            AND after_fingerprint NOT GLOB '*[^0-9a-f]*'
          )
        ),
        requested_state_json TEXT NOT NULL,
        observed_state_json TEXT,
        provider_method TEXT NOT NULL CHECK (
          provider_method = 'skills/config/write'
        ),
        verification_status TEXT NOT NULL CHECK (
          verification_status IN (
            'executing',
            'verified',
            'failed-external',
            'failed-verification',
            'stale'
          )
        ),
        error_code TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;

      CREATE INDEX runtime_resource_mutation_execution_resource_index
        ON runtime_resource_mutation_executions(
          runtime_profile_id,
          resource_id,
          started_at DESC
        );
    `);
  }
} as const;
