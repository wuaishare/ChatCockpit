import type { DatabaseSync } from "node:sqlite";

export const taskExecutionPolicyMigration = {
  version: 7,
  name: "task-execution-policy",
  up(database: DatabaseSync): void {
    database.exec(`
      ALTER TABLE tasks
      ADD COLUMN execution_policy TEXT NOT NULL DEFAULT 'planning-optional'
      CHECK (execution_policy IN ('planning-required', 'planning-optional'));
    `);
  }
} as const;
