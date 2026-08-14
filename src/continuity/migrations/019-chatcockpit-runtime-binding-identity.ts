import type { DatabaseSync } from "node:sqlite";

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );
}

function rowCount(database: DatabaseSync, table: string): number {
  return Number(
    (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
      .count
  );
}

function migrateRuntimeBindings(database: DatabaseSync): void {
  if (!tableExists(database, "runtime_bindings")) return;
  const before = rowCount(database, "runtime_bindings");

  database.exec(`
    CREATE TABLE runtime_bindings_v19 (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES development_sessions(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
      runtime_kind TEXT NOT NULL CHECK (
        runtime_kind IN ('codex-app-server', 'tokenpilot-runner', 'async-runner')
      ),
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
        (runtime_kind IN ('tokenpilot-runner', 'async-runner') AND external_session_id IS NULL AND external_run_id IS NOT NULL)
      )
    ) STRICT;

    INSERT INTO runtime_bindings_v19 (
      id, session_id, workspace_id, runtime_kind,
      external_session_id, external_run_id, source_external_id,
      relation, status, model_provider, created_at, updated_at, revision
    )
    SELECT
      id, session_id, workspace_id, runtime_kind,
      external_session_id, external_run_id, source_external_id,
      relation, status, model_provider, created_at, updated_at, revision
    FROM runtime_bindings;
  `);

  if (rowCount(database, "runtime_bindings_v19") !== before) {
    throw new Error("ChatCockpit runtime binding identity migration row count mismatch");
  }

  database.exec(`
    DROP TABLE runtime_bindings;
    ALTER TABLE runtime_bindings_v19 RENAME TO runtime_bindings;

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
  `);
}

function migrateRuntimeResourceItems(database: DatabaseSync): void {
  if (!tableExists(database, "runtime_resource_items")) return;
  const before = rowCount(database, "runtime_resource_items");

  database.exec(`
    CREATE TABLE runtime_resource_items_v19 (
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
        source_kind IN (
          'runtime-native',
          'tokenpilot-local',
          'control-plane-local',
          'acp-registry'
        )
      ),
      source_label TEXT NOT NULL CHECK (length(source_label) > 0),
      capabilities_json TEXT NOT NULL,
      public_reason TEXT,
      fingerprint TEXT NOT NULL CHECK (
        length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'
      ),
      PRIMARY KEY (snapshot_id, resource_id)
    ) STRICT;

    INSERT INTO runtime_resource_items_v19 (
      snapshot_id, resource_id, kind, external_id, display_name, description,
      scope, installed, enabled, version, available_version, update_status,
      auth_status, compatibility_status, source_kind, source_label,
      capabilities_json, public_reason, fingerprint
    )
    SELECT
      snapshot_id, resource_id, kind, external_id, display_name, description,
      scope, installed, enabled, version, available_version, update_status,
      auth_status, compatibility_status, source_kind, source_label,
      capabilities_json, public_reason, fingerprint
    FROM runtime_resource_items;
  `);

  if (rowCount(database, "runtime_resource_items_v19") !== before) {
    throw new Error("ChatCockpit runtime resource identity migration row count mismatch");
  }

  database.exec(`
    DROP TABLE runtime_resource_items;
    ALTER TABLE runtime_resource_items_v19 RENAME TO runtime_resource_items;

    CREATE INDEX runtime_resource_item_resource_index
    ON runtime_resource_items(resource_id, snapshot_id);

    CREATE INDEX runtime_resource_item_kind_index
    ON runtime_resource_items(kind, snapshot_id);
  `);
}

export const chatCockpitRuntimeBindingIdentityMigration = {
  version: 19,
  name: "chatcockpit-runtime-domain-identity",
  foreignKeysOff: true,
  up(database: DatabaseSync): void {
    migrateRuntimeBindings(database);
    migrateRuntimeResourceItems(database);
  }
} as const;
