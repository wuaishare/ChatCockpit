import type { DatabaseSync } from "node:sqlite";

export const taskDocumentVersionPinsMigration = {
  version: 6,
  name: "task-document-version-pins",
  up(database: DatabaseSync): void {
    database.exec(`
      ALTER TABLE tasks
      ADD COLUMN spec_version INTEGER
      CHECK (spec_version IS NULL OR spec_version > 0);

      ALTER TABLE tasks
      ADD COLUMN plan_version INTEGER
      CHECK (plan_version IS NULL OR plan_version > 0);

      CREATE TRIGGER task_spec_version_insert
      BEFORE INSERT ON tasks
      WHEN
        (NEW.spec_id IS NULL AND NEW.spec_version IS NOT NULL)
        OR (NEW.spec_id IS NOT NULL AND NEW.spec_version IS NULL)
        OR (
          NEW.spec_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM development_document_versions
            WHERE document_id = NEW.spec_id AND version = NEW.spec_version
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_SPEC_VERSION_INVALID');
      END;

      CREATE TRIGGER task_spec_version_update
      BEFORE UPDATE OF spec_id, spec_version ON tasks
      WHEN
        (NEW.spec_id IS NULL AND NEW.spec_version IS NOT NULL)
        OR (NEW.spec_id IS NOT NULL AND NEW.spec_version IS NULL)
        OR (
          NEW.spec_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM development_document_versions
            WHERE document_id = NEW.spec_id AND version = NEW.spec_version
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_SPEC_VERSION_INVALID');
      END;

      CREATE TRIGGER task_plan_version_insert
      BEFORE INSERT ON tasks
      WHEN
        (NEW.plan_id IS NULL AND NEW.plan_version IS NOT NULL)
        OR (NEW.plan_id IS NOT NULL AND NEW.plan_version IS NULL)
        OR (
          NEW.plan_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM development_document_versions
            WHERE document_id = NEW.plan_id AND version = NEW.plan_version
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_PLAN_VERSION_INVALID');
      END;

      CREATE TRIGGER task_plan_version_update
      BEFORE UPDATE OF plan_id, plan_version ON tasks
      WHEN
        (NEW.plan_id IS NULL AND NEW.plan_version IS NOT NULL)
        OR (NEW.plan_id IS NOT NULL AND NEW.plan_version IS NULL)
        OR (
          NEW.plan_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM development_document_versions
            WHERE document_id = NEW.plan_id AND version = NEW.plan_version
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_PLAN_VERSION_INVALID');
      END;
    `);
  }
} as const;
