import type { ContinuityDatabase } from "../database.js";
import type {
  PrivateWorkspaceRecord,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceStatus
} from "../types.js";
import {
  assertUpdated,
  booleanFromSql,
  newRecordId,
  nowIso,
  requireRecord
} from "./repository-utils.js";

interface WorkspaceRow {
  id: string;
  project_id: string;
  repo_id: string;
  private_path: string;
  kind: WorkspaceKind;
  branch: string | null;
  head_commit: string | null;
  dirty: number;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
  revision: number;
}

function privateWorkspaceFromRow(row: WorkspaceRow): PrivateWorkspaceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    repoId: row.repo_id,
    privatePath: row.private_path,
    kind: row.kind,
    branch: row.branch,
    headCommit: row.head_commit,
    dirty: booleanFromSql(row.dirty),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };
}

function publicWorkspace(record: PrivateWorkspaceRecord): WorkspaceRecord {
  const { privatePath: _privatePath, ...projected } = record;
  return projected;
}

export interface CreateWorkspaceInput {
  id?: string;
  projectId: string;
  repoId: string;
  privatePath: string;
  kind?: WorkspaceKind;
  branch?: string | null;
  headCommit?: string | null;
  dirty?: boolean;
  status?: WorkspaceStatus;
  now?: string;
}

export class WorkspaceRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  create(input: CreateWorkspaceInput): PrivateWorkspaceRecord {
    const id = input.id ?? newRecordId("workspace");
    const now = nowIso(input.now);
    this.database.sqlite
      .prepare(`
        INSERT INTO workspaces (
          id, project_id, repo_id, private_path, kind, branch, head_commit,
          dirty, status, created_at, updated_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `)
      .run(
        id,
        input.projectId,
        input.repoId,
        input.privatePath,
        input.kind ?? "checkout",
        input.branch ?? null,
        input.headCommit ?? null,
        input.dirty ? 1 : 0,
        input.status ?? "ready",
        now,
        now
      );
    return this.getPrivate(id);
  }

  getPrivate(id: string): PrivateWorkspaceRecord {
    const row = this.database.sqlite
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(id) as WorkspaceRow | undefined;
    return privateWorkspaceFromRow(requireRecord(row, "Workspace", id));
  }

  get(id: string): WorkspaceRecord {
    return publicWorkspace(this.getPrivate(id));
  }

  findPrivateByRepoId(repoId: string): PrivateWorkspaceRecord | null {
    const row = this.database.sqlite
      .prepare(
        "SELECT * FROM workspaces WHERE repo_id = ? ORDER BY created_at ASC LIMIT 1"
      )
      .get(repoId) as WorkspaceRow | undefined;
    return row ? privateWorkspaceFromRow(row) : null;
  }

  findPrivateByProjectRepo(
    projectId: string,
    repoId: string
  ): PrivateWorkspaceRecord | null {
    const row = this.database.sqlite
      .prepare(
        "SELECT * FROM workspaces WHERE project_id = ? AND repo_id = ? ORDER BY created_at ASC LIMIT 1"
      )
      .get(projectId, repoId) as WorkspaceRow | undefined;
    return row ? privateWorkspaceFromRow(row) : null;
  }

  listByProject(projectId: string): WorkspaceRecord[] {
    const rows = this.database.sqlite
      .prepare("SELECT * FROM workspaces WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as unknown as WorkspaceRow[];
    return rows.map((row) => publicWorkspace(privateWorkspaceFromRow(row)));
  }

  listPrivate(): PrivateWorkspaceRecord[] {
    const rows = this.database.sqlite
      .prepare("SELECT * FROM workspaces ORDER BY created_at ASC")
      .all() as unknown as WorkspaceRow[];
    return rows.map(privateWorkspaceFromRow);
  }

  syncConfiguration(
    id: string,
    input: {
      privatePath: string;
      status: WorkspaceStatus;
      expectedRevision: number;
      now?: string;
    }
  ): PrivateWorkspaceRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE workspaces
        SET private_path = ?, status = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(
        input.privatePath,
        input.status,
        nowIso(input.now),
        id,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Workspace", id, input.expectedRevision);
    return this.getPrivate(id);
  }

  updateGitState(
    id: string,
    input: {
      branch: string | null;
      headCommit: string | null;
      dirty: boolean;
      status?: WorkspaceStatus;
      expectedRevision: number;
      now?: string;
    }
  ): WorkspaceRecord {
    const result = this.database.sqlite
      .prepare(`
        UPDATE workspaces
        SET branch = ?, head_commit = ?, dirty = ?, status = COALESCE(?, status),
            updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `)
      .run(
        input.branch,
        input.headCommit,
        input.dirty ? 1 : 0,
        input.status ?? null,
        nowIso(input.now),
        id,
        input.expectedRevision
      );
    assertUpdated(result.changes, "Workspace", id, input.expectedRevision);
    return this.get(id);
  }
}
