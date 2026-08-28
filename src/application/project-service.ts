import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  isWithinWorkspaceAllowlist,
  loadUserConfigForPaths,
  resolveUserConfigPathForPaths
} from "../core/config.js";
import type {
  TokenPilotExecutionWorkspaceMapping,
  TokenPilotPaths,
  TokenPilotProjectRootAccess,
  TokenPilotProjectRootKind,
  TokenPilotProjectRootRole
} from "../types.js";
import type { ContinuityDatabase } from "../continuity/database.js";
import type {
  PrivateWorkspaceRecord,
  ProjectRecord,
  ProjectStatus,
  WorkspaceRecord,
  WorkspaceStatus
} from "../continuity/types.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import {
  WorkspaceConfigStore,
  type WorkspaceConfigSnapshot
} from "../workspaces/workspace-config-store.js";
import {
  inspectWorkspaceGitRoot,
  suggestedWorkspaceRepoId
} from "../workspaces/workspace-discovery.js";

function stableId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function availableIdentifier(base: string, isUsed: (candidate: string) => boolean): string {
  if (!isUsed(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, Math.max(1, 80 - suffixText.length))}${suffixText}`;
    if (!isUsed(candidate)) return candidate;
  }
  throw new ServiceError("PROJECT_IDENTIFIER_EXHAUSTED", "Could not allocate a unique project identifier");
}

function workspaceStatus(repoPath: string, allowlist: string[]): WorkspaceStatus {
  if (!isWithinWorkspaceAllowlist(repoPath, allowlist)) return "blocked";
  return fs.existsSync(repoPath) ? "ready" : "missing";
}

export interface ProjectProjection {
  project: ProjectRecord;
  workspaces: WorkspaceRecord[];
}

export interface ProjectRootProjection {
  id: string;
  projectId: string;
  kind: TokenPilotProjectRootKind;
  role: TokenPilotProjectRootRole;
  access: TokenPilotProjectRootAccess;
  status: "ready" | "missing" | "blocked";
  primary: boolean;
  pathVisibility: "hidden";
  executionWorkspaceIds: string[];
}

export interface ProjectRootPrivateProjection extends Omit<ProjectRootProjection, "pathVisibility"> {
  pathVisibility: "machine-local-owner";
  privatePath: string;
}

export interface ProjectRegistryProjectProjection extends ProjectProjection {
  roots: ProjectRootProjection[];
}

export interface ProjectRegistryProjectDetailProjection extends Omit<ProjectProjection, "workspaces"> {
  workspaces: PrivateWorkspaceRecord[];
  roots: ProjectRootPrivateProjection[];
}

export interface ProjectRegistryProjection {
  configRevision: string;
  projects: ProjectRegistryProjectProjection[];
}

export interface ProjectRegistryMutationResult extends ProjectRegistryProjectProjection {
  configRevision: string;
}

export class ProjectService {
  private readonly git: GitService;
  private readonly configStore: WorkspaceConfigStore;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly database: ContinuityDatabase,
    private readonly repositories: ContinuityRepositories
  ) {
    this.git = new GitService(paths);
    this.configStore = new WorkspaceConfigStore({
      configPath: resolveUserConfigPathForPaths(paths)
    });
  }

  list(context: OperationContext, status?: ProjectStatus): ProjectProjection[] {
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

  registry(context: OperationContext, status?: ProjectStatus): ProjectRegistryProjection {
    this.syncConfiguredProjects(context);
    const snapshot = this.configStore.snapshot();
    return {
      configRevision: snapshot.revision,
      projects: this.repositories.projects.list(status).map((project) =>
        this.registryProjection(project, snapshot)
      )
    };
  }

  registryProject(
    context: OperationContext,
    projectId: string
  ): ProjectRegistryProjectDetailProjection {
    this.syncConfiguredProjects(context);
    const snapshot = this.configStore.snapshot();
    return this.registryDetailProjection(this.repositories.projects.get(projectId), snapshot);
  }

  configRevision(): string {
    return this.configStore.snapshot().revision;
  }

  initializeRegistry(context: OperationContext): ProjectRegistryProjection {
    const snapshot = this.configStore.initializeEmptyIfMissing();
    if (Object.keys(snapshot.projects).length === 0) {
      return { configRevision: snapshot.revision, projects: [] };
    }
    this.syncConfiguredProjects(context);
    return {
      configRevision: snapshot.revision,
      projects: this.repositories.projects.list("active").map((project) =>
        this.registryProjection(project, snapshot)
      )
    };
  }

  createProject(context: OperationContext, input: {
    slug?: string;
    displayName: string;
    rootPath: string;
    kind?: TokenPilotProjectRootKind;
    role?: TokenPilotProjectRootRole;
    access?: TokenPilotProjectRootAccess;
    repoId?: string;
    expectedConfigRevision: string;
  }): ProjectRegistryMutationResult {
    const snapshot = this.configStore.snapshot();
    const explicitSlug = input.slug?.trim() || null;
    if (explicitSlug && snapshot.projects[explicitSlug]) {
      throw new ServiceError("PROJECT_SLUG_CONFLICT", "Project slug is already in use");
    }

    const kind = input.kind ?? (inspectWorkspaceGitRoot(input.rootPath) ? "git-repository" : "directory");
    this.assertRoot(input.rootPath, kind);
    if (kind === "directory" && input.repoId) {
      throw new ServiceError(
        "PROJECT_ROOT_WORKSPACE_KIND_INVALID",
        "Directory ProjectRoots cannot declare a checkout Workspace repository id"
      );
    }

    const projectSlugSource = explicitSlug ?? input.displayName.trim();
    const projectSlugBase = suggestedWorkspaceRepoId(
      projectSlugSource || path.basename(input.rootPath)
    );
    const projectSlug = explicitSlug ?? availableIdentifier(
      projectSlugBase,
      (candidate) => Boolean(snapshot.projects[candidate])
    );
    const repoId = kind === "git-repository"
      ? input.repoId?.trim() || availableIdentifier(
          suggestedWorkspaceRepoId(path.basename(input.rootPath)),
          (candidate) => Boolean(snapshot.executionWorkspaces[candidate])
        )
      : undefined;

    const updated = this.configStore.registerProjectRoot({
      rootPath: input.rootPath,
      projectSlug,
      projectDisplayName: input.displayName,
      kind,
      role: input.role,
      access: input.access,
      repoId,
      createCheckoutWorkspace: kind === "git-repository",
      expectedRevision: input.expectedConfigRevision
    });
    this.syncConfiguredProjects(context);
    const project = this.repositories.projects.findBySlug(projectSlug);
    if (!project) {
      throw new ServiceError("PROJECT_NOT_FOUND", "Project could not be materialized");
    }
    return {
      configRevision: updated.revision,
      ...this.registryProjection(project, updated)
    };
  }

  /** @deprecated Use createProject with an explicit ProjectRoot. */
  create(context: OperationContext, input: {
    slug: string;
    displayName: string;
    repoId: string;
    path: string;
    expectedConfigRevision: string;
  }): ProjectRegistryMutationResult {
    return this.createProject(context, {
      slug: input.slug,
      displayName: input.displayName,
      rootPath: input.path,
      kind: "git-repository",
      role: "primary-source",
      access: "read-write",
      repoId: input.repoId,
      expectedConfigRevision: input.expectedConfigRevision
    });
  }

  attachRoot(context: OperationContext, input: {
    projectId: string;
    rootPath: string;
    kind: TokenPilotProjectRootKind;
    role?: TokenPilotProjectRootRole;
    access?: TokenPilotProjectRootAccess;
    repoId?: string;
    expectedConfigRevision: string;
  }): ProjectRegistryMutationResult {
    this.syncConfiguredProjects(context);
    const project = this.repositories.projects.get(input.projectId);
    const snapshot = this.configStore.snapshot();
    this.assertRoot(input.rootPath, input.kind);
    const repoId = input.kind === "git-repository"
      ? input.repoId?.trim() || availableIdentifier(
          suggestedWorkspaceRepoId(path.basename(input.rootPath)),
          (candidate) => Boolean(snapshot.executionWorkspaces[candidate])
        )
      : undefined;
    const updated = this.configStore.registerProjectRoot({
      rootPath: input.rootPath,
      projectSlug: project.slug,
      kind: input.kind,
      role: input.role,
      access: input.access,
      repoId,
      createCheckoutWorkspace: input.kind === "git-repository",
      expectedRevision: input.expectedConfigRevision
    });
    this.syncConfiguredProjects(context);
    return {
      configRevision: updated.revision,
      ...this.registryProjection(this.repositories.projects.get(project.id), updated)
    };
  }

  /** @deprecated Use attachRoot with kind=git-repository. */
  attachWorkspace(context: OperationContext, input: {
    projectId: string;
    repoId: string;
    path: string;
    expectedConfigRevision: string;
  }): ProjectRegistryMutationResult {
    return this.attachRoot(context, {
      projectId: input.projectId,
      rootPath: input.path,
      kind: "git-repository",
      role: "supporting-source",
      access: "read-write",
      repoId: input.repoId,
      expectedConfigRevision: input.expectedConfigRevision
    });
  }

  rename(context: OperationContext, input: {
    projectId: string;
    displayName: string;
    expectedConfigRevision: string;
  }): ProjectRegistryMutationResult {
    this.syncConfiguredProjects(context);
    const project = this.repositories.projects.get(input.projectId);
    const updated = this.configStore.renameProject({
      projectSlug: project.slug,
      displayName: input.displayName,
      expectedRevision: input.expectedConfigRevision
    });
    this.syncConfiguredProjects(context);
    return {
      configRevision: updated.revision,
      ...this.registryProjection(this.repositories.projects.get(project.id), updated)
    };
  }

  makePrimaryRoot(context: OperationContext, input: {
    projectId: string;
    rootId: string;
    expectedConfigRevision: string;
  }): ProjectRegistryMutationResult {
    this.syncConfiguredProjects(context);
    const project = this.repositories.projects.get(input.projectId);
    const updated = this.configStore.setPrimaryRoot({
      projectSlug: project.slug,
      rootId: input.rootId,
      expectedRevision: input.expectedConfigRevision
    });
    this.syncConfiguredProjects(context);
    return {
      configRevision: updated.revision,
      ...this.registryProjection(this.repositories.projects.get(project.id), updated)
    };
  }

  /** @deprecated Use makePrimaryRoot. */
  makePrimaryWorkspace(context: OperationContext, input: {
    projectId: string;
    workspaceId: string;
    expectedConfigRevision: string;
  }): ProjectRegistryMutationResult {
    this.syncConfiguredProjects(context);
    const project = this.repositories.projects.get(input.projectId);
    const workspace = this.repositories.workspaces.getPrivate(input.workspaceId);
    if (workspace.projectId !== project.id) {
      throw new ServiceError(
        "PROJECT_WORKSPACE_NOT_ATTACHED",
        "Workspace does not belong to the selected Project"
      );
    }
    const snapshot = this.configStore.snapshot();
    const configuredWorkspace = snapshot.executionWorkspaces[workspace.repoId];
    if (!configuredWorkspace) {
      throw new ServiceError(
        "PROJECT_WORKSPACE_NOT_ATTACHED",
        "Workspace is no longer registered in the selected Project"
      );
    }
    return this.makePrimaryRoot(context, {
      projectId: project.id,
      rootId: configuredWorkspace.projectRootId,
      expectedConfigRevision: input.expectedConfigRevision
    });
  }

  private assertRoot(rootPath: string, kind: TokenPilotProjectRootKind): void {
    if (kind === "git-repository") {
      if (!inspectWorkspaceGitRoot(rootPath)) {
        throw new ServiceError(
          "WORKSPACE_GIT_ROOT_REQUIRED",
          "Git ProjectRoot path must be the top-level directory of a Git repository"
        );
      }
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(rootPath);
    } catch (error) {
      throw new ServiceError("PROJECT_ROOT_NOT_FOUND", "Project root must exist", { cause: error });
    }
    if (!stat.isDirectory()) {
      throw new ServiceError("PROJECT_ROOT_NOT_FOUND", "Project root must be a directory");
    }
  }

  private projectRootEntries(
    project: ProjectRecord,
    snapshot: WorkspaceConfigSnapshot
  ): Array<{ summary: ProjectRootProjection; privatePath: string }> {
    const configured = snapshot.projects[project.slug];
    if (!configured) return [];
    const workspaces = this.repositories.workspaces.listByProject(project.id);
    const workspaceByRepoId = new Map(workspaces.map((workspace) => [workspace.repoId, workspace]));

    return configured.rootIds.map((rootId) => {
      const root = snapshot.projectRoots[rootId];
      if (!root) {
        throw new ServiceError(
          "PROJECT_ROOT_MISSING",
          "Project registry references an unknown ProjectRoot",
          { details: { projectId: project.id, rootId } }
        );
      }
      const linkedEntries = Object.entries(snapshot.executionWorkspaces).filter(
        ([, workspace]) => workspace.projectRootId === rootId
      );
      const linkedWorkspaces = linkedEntries
        .map(([repoId]) => workspaceByRepoId.get(repoId))
        .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));
      let status: ProjectRootProjection["status"] = fs.existsSync(root.path) ? "ready" : "missing";
      if (
        status === "ready" &&
        linkedEntries.some(([, workspace]) =>
          !isWithinWorkspaceAllowlist(workspace.path, snapshot.workspaceAllowlist)
        )
      ) {
        status = "blocked";
      }
      return {
        summary: {
          id: rootId,
          projectId: project.id,
          kind: root.kind,
          role: root.role,
          access: root.access,
          status,
          primary: rootId === configured.primaryRootId,
          pathVisibility: "hidden",
          executionWorkspaceIds: linkedWorkspaces.map((workspace) => workspace.id).sort()
        },
        privatePath: root.path
      };
    });
  }

  private registryProjection(
    project: ProjectRecord,
    snapshot: WorkspaceConfigSnapshot
  ): ProjectRegistryProjectProjection {
    return {
      project,
      workspaces: this.repositories.workspaces.listByProject(project.id),
      roots: this.projectRootEntries(project, snapshot).map((entry) => entry.summary)
    };
  }

  private registryDetailProjection(
    project: ProjectRecord,
    snapshot: WorkspaceConfigSnapshot
  ): ProjectRegistryProjectDetailProjection {
    return {
      project,
      workspaces: this.repositories.workspaces
        .listByProject(project.id)
        .map((workspace) => this.repositories.workspaces.getPrivate(workspace.id)),
      roots: this.projectRootEntries(project, snapshot).map((entry) => ({
        ...entry.summary,
        pathVisibility: "machine-local-owner" as const,
        privatePath: entry.privatePath
      }))
    };
  }

  private syncConfiguredProjects(context: OperationContext): void {
    const config = loadUserConfigForPaths(this.paths);
    this.database.transaction(() => {
      for (const [projectSlug, configuredProject] of Object.entries(config.projects).sort(
        ([left], [right]) => left.localeCompare(right)
      )) {
        let project = this.repositories.projects.findBySlug(projectSlug);
        if (!project) {
          project = this.repositories.projects.create({
            id: stableId("project", projectSlug),
            slug: projectSlug,
            displayName: configuredProject.displayName,
            status: "active"
          });
        } else if (project.displayName !== configuredProject.displayName) {
          project = this.repositories.projects.rename(
            project.id,
            configuredProject.displayName,
            project.revision,
            context.now
          );
        }

        const workspaceByRepoId = new Map<string, WorkspaceRecord>();
        const configuredWorkspaces = Object.entries(config.executionWorkspaces)
          .filter(([, workspace]) => configuredProject.rootIds.includes(workspace.projectRootId))
          .sort(([left], [right]) => left.localeCompare(right));

        for (const [repoId, configuredWorkspace] of configuredWorkspaces) {
          const status = workspaceStatus(configuredWorkspace.path, config.workspaceAllowlist);
          let workspace = this.repositories.workspaces.findPrivateByRepoId(repoId);
          if (workspace && workspace.projectId !== project.id) {
            throw new ServiceError(
              "PROJECT_WORKSPACE_REPARENT_REQUIRED",
              "Workspace is already materialized under another Project and requires an explicit governed reparent operation",
              {
                details: {
                  workspaceId: workspace.id,
                  repoId,
                  currentProjectId: workspace.projectId,
                  targetProjectId: project.id
                }
              }
            );
          }
          if (!workspace) {
            workspace = this.repositories.workspaces.create({
              id: stableId("workspace", repoId),
              projectId: project.id,
              repoId,
              privatePath: configuredWorkspace.path,
              kind: configuredWorkspace.kind,
              status
            });
          } else if (
            workspace.privatePath !== configuredWorkspace.path ||
            workspace.status !== status
          ) {
            workspace = this.repositories.workspaces.syncConfiguration(
              workspace.id,
              {
                privatePath: configuredWorkspace.path,
                status,
                expectedRevision: workspace.revision,
                now: context.now
              }
            );
          }
          workspaceByRepoId.set(repoId, workspace);
        }

        const workspaceCandidates = configuredWorkspaces.flatMap(([repoId, configuredWorkspace]) => {
          const workspace = workspaceByRepoId.get(repoId);
          return workspace ? [{ repoId, configuredWorkspace, workspace }] : [];
        });
        const currentDefaultWorkspaceId = project.defaultWorkspaceId;
        const currentDefaultWorkspace = currentDefaultWorkspaceId
          ? workspaceCandidates.find(
              ({ workspace }) =>
                workspace.id === currentDefaultWorkspaceId && workspace.status === "ready"
            )?.workspace ?? null
          : null;
        const fallbackWorkspace = workspaceCandidates
          .filter(({ workspace }) => workspace.status === "ready")
          .sort((left, right) => {
            const leftPrimary = left.configuredWorkspace.projectRootId === configuredProject.primaryRootId;
            const rightPrimary = right.configuredWorkspace.projectRootId === configuredProject.primaryRootId;
            if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
            if (left.configuredWorkspace.kind !== right.configuredWorkspace.kind) {
              return left.configuredWorkspace.kind === "checkout" ? -1 : 1;
            }
            return left.repoId.localeCompare(right.repoId);
          })[0]?.workspace ?? null;
        const nextDefaultWorkspaceId = currentDefaultWorkspace?.id ?? fallbackWorkspace?.id ?? null;
        if (project.defaultWorkspaceId !== nextDefaultWorkspaceId) {
          project = this.repositories.projects.setDefaultWorkspace(
            project.id,
            nextDefaultWorkspaceId,
            project.revision,
            context.now
          );
        }
      }
    });

    for (const workspace of this.repositories.workspaces.listPrivate()) {
      if (!config.repoMappings[workspace.repoId] || workspace.status !== "ready") continue;
      try {
        const status = this.git.status(context, workspace.repoId);
        const branch = status.branch || null;
        const headCommit = this.git.recentCommits(context, workspace.repoId, 1)[0]?.hash ?? null;
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
            expectedRevision: workspace.revision,
            now: context.now
          });
        }
      } catch {
        // Configuration truth remains usable even when live Git observation fails.
      }
    }
  }
}
