import type { ContinuityDatabase } from "../database.js";
import type { ProjectRecord, ProjectStatus } from "../types.js";
import {
  assertUpdated,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface ProjectRow {
  id: string;
  slug: string;
  display_name: string;
  default_workspace_id: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  revision: number;
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    defaultWorkspaceId: row.default_workspace_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };
}

export interface CreateProjectInput {
  id?: string;
  slug: string;
  displayName: string;
  status?: ProjectStatus;
  now?: string;
}

export class ProjectRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateProjectInput): ProjectRecord {
    const id = input.id ?? newRecordId("project");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO projects (
          id, slug, display_name, default_workspace_id, status,
          created_at, updated_at, revision
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, 1)
      `)
      .run(id, input.slug, input.displayName, input.status ?? "active", now, now);
    return this.get(id);
  }

  get(id: string): ProjectRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined;
    return projectFromRow(requireRecord(row, "Project", id));
  }

  findBySlug(slug: string): ProjectRecord | null {
    const row = this.database.sqlite
      .prepare("SELECT * FROM projects WHERE slug = ?")
      .get(slug) as ProjectRow | undefined;
    return row ? projectFromRow(row) : null;
  }

  list(status?: ProjectStatus): ProjectRecord[] {
    const rows = status
      ? (this.database.sqlite
          .prepare("SELECT * FROM projects WHERE status = ? ORDER BY created_at ASC")
          .all(status) as unknown as ProjectRow[])
      : (this.database.sqlite
          .prepare("SELECT * FROM projects ORDER BY created_at ASC")
          .all() as unknown as ProjectRow[]);
    return rows.map(projectFromRow);
  }

  rename(
    id: string,
    displayName: string,
    expectedRevision: number,
    now?: string
  ): ProjectRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE projects
        SET display_name = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(displayName, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Project", id, expectedRevision);
    return this.get(id);
  }

  setDefaultWorkspace(
    id: string,
    workspaceId: string | null,
    expectedRevision: number,
    now?: string
  ): ProjectRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE projects
        SET default_workspace_id = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(workspaceId, nowIso(now), id, expectedRevision);
    assertUpdated(result.changes, "Project", id, expectedRevision);
    return this.get(id);
  }
}
