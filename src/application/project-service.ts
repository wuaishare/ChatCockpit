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
import { GitService } from "./git-service.js";
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
  private readonly git: GitService;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly database: ContinuityDatabase,
    private readonly repositories: ContinuityRepositories
  ) {
    this.git = new GitService(paths);
  }

  list(
    context: OperationContext,
    status?: ProjectStatus
  ): ProjectProjection[] {
    this.syncConfiguredProjects(context);
    return this.repositories.projects.list(status).map((project) => ({
      project,
      workspaces: this.repositories.workspaces.listByProject(project.id)
    }));
  }

  get(context: OperationContext, projectId: string): ProjectProjection {
    this.syncConfiguredProjects(context);
    const project = this.repositories.projects.get(projectId);
    return {
      project,
      workspaces: this.repositories.workspaces.listByProject(project.id)
    };
  }

  private syncConfiguredProjects(context: OperationContext): void {
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

    for (const workspace of this.repositories.workspaces.listPrivate()) {
      if (!config.repoMappings[workspace.repoId] || workspace.status !== "ready") {
        continue;
      }
      try {
        const status = this.git.status(context, workspace.repoId);
        const branch = status.branch || null;
        const headCommit =
          this.git.recentCommits(context, workspace.repoId, 1)[0]?.hash ?? null;
        const dirty = status.entries.length > 0;
        if (
          workspace.branch !== branch ||
          workspace.headCommit !== headCommit ||
          workspace.dirty !== dirty
        ) {
          this.repositories.workspaces.updateGitState(workspace.id, {
            branch,
            headCommit,
            dirty,
            expectedRevision: workspace.revision
          });
        }
      } catch {
        // Configuration truth remains usable even when live Git observation fails.
      }
    }
  }
}
