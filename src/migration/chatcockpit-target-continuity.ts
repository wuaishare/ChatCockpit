import { DatabaseSync } from "node:sqlite";

export const CHATCOCKPIT_TARGET_IDENTITY_MIGRATION =
  "chatcockpit-domain-identity-v1";

export interface ChatCockpitTargetContinuityMigrationResult {
  alreadyApplied: boolean;
  runtimeBindingRowsUpdated: number;
  runtimeResourceRowsUpdated: number;
}

function requireContinuityV18(database: DatabaseSync): void {
  const row = database
    .prepare("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number | null } | undefined;
  if (Number(row?.version ?? 0) !== 18) {
    throw new Error(
      `ChatCockpit target identity migration requires continuity schema v18, received ${String(
        row?.version ?? "unknown"
      )}`
    );
  }
}

function hasIdentityMigration(database: DatabaseSync): boolean {
  const table = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_identity_migrations'"
    )
    .get() as { name: string } | undefined;
  if (!table) return false;
  const row = database
    .prepare("SELECT name FROM product_identity_migrations WHERE name = ?")
    .get(CHATCOCKPIT_TARGET_IDENTITY_MIGRATION) as { name: string } | undefined;
  return Boolean(row);
}

function countValue(
  database: DatabaseSync,
  table: string,
  column: string,
  value: string
): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
    .get(value) as { count: number };
  return Number(row.count);
}

function verifyTargetSchema(database: DatabaseSync): void {
  const runtimeBindingSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runtime_bindings'")
    .get() as { sql: string } | undefined;
  const runtimeResourceSql = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runtime_resource_items'"
    )
    .get() as { sql: string } | undefined;
  if (!runtimeBindingSql?.sql.includes("'async-runner'")) {
    throw new Error("ChatCockpit target runtime_bindings schema is missing async-runner");
  }
  if (runtimeBindingSql.sql.includes("'tokenpilot-runner'")) {
    throw new Error("ChatCockpit target runtime_bindings schema still accepts tokenpilot-runner");
  }
  if (!runtimeResourceSql?.sql.includes("'control-plane-local'")) {
    throw new Error(
      "ChatCockpit target runtime_resource_items schema is missing control-plane-local"
    );
  }
  if (runtimeResourceSql.sql.includes("'tokenpilot-local'")) {
    throw new Error(
      "ChatCockpit target runtime_resource_items schema still accepts tokenpilot-local"
    );
  }
  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    throw new Error("ChatCockpit target identity migration produced foreign key violations");
  }
}

