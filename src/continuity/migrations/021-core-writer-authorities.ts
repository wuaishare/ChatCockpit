import type { DatabaseSync } from "node:sqlite";

export const coreWriterAuthoritiesMigration = {
  version: 21,
  name: "core-workspace-writer-authorities",
  up(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE core_writer_authorities (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        holder_request_id TEXT NOT NULL CHECK (length(holder_request_id) > 0),
        actor_type TEXT NOT NULL CHECK (length(actor_type) > 0),
        actor_id TEXT,
        authorization_grant_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'released', 'expired')),
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        released_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE UNIQUE INDEX core_writer_authority_one_active_per_workspace
      ON core_writer_authorities(workspace_id)
      WHERE status = 'active';

      CREATE INDEX core_writer_authority_workspace_history
      ON core_writer_authorities(workspace_id, acquired_at DESC);
    `);
  }
} as const;
