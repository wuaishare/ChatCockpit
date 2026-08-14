import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { initialContinuityMigration } from "../../../src/continuity/migrations/001-initial.js";
import { runtimeBindingsMigration } from "../../../src/continuity/migrations/002-runtime-bindings.js";
import { runtimeExecutionMigration } from "../../../src/continuity/migrations/003-runtime-execution.js";
import { genericRuntimeBindingsMigration } from "../../../src/continuity/migrations/004-generic-runtime-bindings.js";
import { developmentDocumentsMigration } from "../../../src/continuity/migrations/005-development-documents.js";
import { taskDocumentVersionPinsMigration } from "../../../src/continuity/migrations/006-task-document-version-pins.js";
import { taskExecutionPolicyMigration } from "../../../src/continuity/migrations/007-task-execution-policy.js";
import { directMutationsMigration } from "../../../src/continuity/migrations/008-direct-mutations.js";
import { directCommandsMigration } from "../../../src/continuity/migrations/009-direct-commands.js";
import { directProcessesMigration } from "../../../src/continuity/migrations/010-direct-processes.js";
import { directProcessStartingMigration } from "../../../src/continuity/migrations/011-direct-process-starting.js";
import { directProcessRuntimeOwnershipMigration } from "../../../src/continuity/migrations/012-direct-process-runtime-ownership.js";
import { directProcessSidecarRuntimeMigration } from "../../../src/continuity/migrations/013-direct-process-sidecar-runtime.js";
import { runtimeRecoveryAttemptsMigration } from "../../../src/continuity/migrations/014-runtime-recovery-attempts.js";
import { runtimeResourceInventoryMigration } from "../../../src/continuity/migrations/015-runtime-resource-inventory.js";
import { runtimeResourceMutationsMigration } from "../../../src/continuity/migrations/016-runtime-resource-mutations.js";
import { governedPluginResourceMutationsMigration } from "../../../src/continuity/migrations/017-governed-plugin-resource-mutations.js";
import { runtimeResourceMutationProvenanceMigration } from "../../../src/continuity/migrations/018-runtime-resource-mutation-provenance.js";

interface FixtureMigration {
  version: number;
  name: string;
  foreignKeysOff?: boolean;
  up(database: DatabaseSync): void;
}

const migrations: readonly FixtureMigration[] = [
  initialContinuityMigration,
  runtimeBindingsMigration,
  runtimeExecutionMigration,
  genericRuntimeBindingsMigration,
  developmentDocumentsMigration,
  taskDocumentVersionPinsMigration,
  taskExecutionPolicyMigration,
  directMutationsMigration,
  directCommandsMigration,
  directProcessesMigration,
  directProcessStartingMigration,
  directProcessRuntimeOwnershipMigration,
  directProcessSidecarRuntimeMigration,
  runtimeRecoveryAttemptsMigration,
  runtimeResourceInventoryMigration,
  runtimeResourceMutationsMigration,
  governedPluginResourceMutationsMigration,
  runtimeResourceMutationProvenanceMigration
];

export function buildTokenPilotV18FixtureDatabase(
  databasePath: string,
  workspacePath: string
): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);

  for (const migration of migrations) {
    if (migration.foreignKeysOff) database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec("BEGIN IMMEDIATE");
      migration.up(database);
      database
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, "2026-08-01T00:00:00.000Z");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      if (migration.foreignKeysOff) database.exec("PRAGMA foreign_keys = ON");
    }
  }

  database
    .prepare(`
      INSERT INTO projects (
        id, slug, display_name, default_workspace_id, status,
        created_at, updated_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "project_fixture_tokenpilot",
      "tokenpilot",
      "tokenpilot",
      "workspace_fixture_tokenpilot",
      "active",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      1
    );
  database
    .prepare(`
      INSERT INTO workspaces (
        id, project_id, repo_id, private_path, kind, branch, head_commit,
        dirty, status, created_at, updated_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "workspace_fixture_tokenpilot",
      "project_fixture_tokenpilot",
      "tokenpilot",
      workspacePath,
      "checkout",
      "main",
      null,
      0,
      "ready",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      1
    );

  const version = database
    .prepare("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number };
  if (Number(version.version) !== 18) {
    database.close();
    throw new Error(`Legacy fixture must remain schema v18, received ${String(version.version)}`);
  }
  database.close();
}
