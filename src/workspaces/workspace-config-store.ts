import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ServiceError } from "../application/service-error.js";
import {
  rootIdForRepoId,
  stableProjectConfigId
} from "../core/project-config-identity.js";
import {
  parseUserConfig,
  serializeUserConfigV3
} from "../core/user-config-schema.js";
import type {
  TokenPilotExecutionWorkspaceMapping,
  TokenPilotProjectMapping,
  TokenPilotProjectRootAccess,
  TokenPilotProjectRootKind,
  TokenPilotProjectRootMapping,
  TokenPilotProjectRootRole,
  TokenPilotUserConfig
} from "../types.js";

export interface WorkspaceConfigSnapshot {
  revision: string;
  discoveryRoots: string[];
  workspaceAllowlist: string[];
  projects: Record<string, TokenPilotProjectMapping>;
  projectRoots: Record<string, TokenPilotProjectRootMapping>;
  executionWorkspaces: Record<string, TokenPilotExecutionWorkspaceMapping>;
  /** @deprecated Compatibility projection for existing repoId consumers. */
  repoMappings: Record<string, { path: string }>;
  /** @deprecated Compatibility projection for existing repoId consumers. */
  defaultRepoId: string;
}

export interface WorkspaceConfigStoreOptions {
  configPath: string;
}

function normalizeAbsolutePath(input: string): string {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) return resolved;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function hashBytes(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function requireDirectory(input: string, code: string, message: string): string {
  const normalized = normalizeAbsolutePath(input);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch (error) {
    throw new ServiceError(code, message, { cause: error });
  }
  if (!stat.isDirectory()) {
    throw new ServiceError(code, message);
  }
  return normalized;
}

function validateRepoId(repoId: string): string {
  const normalized = repoId.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) {
    throw new ServiceError(
      "WORKSPACE_REPO_ID_INVALID",
      "Workspace repository id must use lowercase letters, numbers, dot, underscore, or hyphen"
    );
  }
  return normalized;
}

function validateProjectSlug(projectSlug: string): string {
  const normalized = projectSlug.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) {
    throw new ServiceError(
      "PROJECT_SLUG_INVALID",
      "Project slug must use lowercase letters, numbers, dot, underscore, or hyphen"
    );
  }
  return normalized;
}

function validateProjectDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized || normalized.length > 240) {
    throw new ServiceError(
      "PROJECT_DISPLAY_NAME_INVALID",
      "Project display name must contain between 1 and 240 characters"
    );
  }
  return normalized;
}

interface RawConfigState {
  source: string;
  raw: Record<string, unknown>;
  revision: string;
  snapshot: WorkspaceConfigSnapshot;
}

export class WorkspaceConfigStore {
  private readonly configPath: string;

  constructor(options: WorkspaceConfigStoreOptions) {
    this.configPath = options.configPath;
  }

  snapshot(): WorkspaceConfigSnapshot {
    return this.read().snapshot;
  }

