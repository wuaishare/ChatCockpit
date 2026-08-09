import type { DatabaseSync } from "node:sqlite";

export const runtimeResourceInventoryMigration = {
  version: 15,
  name: "runtime-resource-inventory",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE runtime_resource_snapshots (
        id TEXT PRIMARY KEY,
        runtime_profile_id TEXT NOT NULL CHECK (length(runtime_profile_id) > 0),
        provider_kind TEXT NOT NULL CHECK (length(provider_kind) > 0),
        protocol_kind TEXT NOT NULL CHECK (length(protocol_kind) > 0),
        status TEXT NOT NULL CHECK (status IN ('ready', 'partial', 'failed')),
        profile_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL CHECK (
          length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
        captured_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX runtime_resource_snapshot_profile_index
        ON runtime_resource_snapshots(runtime_profile_id, captured_at DESC);

      CREATE TABLE runtime_resource_items (
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
          source_kind IN ('runtime-native', 'tokenpilot-local', 'acp-registry')
        ),
        source_label TEXT NOT NULL CHECK (length(source_label) > 0),
        capabilities_json TEXT NOT NULL,
        public_reason TEXT,
        fingerprint TEXT NOT NULL CHECK (
          length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
        PRIMARY KEY (snapshot_id, resource_id)
      ) STRICT;

      CREATE INDEX runtime_resource_item_resource_index
        ON runtime_resource_items(resource_id, snapshot_id);

      CREATE INDEX runtime_resource_item_kind_index
        ON runtime_resource_items(kind, snapshot_id);
    `);
  }
} as const;
