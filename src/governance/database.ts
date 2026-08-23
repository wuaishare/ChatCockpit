import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ServiceError } from "../application/service-error.js";

interface GovernanceMigration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

const initialGovernanceMigration: GovernanceMigration = {
  version: 1,
  name: "governed-external-actions",
  up(database) {
    database.exec(`
      CREATE TABLE governed_external_action_approvals (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL CHECK (length(target_id) > 0),
        provider_id TEXT NOT NULL CHECK (length(provider_id) > 0),
        tool_name TEXT NOT NULL CHECK (length(tool_name) > 0),
        arguments_hash TEXT NOT NULL CHECK (
          length(arguments_hash) = 64
          AND arguments_hash NOT GLOB '*[^0-9a-f]*'
        ),
        public_summary_json TEXT NOT NULL,
        requested_actor_type TEXT CHECK (
          requested_actor_type IS NULL OR requested_actor_type IN (
            'local-cli', 'local-ui', 'rest-api', 'gpt-actions', 'remote-mcp', 'runner'
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
            'local-cli', 'local-ui', 'rest-api', 'gpt-actions', 'remote-mcp', 'runner'
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

      CREATE INDEX governed_external_action_approval_status_index
        ON governed_external_action_approvals(status, expires_at);
      CREATE INDEX governed_external_action_approval_provider_index
        ON governed_external_action_approvals(provider_id, tool_name, updated_at DESC);

      CREATE TABLE governed_external_action_executions (
        id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL UNIQUE
          REFERENCES governed_external_action_approvals(id) ON DELETE RESTRICT,
        target_id TEXT NOT NULL CHECK (length(target_id) > 0),
        provider_id TEXT NOT NULL CHECK (length(provider_id) > 0),
        tool_name TEXT NOT NULL CHECK (length(tool_name) > 0),
        arguments_hash TEXT NOT NULL CHECK (
          length(arguments_hash) = 64
          AND arguments_hash NOT GLOB '*[^0-9a-f]*'
        ),
        verification_status TEXT NOT NULL CHECK (
          verification_status IN (
            'executing', 'succeeded', 'failed-external', 'failed-projection', 'stale'
          )
        ),
        error_code TEXT,
        executed_actor_type TEXT CHECK (
          executed_actor_type IS NULL OR executed_actor_type IN (
            'local-cli', 'local-ui', 'rest-api', 'gpt-actions', 'remote-mcp', 'runner'
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

      CREATE INDEX governed_external_action_execution_approval_index
        ON governed_external_action_executions(approval_id, started_at DESC);
    `);
  }
};

const operationalActivityProvenanceMigration: GovernanceMigration = {
  version: 2,
  name: "operational-activity-provenance",
  up(database) {
    database.exec(`
      CREATE TABLE operational_activity_provenance (
        activity_id TEXT PRIMARY KEY CHECK (length(activity_id) > 0),
        activity_kind TEXT NOT NULL CHECK (activity_kind IN ('agent-session', 'job')),
        authorization_grant_id TEXT,
        actor_type TEXT NOT NULL CHECK (
          actor_type IN ('local-cli', 'local-ui', 'rest-api', 'gpt-actions', 'remote-mcp', 'runner')
        ),
        actor_identity_hash TEXT CHECK (
          actor_identity_hash IS NULL OR (
            length(actor_identity_hash) = 64
            AND actor_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        request_identity_hash TEXT NOT NULL CHECK (
          length(request_identity_hash) = 64
          AND request_identity_hash NOT GLOB '*[^0-9a-f]*'
        ),
        trace_id TEXT NOT NULL CHECK (length(trace_id) > 8),
        worker_instance_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX operational_activity_provenance_grant_index
        ON operational_activity_provenance(authorization_grant_id, updated_at DESC);
      CREATE INDEX operational_activity_provenance_trace_index
        ON operational_activity_provenance(trace_id);
    `);
  }
};

const operationalActivityControlEventsMigration: GovernanceMigration = {
  version: 3,
  name: "operational-activity-control-events",
  up(database) {
    database.exec(`
      CREATE TABLE operational_activity_control_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE CHECK (length(id) > 0),
        job_id TEXT NOT NULL CHECK (length(job_id) > 0),
        action TEXT NOT NULL CHECK (action IN ('pause', 'resume', 'terminate')),
        resulting_state TEXT NOT NULL CHECK (
          resulting_state IN ('running', 'paused', 'terminated', 'completed', 'failed')
        ),
        process_revision INTEGER NOT NULL CHECK (process_revision > 0),
        actor_type TEXT NOT NULL CHECK (
          actor_type IN ('local-cli', 'local-ui', 'rest-api', 'gpt-actions', 'remote-mcp', 'runner')
        ),
        actor_identity_hash TEXT CHECK (
          actor_identity_hash IS NULL OR (
            length(actor_identity_hash) = 64
            AND actor_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        request_identity_hash TEXT NOT NULL CHECK (
          length(request_identity_hash) = 64
          AND request_identity_hash NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX operational_activity_control_job_sequence_index
        ON operational_activity_control_events(job_id, sequence DESC);
    `);
  }
};

