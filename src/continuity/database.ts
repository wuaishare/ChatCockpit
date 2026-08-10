import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ServiceError } from "../application/service-error.js";
import { initialContinuityMigration } from "./migrations/001-initial.js";
import { runtimeBindingsMigration } from "./migrations/002-runtime-bindings.js";
import { runtimeExecutionMigration } from "./migrations/003-runtime-execution.js";
import { genericRuntimeBindingsMigration } from "./migrations/004-generic-runtime-bindings.js";
import { developmentDocumentsMigration } from "./migrations/005-development-documents.js";
import { taskDocumentVersionPinsMigration } from "./migrations/006-task-document-version-pins.js";
import { taskExecutionPolicyMigration } from "./migrations/007-task-execution-policy.js";
import { directMutationsMigration } from "./migrations/008-direct-mutations.js";
import { directCommandsMigration } from "./migrations/009-direct-commands.js";
import { directProcessesMigration } from "./migrations/010-direct-processes.js";
import { directProcessStartingMigration } from "./migrations/011-direct-process-starting.js";
import { directProcessRuntimeOwnershipMigration } from "./migrations/012-direct-process-runtime-ownership.js";
import { directProcessSidecarRuntimeMigration } from "./migrations/013-direct-process-sidecar-runtime.js";
import { runtimeRecoveryAttemptsMigration } from "./migrations/014-runtime-recovery-attempts.js";
import { runtimeResourceInventoryMigration } from "./migrations/015-runtime-resource-inventory.js";
import { runtimeResourceMutationsMigration } from "./migrations/016-runtime-resource-mutations.js";
import { governedPluginResourceMutationsMigration } from "./migrations/017-governed-plugin-resource-mutations.js";

interface ContinuityMigration {
  version: number;
  name: string;
  foreignKeysOff?: boolean;
  up(database: DatabaseSync): void;
}

const migrations: readonly ContinuityMigration[] = [
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
  governedPluginResourceMutationsMigration
];
export const LATEST_CONTINUITY_SCHEMA_VERSION =
  migrations[migrations.length - 1]?.version ?? 0;

export interface ContinuityDatabaseOptions {
  path: string;
}

export class ContinuityDatabase {
  readonly sqlite: DatabaseSync;
  readonly path: string;
  private transactionDepth = 0;
  private closed = false;

  constructor(options: ContinuityDatabaseOptions) {
    this.path = options.path;
    if (this.path !== ":memory:") {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }

    this.sqlite = new DatabaseSync(this.path);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    if (this.path !== ":memory:") {
      this.sqlite.exec("PRAGMA journal_mode = WAL");
    }
    this.initializeSchema();
  }

  close(): void {
    if (this.closed) {
      return;
    }
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
    const row = this.sqlite
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };
    return Number(row.version);
  }

  private initializeSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const currentVersion = this.schemaVersion();
    if (currentVersion > LATEST_CONTINUITY_SCHEMA_VERSION) {
      throw new ServiceError(
        "SCHEMA_VERSION_UNSUPPORTED",
        `Continuity schema version ${currentVersion} is newer than supported version ${LATEST_CONTINUITY_SCHEMA_VERSION}`,
        {
          hint: "Upgrade TokenPilot before opening this continuity database."
        }
      );
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) {
        continue;
      }

      const applyMigration = () => {
        migration.up(this.sqlite);
        if (migration.foreignKeysOff) {
          const violations = this.sqlite
            .prepare("PRAGMA foreign_key_check")
            .all() as unknown[];
          if (violations.length > 0) {
            throw new ServiceError(
              "CONTINUITY_MIGRATION_FAILED",
              `Migration ${migration.version} produced foreign-key violations`,
              { details: { violations } }
            );
          }
        }
        this.sqlite
          .prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
          )
          .run(migration.version, migration.name, new Date().toISOString());
      };

      if (migration.foreignKeysOff) {
        this.sqlite.exec("PRAGMA foreign_keys = OFF");
        try {
          this.transaction(applyMigration);
        } finally {
          this.sqlite.exec("PRAGMA foreign_keys = ON");
        }
      } else {
        this.transaction(applyMigration);
      }
    }
  }
}

export function continuityDatabasePath(runtimeDir: string): string {
  return path.join(runtimeDir, "continuity.sqlite");
}
