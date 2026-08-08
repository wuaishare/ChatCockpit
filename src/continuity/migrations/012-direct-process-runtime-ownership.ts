import type { DatabaseSync } from "node:sqlite";

export const directProcessRuntimeOwnershipMigration = {
  version: 12,
  name: "direct-host-process-runtime-ownership",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE direct_process_runtime_ownership (
        process_id TEXT PRIMARY KEY
          REFERENCES direct_process_sessions(id) ON DELETE CASCADE,
        supervisor_generation TEXT NOT NULL CHECK (length(supervisor_generation) > 0),
        attached_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX direct_process_runtime_ownership_generation_index
        ON direct_process_runtime_ownership(supervisor_generation, last_seen_at);
    `);
  }
} as const;
