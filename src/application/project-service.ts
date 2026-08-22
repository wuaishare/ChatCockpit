import { createHash } from "node:crypto";
import fs from "node:fs";

import {
  isWithinWorkspaceAllowlist,
  loadUserConfigForPaths
} from "../core/config.js";
import type { TokenPilotPaths } from "../types.js";
import type { ContinuityDatabase } from "../continuity/database.js";
import type {
  ProjectRecord,
  ProjectStatus,
  WorkspaceRecord,
  WorkspaceStatus
} from "../continuity/types.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { OperationContext } from "./operation-context.js";

function stableId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function workspaceStatus(
  repoPath: string,
  allowlist: string[]
): WorkspaceStatus {
  if (!isWithinWorkspaceAllowlist(repoPath, allowlist)) {
    return "blocked";
  }
  return fs.existsSync(repoPath) ? "ready" : "missing";
}

export interface ProjectProjection {
  project: ProjectRecord;
  workspaces: WorkspaceRecord[];
}

export class ProjectService {
  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly database: ContinuityDatabase,
    private readonly repositories: ContinuityRepositories
  ) {}

  list(
    _context: OperationContext,
    status?: ProjectStatus
  ): ProjectProjection[] {
    this.syncConfiguredProjects();
    return this.repositories.projects.list(status).map((project) => ({
      project,
      workspaces: this.repositories.workspaces.listByProject(project.id)
    }));
  }

  get(_context: OperationContext, projectId: string): ProjectProjection {
    this.syncConfiguredProjects();
    const project = this.repositories.projects.get(projectId);
    return {
      project,
      workspaces: this.repositories.workspaces.listByProject(project.id)
    };
  }

  private syncConfiguredProjects(): void {
    const config = loadUserConfigForPaths(this.paths);
    this.database.transaction(() => {
      for (const [repoId, mapping] of Object.entries(config.repoMappings).sort(
        ([left], [right]) => left.localeCompare(right)
      )) {
        let project = this.repositories.projects.findBySlug(repoId);
        if (!project) {
          project = this.repositories.projects.create({
            id: stableId("project", repoId),
            slug: repoId,
            displayName: repoId,
            status: "active"
          });
        }

        const status = workspaceStatus(mapping.path, config.workspaceAllowlist);
        let workspace = this.repositories.workspaces.findPrivateByProjectRepo(
          project.id,
          repoId
        );
        if (!workspace) {
          workspace = this.repositories.workspaces.create({
            id: stableId("workspace", repoId),
            projectId: project.id,
            repoId,
            privatePath: mapping.path,
            kind: "checkout",
            status
          });
        } else if (
          workspace.privatePath !== mapping.path ||
          workspace.status !== status
        ) {
          workspace = this.repositories.workspaces.syncConfiguration(
            workspace.id,
            {
              privatePath: mapping.path,
              status,
              expectedRevision: workspace.revision
            }
          );
        }

        if (!project.defaultWorkspaceId) {
          project = this.repositories.projects.setDefaultWorkspace(
            project.id,
            workspace.id,
            project.revision
          );
        }
      }
    });
  }
}