export function migrateChatCockpitTargetContinuityDatabase(
  databasePath: string,
  options: { now?: string } = {}
): ChatCockpitTargetContinuityMigrationResult {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  try {
    requireContinuityV18(database);
    if (hasIdentityMigration(database)) {
      verifyTargetSchema(database);
      return {
        alreadyApplied: true,
        runtimeBindingRowsUpdated: 0,
        runtimeResourceRowsUpdated: 0
      };
    }

    const runtimeBindingRowsUpdated = countValue(
      database,
      "runtime_bindings",
      "runtime_kind",
      "tokenpilot-runner"
    );
    const runtimeResourceRowsUpdated = countValue(
      database,
      "runtime_resource_items",
      "source_kind",
      "tokenpilot-local"
    );

    database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec("BEGIN IMMEDIATE");
      database.exec(`
        CREATE TABLE runtime_bindings_chatcockpit_next (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
          runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('codex-app-server', 'async-runner')),
          external_session_id TEXT,
          external_run_id TEXT,
          source_external_id TEXT,
          relation TEXT NOT NULL CHECK (relation IN ('bound', 'resumed', 'forked', 'queued')),
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'released', 'stale')),
          model_provider TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
          CHECK (
            (runtime_kind = 'codex-app-server' AND external_session_id IS NOT NULL AND external_run_id IS NULL)
            OR
            (runtime_kind = 'async-runner' AND external_session_id IS NULL AND external_run_id IS NOT NULL)
          )
        ) STRICT;

        INSERT INTO runtime_bindings_chatcockpit_next (
          id, session_id, workspace_id, runtime_kind,
          external_session_id, external_run_id, source_external_id,
          relation, status, model_provider, created_at, updated_at, revision
        )
        SELECT
          id,
          session_id,
          workspace_id,
          CASE runtime_kind
            WHEN 'tokenpilot-runner' THEN 'async-runner'
            ELSE runtime_kind
          END,
          external_session_id,
          external_run_id,
          source_external_id,
          relation,
          status,
          model_provider,
          created_at,
          updated_at,
          revision
        FROM runtime_bindings;

        DROP TABLE runtime_bindings;
        ALTER TABLE runtime_bindings_chatcockpit_next RENAME TO runtime_bindings;

        CREATE UNIQUE INDEX runtime_binding_one_active_per_session
          ON runtime_bindings(session_id)
          WHERE status = 'active';

        CREATE UNIQUE INDEX runtime_binding_one_active_external_session
          ON runtime_bindings(runtime_kind, external_session_id)
          WHERE status = 'active' AND external_session_id IS NOT NULL;

        CREATE UNIQUE INDEX runtime_binding_one_active_external_run
          ON runtime_bindings(runtime_kind, external_run_id)
          WHERE status = 'active' AND external_run_id IS NOT NULL;

        CREATE INDEX runtime_bindings_workspace_idx
          ON runtime_bindings(workspace_id, created_at DESC);

        CREATE TABLE runtime_resource_items_chatcockpit_next (
          snapshot_id TEXT NOT NULL REFERENCES runtime_resource_snapshots(id) ON DELETE CASCADE,
          resource_id TEXT NOT NULL CHECK (length(resource_id) > 0),
          kind TEXT NOT NULL CHECK (
            kind IN ('skill', 'mcp-server', 'plugin', 'runtime-adapter', 'acp-agent')
          ),
          external_id TEXT NOT NULL CHECK (length(external_id) > 0),
          display_name TEXT NOT NULL CHECK (length(display_name) > 0),
          description TEXT,
          scope TEXT NOT NULL CHECK (
            scope IN ('user', 'workspace', 'runtime', 'registry', 'unknown')
          ),
          installed INTEGER CHECK (installed IS NULL OR installed IN (0, 1)),
          enabled INTEGER CHECK (enabled IS NULL OR enabled IN (0, 1)),
          version TEXT,
          available_version TEXT,
          update_status TEXT NOT NULL CHECK (
            update_status IN ('current', 'update-available', 'unknown', 'not-applicable')
          ),
          auth_status TEXT NOT NULL CHECK (
            auth_status IN ('ready', 'required', 'unsupported', 'unknown', 'not-applicable')
          ),
          compatibility_status TEXT NOT NULL CHECK (
            compatibility_status IN ('ready', 'degraded', 'blocked', 'unknown')
          ),
          source_kind TEXT NOT NULL CHECK (
            source_kind IN ('runtime-native', 'control-plane-local', 'acp-registry')
          ),
          source_label TEXT NOT NULL CHECK (length(source_label) > 0),
          capabilities_json TEXT NOT NULL,
          public_reason TEXT,
          fingerprint TEXT NOT NULL CHECK (
            length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'
          ),
          PRIMARY KEY (snapshot_id, resource_id)
        ) STRICT;

        INSERT INTO runtime_resource_items_chatcockpit_next (
          snapshot_id, resource_id, kind, external_id, display_name, description,
          scope, installed, enabled, version, available_version, update_status,
          auth_status, compatibility_status, source_kind, source_label,
          capabilities_json, public_reason, fingerprint
        )
        SELECT
          snapshot_id,
          resource_id,
          kind,
          external_id,
          display_name,
          description,
          scope,
          installed,
          enabled,
          version,
          available_version,
          update_status,
          auth_status,
          compatibility_status,
          CASE source_kind
            WHEN 'tokenpilot-local' THEN 'control-plane-local'
            ELSE source_kind
          END,
          source_label,
          capabilities_json,
          public_reason,
          fingerprint
        FROM runtime_resource_items;

        DROP TABLE runtime_resource_items;
        ALTER TABLE runtime_resource_items_chatcockpit_next RENAME TO runtime_resource_items;

        CREATE INDEX runtime_resource_item_resource_index
          ON runtime_resource_items(resource_id, snapshot_id);

        CREATE INDEX runtime_resource_item_kind_index
          ON runtime_resource_items(kind, snapshot_id);

        CREATE TABLE IF NOT EXISTS product_identity_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        ) STRICT;
      `);
      database
        .prepare(
          "INSERT INTO product_identity_migrations (name, applied_at) VALUES (?, ?)"
        )
        .run(
          CHATCOCKPIT_TARGET_IDENTITY_MIGRATION,
          options.now ?? new Date().toISOString()
        );
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original migration failure.
      }
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }

    verifyTargetSchema(database);
    return {
      alreadyApplied: false,
      runtimeBindingRowsUpdated,
      runtimeResourceRowsUpdated
    };
  } finally {
    database.close();
  }
}