const deviceRuntimeOperationsMigration: GovernanceMigration = {
  version: 4,
  name: "device-runtime-operations",
  up(database) {
    database.exec(`
      CREATE TABLE device_runtime_operations (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        device_id TEXT NOT NULL CHECK (device_id GLOB 'cc_device_*'),
        action TEXT NOT NULL CHECK (action IN ('start', 'stop', 'restart')),
        state TEXT NOT NULL CHECK (
          state IN ('prepared', 'awaiting-approval', 'executing', 'succeeded', 'failed', 'ambiguous', 'stale')
        ),
        approval_id TEXT NOT NULL REFERENCES governed_external_action_approvals(id) ON DELETE RESTRICT,
        authorization_grant_id TEXT,
        expected_state_revision INTEGER CHECK (
          expected_state_revision IS NULL OR expected_state_revision >= 0
        ),
        requested_actor_type TEXT NOT NULL CHECK (
          requested_actor_type IN ('local-cli', 'local-ui', 'rest-api', 'gpt-actions', 'remote-mcp', 'runner')
        ),
        requested_actor_identity_hash TEXT CHECK (
          requested_actor_identity_hash IS NULL OR (
            length(requested_actor_identity_hash) = 64
            AND requested_actor_identity_hash NOT GLOB '*[^0-9a-f]*'
          )
        ),
        requested_request_identity_hash TEXT NOT NULL CHECK (
          length(requested_request_identity_hash) = 64
          AND requested_request_identity_hash NOT GLOB '*[^0-9a-f]*'
        ),
        executed_actor_type TEXT CHECK (
          executed_actor_type IS NULL OR executed_actor_type IN (
            'local-cli', 'local-ui', 'rest-api', 'gpt-actions', 'remote-mcp', 'runner'
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
        preflight_conditions_json TEXT,
        postflight_conditions_json TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX device_runtime_operations_device_index
        ON device_runtime_operations(device_id, updated_at DESC);
      CREATE INDEX device_runtime_operations_state_index
        ON device_runtime_operations(state, updated_at DESC);
      CREATE INDEX device_runtime_operations_approval_index
        ON device_runtime_operations(approval_id);
    `);
  }
};

const migrations: readonly GovernanceMigration[] = [
  initialGovernanceMigration,
  operationalActivityProvenanceMigration,
  operationalActivityControlEventsMigration,
  deviceRuntimeOperationsMigration
];
export const LATEST_GOVERNANCE_SCHEMA_VERSION =
  migrations[migrations.length - 1]?.version ?? 0;

export interface GovernanceDatabaseOptions {
  path: string;
  readOnly?: boolean;
}

export class GovernanceDatabase {
  readonly sqlite: DatabaseSync;
  readonly path: string;
  private transactionDepth = 0;
  private closed = false;

  constructor(options: GovernanceDatabaseOptions) {
    this.path = options.path;
    const readOnly = options.readOnly === true;
    if (this.path !== ":memory:" && !readOnly) {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }

    this.sqlite = new DatabaseSync(this.path, { readOnly });
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    if (this.path !== ":memory:" && !readOnly) {
      this.sqlite.exec("PRAGMA journal_mode = WAL");
    }

    if (readOnly) {
      this.assertSupportedVersion();
    } else {
      this.initializeSchema();
    }
  }

  close(): void {
    if (this.closed) return;
    this.sqlite.close();
    this.closed = true;
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) {
      return operation();
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  schemaVersion(): number {
    const table = this.sqlite
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'governance_schema_migrations'"
      )
      .get() as { present: number } | undefined;
    if (!table) return 0;
    const row = this.sqlite
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM governance_schema_migrations")
      .get() as { version: number };
    return Number(row.version);
  }

  private assertSupportedVersion(): void {
    const currentVersion = this.schemaVersion();
    if (currentVersion > LATEST_GOVERNANCE_SCHEMA_VERSION) {
      throw new ServiceError(
        "SCHEMA_VERSION_UNSUPPORTED",
        `Governance schema version ${currentVersion} is newer than supported version ${LATEST_GOVERNANCE_SCHEMA_VERSION}`,
        { hint: "Upgrade ChatCockpit before opening this governance database." }
      );
    }
  }

  private initializeSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS governance_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);
    this.assertSupportedVersion();
    const currentVersion = this.schemaVersion();
    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      this.transaction(() => {
        migration.up(this.sqlite);
        this.sqlite
          .prepare(
            "INSERT INTO governance_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
          )
          .run(migration.version, migration.name, new Date().toISOString());
      });
    }
  }
}

export function governanceDatabasePath(runtimeDir: string): string {
  // compatibility migration: platform governance has an independent
  // logical schema chain but intentionally shares the existing machine-local
  // SQLite file until the storage boundary is proven safe to split.
  return path.join(runtimeDir, "continuity.sqlite");
}