  addDiscoveryRoot(root: string, expectedRevision: string): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(
      expectedRevision,
      "WORKSPACE_DISCOVERY_REVISION_CONFLICT"
    );
    const canonicalRoot = requireDirectory(
      root,
      "WORKSPACE_DISCOVERY_ROOT_NOT_FOUND",
      "Workspace discovery root must be an existing directory"
    );
    if (current.snapshot.discoveryRoots.includes(canonicalRoot)) return current.snapshot;
    return this.write(current, {
      discoveryRoots: [...current.snapshot.discoveryRoots, canonicalRoot]
    });
  }

  removeDiscoveryRoot(root: string, expectedRevision: string): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(
      expectedRevision,
      "WORKSPACE_DISCOVERY_REVISION_CONFLICT"
    );
    const canonicalRoot = normalizeAbsolutePath(root);
    if (!current.snapshot.discoveryRoots.includes(canonicalRoot)) {
      throw new ServiceError(
        "WORKSPACE_DISCOVERY_ROOT_NOT_FOUND",
        "Workspace discovery root is not configured"
      );
    }
    return this.write(current, {
      discoveryRoots: current.snapshot.discoveryRoots.filter((entry) => entry !== canonicalRoot)
    });
  }

  importRepo(input: {
    root: string;
    repoPath: string;
    repoId: string;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(
      input.expectedRevision,
      "WORKSPACE_DISCOVERY_REVISION_CONFLICT"
    );
    const canonicalRoot = requireDirectory(
      input.root,
      "WORKSPACE_DISCOVERY_ROOT_NOT_FOUND",
      "Workspace discovery root must be an existing directory"
    );
    if (!current.snapshot.discoveryRoots.includes(canonicalRoot)) {
      throw new ServiceError(
        "WORKSPACE_DISCOVERY_ROOT_INVALID",
        "Workspace discovery root is not configured"
      );
    }

    const canonicalRepo = requireDirectory(
      input.repoPath,
      "WORKSPACE_DISCOVERY_CANDIDATE_STALE",
      "Workspace candidate directory no longer exists"
    );
    if (path.dirname(canonicalRepo) !== canonicalRoot) {
      throw new ServiceError(
        "WORKSPACE_DISCOVERY_CANDIDATE_STALE",
        "Workspace candidate must remain a direct child of its discovery root"
      );
    }

    return this.registerProjectRootOnCurrent(current, {
      rootPath: canonicalRepo,
      projectSlug: input.repoId,
      projectDisplayName: input.repoId,
      kind: "git-repository",
      role: "primary-source",
      access: "read-write",
      repoId: input.repoId,
      createCheckoutWorkspace: true
    });
  }

  registerProjectRoot(input: {
    rootPath: string;
    projectSlug: string;
    projectDisplayName?: string;
    kind: TokenPilotProjectRootKind;
    role?: TokenPilotProjectRootRole;
    access?: TokenPilotProjectRootAccess;
    repoId?: string;
    createCheckoutWorkspace?: boolean;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(input.expectedRevision);
    const canonicalRoot = requireDirectory(
      input.rootPath,
      "PROJECT_ROOT_NOT_FOUND",
      "Project root must be an existing directory"
    );
    return this.registerProjectRootOnCurrent(current, {
      ...input,
      rootPath: canonicalRoot
    });
  }

  /** @deprecated Use registerProjectRoot. */
  registerRepo(input: {
    repoPath: string;
    repoId: string;
    projectSlug: string;
    projectDisplayName?: string;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    return this.registerProjectRoot({
      rootPath: input.repoPath,
      repoId: input.repoId,
      projectSlug: input.projectSlug,
      projectDisplayName: input.projectDisplayName,
      kind: "git-repository",
      createCheckoutWorkspace: true,
      expectedRevision: input.expectedRevision
    });
  }

  renameProject(input: {
    projectSlug: string;
    displayName: string;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(input.expectedRevision);
    const projectSlug = validateProjectSlug(input.projectSlug);
    const project = current.snapshot.projects[projectSlug];
    if (!project) throw new ServiceError("PROJECT_NOT_FOUND", "Project is not registered");
    const displayName = validateProjectDisplayName(input.displayName);
    if (project.displayName === displayName) return current.snapshot;
    return this.write(current, {
      projects: {
        ...current.snapshot.projects,
        [projectSlug]: { ...project, displayName }
      }
    });
  }

  setPrimaryRoot(input: {
    projectSlug: string;
    rootId: string;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(input.expectedRevision);
    return this.setPrimaryRootOnCurrent(current, input.projectSlug, input.rootId);
  }

  /** @deprecated Use setPrimaryRoot. */
  setPrimaryRepo(input: {
    projectSlug: string;
    repoId: string;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(input.expectedRevision);
    const repoId = validateRepoId(input.repoId);
    const workspace = current.snapshot.executionWorkspaces[repoId];
    if (!workspace) {
      throw new ServiceError(
        "PROJECT_WORKSPACE_NOT_ATTACHED",
        "Workspace repository is not attached to the selected Project"
      );
    }
    return this.setPrimaryRootOnCurrent(current, input.projectSlug, workspace.projectRootId);
  }

  private setPrimaryRootOnCurrent(
    current: RawConfigState,
    projectSlugInput: string,
    rootId: string
  ): WorkspaceConfigSnapshot {
    const projectSlug = validateProjectSlug(projectSlugInput);
    const project = current.snapshot.projects[projectSlug];
    if (!project) throw new ServiceError("PROJECT_NOT_FOUND", "Project is not registered");
    if (!project.rootIds.includes(rootId)) {
      throw new ServiceError(
        "PROJECT_ROOT_NOT_ATTACHED",
        "ProjectRoot does not belong to the selected Project"
      );
    }
    if (project.primaryRootId === rootId) return current.snapshot;
    return this.write(current, {
      projects: {
        ...current.snapshot.projects,
        [projectSlug]: { ...project, primaryRootId: rootId }
      }
    });
  }

  private registerProjectRootOnCurrent(
    current: RawConfigState,
    input: {
      rootPath: string;
      projectSlug: string;
      projectDisplayName?: string;
      kind: TokenPilotProjectRootKind;
      role?: TokenPilotProjectRootRole;
      access?: TokenPilotProjectRootAccess;
      repoId?: string;
      createCheckoutWorkspace?: boolean;
    }
  ): WorkspaceConfigSnapshot {
    const canonicalRoot = normalizeAbsolutePath(input.rootPath);
    const duplicateRoot = Object.entries(current.snapshot.projectRoots).find(
      ([, root]) => normalizeAbsolutePath(root.path) === canonicalRoot
    );
    if (duplicateRoot) {
      throw new ServiceError(
        "PROJECT_ROOT_PATH_CONFLICT",
        "Project root is already registered",
        { details: { rootId: duplicateRoot[0] } }
      );
    }

    const projectSlug = validateProjectSlug(input.projectSlug);
    const existingProject = current.snapshot.projects[projectSlug];
    const wantsWorkspace = input.createCheckoutWorkspace === true;
    let repoId: string | undefined;
    if (wantsWorkspace) {
      if (input.kind !== "git-repository") {
        throw new ServiceError(
          "PROJECT_ROOT_WORKSPACE_KIND_INVALID",
          "Only git-repository ProjectRoots can create checkout Workspaces"
        );
      }
      if (!input.repoId) {
        throw new ServiceError(
          "WORKSPACE_REPO_ID_INVALID",
          "Git ProjectRoot checkout registration requires a workspace repository id"
        );
      }
      repoId = validateRepoId(input.repoId);
      if (current.snapshot.executionWorkspaces[repoId]) {
        throw new ServiceError(
          "WORKSPACE_REPO_ID_CONFLICT",
          "Workspace repository id is already in use",
          { details: { repoId } }
        );
      }
    }

    const rootId = repoId
      ? rootIdForRepoId(repoId)
      : stableProjectConfigId("root", canonicalRoot);
    if (current.snapshot.projectRoots[rootId]) {
      throw new ServiceError(
        "PROJECT_ROOT_ID_CONFLICT",
        "Project root identity is already in use",
        { details: { rootId } }
      );
    }

    const role = input.role ?? (
      existingProject
        ? input.kind === "git-repository" ? "supporting-source" : "documentation"
        : input.kind === "git-repository" ? "primary-source" : "documentation"
    );
    const root: TokenPilotProjectRootMapping = {
      path: canonicalRoot,
      kind: input.kind,
      role,
      access: input.access ?? "read-write"
    };
    const project: TokenPilotProjectMapping = existingProject
      ? {
          ...existingProject,
          rootIds: uniqueSorted([...existingProject.rootIds, rootId])
        }
      : {
          displayName: validateProjectDisplayName(input.projectDisplayName ?? projectSlug),
          primaryRootId: rootId,
          rootIds: [rootId]
        };

    const executionWorkspaces = { ...current.snapshot.executionWorkspaces };
    let workspaceAllowlist = [...current.snapshot.workspaceAllowlist];
    if (wantsWorkspace && repoId) {
      executionWorkspaces[repoId] = {
        projectRootId: rootId,
        path: canonicalRoot,
        kind: "checkout",
        provenance: "registered"
      };
      workspaceAllowlist = [...workspaceAllowlist, canonicalRoot];
    }

    return this.write(current, {
      workspaceAllowlist,
      projectRoots: {
        ...current.snapshot.projectRoots,
        [rootId]: root
      },
      executionWorkspaces,
      projects: {
        ...current.snapshot.projects,
        [projectSlug]: project
      }
    });
  }

  private readAndAssertRevision(
    expectedRevision: string,
    conflictCode = "WORKSPACE_CONFIG_REVISION_CONFLICT"
  ): RawConfigState {
    const current = this.read();
    if (current.revision !== expectedRevision) {
      throw new ServiceError(
        conflictCode,
        "Workspace configuration changed before it could be updated",
        {
          details: { expectedRevision, actualRevision: current.revision }
        }
      );
    }
    return current;
  }

  private read(): RawConfigState {
    let source: string;
    try {
      source = fs.readFileSync(this.configPath, "utf8");
    } catch (error) {
      throw new ServiceError(
        "WORKSPACE_CONFIG_NOT_FOUND",
        "ChatCockpit workspace configuration is unavailable",
        { cause: error }
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(source) as unknown;
    } catch (error) {
      throw new ServiceError(
        "WORKSPACE_CONFIG_INVALID",
        "ChatCockpit workspace configuration is invalid JSON",
        { cause: error }
      );
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ServiceError(
        "WORKSPACE_CONFIG_INVALID",
        "ChatCockpit workspace configuration must be a JSON object"
      );
    }

    let parsed: TokenPilotUserConfig;
    try {
      parsed = parseUserConfig(raw).config;
    } catch (error) {
      throw new ServiceError(
        "WORKSPACE_CONFIG_INVALID",
        "ChatCockpit workspace configuration is invalid",
        { cause: error }
      );
    }

    const discoveryRoots = uniqueSorted(parsed.workspaceDiscoveryRoots.map(normalizeAbsolutePath));
    const workspaceAllowlist = uniqueSorted(parsed.workspaceAllowlist.map(normalizeAbsolutePath));
    const projectRoots = Object.fromEntries(
      Object.entries(parsed.projectRoots)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([rootId, root]) => [rootId, { ...root, path: normalizeAbsolutePath(root.path) }])
    );
    const executionWorkspaces = Object.fromEntries(
      Object.entries(parsed.executionWorkspaces)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([repoId, workspace]) => [
          repoId,
          { ...workspace, path: normalizeAbsolutePath(workspace.path) }
        ])
    );
    const repoMappings = Object.fromEntries(
      Object.entries(executionWorkspaces).map(([repoId, workspace]) => [
        repoId,
        { path: workspace.path }
      ])
    );

    return {
      source,
      raw: raw as Record<string, unknown>,
      revision: hashBytes(source),
      snapshot: {
        revision: hashBytes(source),
        discoveryRoots,
        workspaceAllowlist,
        projects: parsed.projects,
        projectRoots,
        executionWorkspaces,
        repoMappings,
        defaultRepoId: parsed.defaultRepoId
      }
    };
  }

  private write(
    current: RawConfigState,
    update: {
      discoveryRoots?: string[];
      workspaceAllowlist?: string[];
      projects?: Record<string, TokenPilotProjectMapping>;
      projectRoots?: Record<string, TokenPilotProjectRootMapping>;
      executionWorkspaces?: Record<string, TokenPilotExecutionWorkspaceMapping>;
    }
  ): WorkspaceConfigSnapshot {
    const discoveryRoots = uniqueSorted(
      (update.discoveryRoots ?? current.snapshot.discoveryRoots).map(normalizeAbsolutePath)
    );
    const workspaceAllowlist = uniqueSorted(
      (update.workspaceAllowlist ?? current.snapshot.workspaceAllowlist).map(normalizeAbsolutePath)
    );
    const projects = update.projects ?? current.snapshot.projects;
    const projectRoots = Object.fromEntries(
      Object.entries(update.projectRoots ?? current.snapshot.projectRoots).map(([rootId, root]) => [
        rootId,
        { ...root, path: normalizeAbsolutePath(root.path) }
      ])
    );
    const executionWorkspaces = Object.fromEntries(
      Object.entries(update.executionWorkspaces ?? current.snapshot.executionWorkspaces).map(
        ([repoId, workspace]) => [
          repoId,
          { ...workspace, path: normalizeAbsolutePath(workspace.path) }
        ]
      )
    );
    const repoMappings = Object.fromEntries(
      Object.entries(executionWorkspaces).map(([repoId, workspace]) => [
        repoId,
        { path: workspace.path }
      ])
    );
    const defaultRepoId = executionWorkspaces[current.snapshot.defaultRepoId]
      ? current.snapshot.defaultRepoId
      : Object.keys(executionWorkspaces).sort((left, right) => left.localeCompare(right))[0] ?? current.snapshot.defaultRepoId;

    const config: TokenPilotUserConfig = {
      schemaVersion: 3,
      workspaceDiscoveryRoots: discoveryRoots,
      workspaceAllowlist,
      projects,
      projectRoots,
      executionWorkspaces,
      repoMappings,
      defaultRepoId
    };
    const raw = serializeUserConfigV3(config, { existingRaw: current.raw });
    const serialized = `${JSON.stringify(raw, null, 2)}\n`;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const tempPath = path.join(
      path.dirname(this.configPath),
      `.${path.basename(this.configPath)}.${process.pid}.${randomUUID()}.tmp`
    );
    try {
      fs.writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempPath, this.configPath);
      if (process.platform !== "win32") fs.chmodSync(this.configPath, 0o600);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }

    return this.read().snapshot;
  }
}
