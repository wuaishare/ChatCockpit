import type { DatabaseSync } from "node:sqlite";

export const developmentDocumentsMigration = {
  version: 5,
  name: "development-documents-and-task-bindings",
  foreignKeysOff: true,
  up(database: DatabaseSync): void {
    const unresolved = database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE spec_id IS NOT NULL OR plan_id IS NOT NULL
      `)
      .get() as { count: number };
    if (Number(unresolved.count) > 0) {
      throw new Error(
        "Schema v5 cannot safely migrate unresolved legacy spec_id/plan_id strings. Clear or export those references before upgrading; TokenPilot will not discard or invent document content."
      );
    }

    database.exec(`
      CREATE TABLE development_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL CHECK (kind IN ('spec', 'plan')),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('draft', 'ready', 'approved', 'superseded', 'archived')
        ),
        current_version INTEGER NOT NULL CHECK (current_version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE TABLE development_document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES development_documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version > 0),
        content_markdown TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(document_id, version)
      ) STRICT;

      CREATE INDEX development_document_workspace_kind_status_idx
      ON development_documents(workspace_id, kind, status, updated_at DESC);

      CREATE INDEX development_document_project_kind_idx
      ON development_documents(project_id, kind, updated_at DESC);

      CREATE TRIGGER development_document_workspace_insert
      BEFORE INSERT ON development_documents
      WHEN NOT EXISTS (
        SELECT 1 FROM workspaces
        WHERE id = NEW.workspace_id AND project_id = NEW.project_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'DEVELOPMENT_DOCUMENT_WORKSPACE_INVALID');
      END;

      CREATE TRIGGER development_document_workspace_update
      BEFORE UPDATE OF project_id, workspace_id ON development_documents
      WHEN NOT EXISTS (
        SELECT 1 FROM workspaces
        WHERE id = NEW.workspace_id AND project_id = NEW.project_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'DEVELOPMENT_DOCUMENT_WORKSPACE_INVALID');
      END;

      CREATE TRIGGER development_document_kind_immutable
      BEFORE UPDATE OF kind ON development_documents
      WHEN NEW.kind <> OLD.kind
      BEGIN
        SELECT RAISE(ABORT, 'DEVELOPMENT_DOCUMENT_KIND_IMMUTABLE');
      END;

      CREATE TRIGGER development_document_version_monotonic
      BEFORE UPDATE OF current_version ON development_documents
      WHEN NEW.current_version < OLD.current_version
        OR NOT EXISTS (
          SELECT 1 FROM development_document_versions
          WHERE document_id = OLD.id AND version = NEW.current_version
        )
      BEGIN
        SELECT RAISE(ABORT, 'DEVELOPMENT_DOCUMENT_VERSION_INVALID');
      END;

      CREATE TRIGGER development_document_version_immutable
      BEFORE UPDATE ON development_document_versions
      BEGIN
        SELECT RAISE(ABORT, 'DEVELOPMENT_DOCUMENT_VERSION_IMMUTABLE');
      END;

      CREATE TABLE tasks_next (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
        spec_id TEXT REFERENCES development_documents(id) ON DELETE SET NULL,
        plan_id TEXT REFERENCES development_documents(id) ON DELETE SET NULL,
        parent_task_id TEXT REFERENCES tasks_next(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('backlog', 'ready', 'in-progress', 'blocked', 'review', 'completed', 'cancelled')
        ),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
        active_session_id TEXT,
        latest_handoff_id TEXT,
        latest_evidence_bundle_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      INSERT INTO tasks_next (
        id, project_id, workspace_id, spec_id, plan_id, parent_task_id,
        title, goal, status, priority, active_session_id,
        latest_handoff_id, latest_evidence_bundle_id,
        created_at, updated_at, revision
      )
      SELECT
        id, project_id, workspace_id, NULL, NULL, parent_task_id,
        title, goal, status, priority, active_session_id,
        latest_handoff_id, latest_evidence_bundle_id,
        created_at, updated_at, revision
      FROM tasks;

      DROP TABLE tasks;
      ALTER TABLE tasks_next RENAME TO tasks;

      CREATE INDEX task_project_status_index ON tasks(project_id, status);

      CREATE TRIGGER task_spec_reference_insert
      BEFORE INSERT ON tasks
      WHEN NEW.spec_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM development_documents
          WHERE id = NEW.spec_id
            AND kind = 'spec'
            AND project_id = NEW.project_id
            AND workspace_id = NEW.workspace_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_SPEC_REFERENCE_INVALID');
      END;

      CREATE TRIGGER task_spec_reference_update
      BEFORE UPDATE OF spec_id, project_id, workspace_id ON tasks
      WHEN NEW.spec_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM development_documents
          WHERE id = NEW.spec_id
            AND kind = 'spec'
            AND project_id = NEW.project_id
            AND workspace_id = NEW.workspace_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_SPEC_REFERENCE_INVALID');
      END;

      CREATE TRIGGER task_plan_reference_insert
      BEFORE INSERT ON tasks
      WHEN NEW.plan_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM development_documents
          WHERE id = NEW.plan_id
            AND kind = 'plan'
            AND project_id = NEW.project_id
            AND workspace_id = NEW.workspace_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_PLAN_REFERENCE_INVALID');
      END;

      CREATE TRIGGER task_plan_reference_update
      BEFORE UPDATE OF plan_id, project_id, workspace_id ON tasks
      WHEN NEW.plan_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM development_documents
          WHERE id = NEW.plan_id
            AND kind = 'plan'
            AND project_id = NEW.project_id
            AND workspace_id = NEW.workspace_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'TASK_PLAN_REFERENCE_INVALID');
      END;
    `);
  }
} as const;
