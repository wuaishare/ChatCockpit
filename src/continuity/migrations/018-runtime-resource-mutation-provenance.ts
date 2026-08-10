import type { DatabaseSync } from "node:sqlite";

function rowCount(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

export const runtimeResourceMutationProvenanceMigration = {
  version: 18,
  name: "runtime-resource-mutation-provenance",
  foreignKeysOff: true,
  up(database: DatabaseSync): void {
    const approvalCount = rowCount(database, "runtime_resource_mutation_approvals");
    const executionCount = rowCount(database, "runtime_resource_mutation_executions");

    database.exec(`
      CREATE TABLE runtime_resource_mutation_approvals_v18 (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (
          operation IN (
            'skill.enable',
            'skill.disable',
            'plugin.install',
            'plugin.uninstall'
          )
        ),
        runtime_profile_id TEXT NOT NULL CHECK (length(runtime_profile_id) > 0),
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        resource_id TEXT NOT NULL CHECK (length(resource_id) > 0),
        resource_kind TEXT NOT NULL CHECK (
          resource_kind IN ('skill', 'plugin')
        ),
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
        requested_actor_type TEXT CHECK (
          requested_actor_type IS NULL OR requested_actor_type IN (
            'local-cli',
            'local-ui',
            'rest-api',
            'gpt-actions',
            'remote-mcp',
            'runner'
          )
        ),
        requested_actor_identity_hash TEXT CHECK (
          requested_actor_identity_hash IS NULL OR (
            length(requested_actor_identity_hash) = 64
            AND requested_actor_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        requested_request_identity_hash TEXT CHECK (
          requested_request_identity_hash IS NULL OR (
            length(requested_request_identity_hash) = 64
            AND requested_request_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        decided_actor_type TEXT CHECK (
          decided_actor_type IS NULL OR decided_actor_type IN (
            'local-cli',
            'local-ui',
            'rest-api',
            'gpt-actions',
            'remote-mcp',
            'runner'
          )
        ),
        decided_actor_identity_hash TEXT CHECK (
          decided_actor_identity_hash IS NULL OR (
            length(decided_actor_identity_hash) = 64
            AND decided_actor_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        decided_request_identity_hash TEXT CHECK (
          decided_request_identity_hash IS NULL OR (
            length(decided_request_identity_hash) = 64
            AND decided_request_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
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

      INSERT INTO runtime_resource_mutation_approvals_v18 (
        id, operation, runtime_profile_id, workspace_id, resource_id,
        resource_kind, resource_scope, before_snapshot_id, before_fingerprint,
        requested_state_json, mutation_hash, public_summary_json,
        requested_actor_type, requested_actor_identity_hash,
        requested_request_identity_hash, decided_actor_type,
        decided_actor_identity_hash, decided_request_identity_hash,
        status, created_at, updated_at, expires_at, decided_at, consumed_at, revision
      )
      SELECT
        id, operation, runtime_profile_id, workspace_id, resource_id,
        resource_kind, resource_scope, before_snapshot_id, before_fingerprint,
        requested_state_json, mutation_hash, public_summary_json,
        NULL, NULL, NULL, NULL, NULL, NULL,
        status, created_at, updated_at, expires_at, decided_at, consumed_at, revision
      FROM runtime_resource_mutation_approvals;

      CREATE TABLE runtime_resource_mutation_executions_v18 (
        id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL UNIQUE
          REFERENCES runtime_resource_mutation_approvals_v18(id) ON DELETE RESTRICT,
        operation TEXT NOT NULL CHECK (
          operation IN (
            'skill.enable',
            'skill.disable',
            'plugin.install',
            'plugin.uninstall'
          )
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
          provider_method IN (
            'skills/config/write',
            'plugin/install',
            'plugin/uninstall'
          )
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
        executed_actor_type TEXT CHECK (
          executed_actor_type IS NULL OR executed_actor_type IN (
            'local-cli',
            'local-ui',
            'rest-api',
            'gpt-actions',
            'remote-mcp',
            'runner'
          )
        ),
        executed_actor_identity_hash TEXT CHECK (
          executed_actor_identity_hash IS NULL OR (
            length(executed_actor_identity_hash) = 64
            AND executed_actor_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        executed_request_identity_hash TEXT CHECK (
          executed_request_identity_hash IS NULL OR (
            length(executed_request_identity_hash) = 64
            AND executed_request_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        started_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;

      INSERT INTO runtime_resource_mutation_executions_v18 (
        id, approval_id, operation, runtime_profile_id, workspace_id,
        resource_id, before_snapshot_id, before_fingerprint,
        after_snapshot_id, after_fingerprint, requested_state_json,
        observed_state_json, provider_method, verification_status,
        error_code, executed_actor_type, executed_actor_identity_hash,
        executed_request_identity_hash, started_at, finished_at
      )
      SELECT
        id, approval_id, operation, runtime_profile_id, workspace_id,
        resource_id, before_snapshot_id, before_fingerprint,
        after_snapshot_id, after_fingerprint, requested_state_json,
        observed_state_json, provider_method, verification_status,
        error_code, NULL, NULL, NULL, started_at, finished_at
      FROM runtime_resource_mutation_executions;
    `);

    if (
      rowCount(database, "runtime_resource_mutation_approvals_v18") !== approvalCount ||
      rowCount(database, "runtime_resource_mutation_executions_v18") !== executionCount
    ) {
      throw new Error("Runtime Resource mutation provenance migration row count mismatch");
    }

    database.exec(`
      DROP TABLE runtime_resource_mutation_executions;
      DROP TABLE runtime_resource_mutation_approvals;

      ALTER TABLE runtime_resource_mutation_approvals_v18
        RENAME TO runtime_resource_mutation_approvals;
      ALTER TABLE runtime_resource_mutation_executions_v18
        RENAME TO runtime_resource_mutation_executions;

      CREATE INDEX runtime_resource_mutation_approval_resource_index
        ON runtime_resource_mutation_approvals(
          runtime_profile_id,
          resource_id,
          created_at DESC
        );

      CREATE INDEX runtime_resource_mutation_approval_status_index
        ON runtime_resource_mutation_approvals(status, expires_at);

      CREATE INDEX runtime_resource_mutation_execution_resource_index
        ON runtime_resource_mutation_executions(
          runtime_profile_id,
          resource_id,
          started_at DESC
        );

      CREATE INDEX runtime_resource_mutation_approval_workspace_activity_index
        ON runtime_resource_mutation_approvals(workspace_id, updated_at DESC);

      CREATE INDEX runtime_resource_mutation_approval_resource_activity_index
        ON runtime_resource_mutation_approvals(resource_id, updated_at DESC);

      CREATE INDEX runtime_resource_mutation_execution_resource_activity_index
        ON runtime_resource_mutation_executions(resource_id, started_at DESC);

      CREATE INDEX runtime_resource_mutation_execution_approval_index
        ON runtime_resource_mutation_executions(approval_id, started_at DESC);
    `);
  }
} as const;
