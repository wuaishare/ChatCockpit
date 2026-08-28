import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ServiceError } from "../application/service-error.js";
import { parseUserConfig } from "../core/user-config-schema.js";
import type { TokenPilotProjectMapping } from "../types.js";

export interface WorkspaceConfigSnapshot {
  revision: string;
  discoveryRoots: string[];
  workspaceAllowlist: string[];
  repoMappings: Record<string, { path: string }>;
  projects: Record<string, TokenPilotProjectMapping>;
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
    if (current.snapshot.discoveryRoots.includes(canonicalRoot)) {
      return current.snapshot;
    }
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

    return this.registerRepoOnCurrent(current, {
      repoPath: canonicalRepo,
      repoId: input.repoId,
      projectSlug: input.repoId,
      projectDisplayName: input.repoId
    });
  }

  registerRepo(input: {
    repoPath: string;
    repoId: string;
    projectSlug: string;
    projectDisplayName?: string;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(input.expectedRevision);
    const canonicalRepo = requireDirectory(
      input.repoPath,
      "WORKSPACE_PATH_NOT_FOUND",
      "Workspace path must be an existing directory"
    );
    return this.registerRepoOnCurrent(current, {
      repoPath: canonicalRepo,
      repoId: input.repoId,
      projectSlug: input.projectSlug,
      projectDisplayName: input.projectDisplayName
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
    if (!project) {
      throw new ServiceError("PROJECT_NOT_FOUND", "Project is not registered");
    }
    const displayName = validateProjectDisplayName(input.displayName);
    if (project.displayName === displayName) return current.snapshot;
    return this.write(current, {
      projects: {
        ...current.snapshot.projects,
        [projectSlug]: { ...project, displayName }
      }
    });
  }

  setPrimaryRepo(input: {
    projectSlug: string;
    repoId: string;
    expectedRevision: string;
  }): WorkspaceConfigSnapshot {
    const current = this.readAndAssertRevision(input.expectedRevision);
    const projectSlug = validateProjectSlug(input.projectSlug);
    const repoId = validateRepoId(input.repoId);
    const project = current.snapshot.projects[projectSlug];
    if (!project) {
      throw new ServiceError("PROJECT_NOT_FOUND", "Project is not registered");
    }
    if (!project.repoIds.includes(repoId)) {
      throw new ServiceError(
        "PROJECT_WORKSPACE_NOT_ATTACHED",
        "Workspace repository is not attached to the selected Project"
      );
    }
    if (project.primaryRepoId === repoId) return current.snapshot;
    return this.write(current, {
      projects: {
        ...current.snapshot.projects,
        [projectSlug]: { ...project, primaryRepoId: repoId }
      }
    });
  }

  private registerRepoOnCurrent(
    current: RawConfigState,
    input: {
      repoPath: string;
      repoId: string;
      projectSlug: string;
      projectDisplayName?: string;
    }
  ): WorkspaceConfigSnapshot {
    const canonicalRepo = normalizeAbsolutePath(input.repoPath);
    const duplicateRepo = Object.entries(current.snapshot.repoMappings).find(
      ([, mapping]) => normalizeAbsolutePath(mapping.path) === canonicalRepo
    );
    if (duplicateRepo) {
      throw new ServiceError(
        "WORKSPACE_ALREADY_REGISTERED",
        "Workspace checkout is already registered",
        { details: { repoId: duplicateRepo[0] } }
      );
    }

    const repoId = validateRepoId(input.repoId);
    if (current.snapshot.repoMappings[repoId]) {
      throw new ServiceError(
        "WORKSPACE_REPO_ID_CONFLICT",
        "Workspace repository id is already in use",
        { details: { repoId } }
      );
    }

    const projectSlug = validateProjectSlug(input.projectSlug);
    const existingProject = current.snapshot.projects[projectSlug];
    const project = existingProject
      ? {
          ...existingProject,
          repoIds: uniqueSorted([...existingProject.repoIds, repoId])
        }
      : {
          displayName: validateProjectDisplayName(input.projectDisplayName ?? projectSlug),
          primaryRepoId: repoId,
          repoIds: [repoId]
        };

    return this.write(current, {
      workspaceAllowlist: [...current.snapshot.workspaceAllowlist, canonicalRepo],
      repoMappings: {
        ...current.snapshot.repoMappings,
        [repoId]: { path: canonicalRepo }
      },
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
          details: {
            expectedRevision,
            actualRevision: current.revision
          }
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

    let parsed;
    try {
      parsed = parseUserConfig(raw).config;
    } catch (error) {
      throw new ServiceError(
        "WORKSPACE_CONFIG_INVALID",
        "ChatCockpit workspace configuration is invalid",
        { cause: error }
      );
    }

    const discoveryRoots = uniqueSorted(
      parsed.workspaceDiscoveryRoots.map(normalizeAbsolutePath)
    );
    const workspaceAllowlist = uniqueSorted(
      parsed.workspaceAllowlist.map(normalizeAbsolutePath)
    );
    const repoMappings = Object.fromEntries(
      Object.entries(parsed.repoMappings)
        .map(([repoId, mapping]) => [repoId, { path: normalizeAbsolutePath(mapping.path) }] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    );
    const projects = Object.fromEntries(
      Object.entries(parsed.projects)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([projectSlug, project]) => [
          projectSlug,
          {
            displayName: project.displayName,
            primaryRepoId: project.primaryRepoId,
            repoIds: uniqueSorted(project.repoIds)
          }
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
        repoMappings,
        projects,
        defaultRepoId: parsed.defaultRepoId
      }
    };
  }

  private write(
    current: RawConfigState,
    update: {
      discoveryRoots?: string[];
      workspaceAllowlist?: string[];
      repoMappings?: Record<string, { path: string }>;
      projects?: Record<string, TokenPilotProjectMapping>;
    }
  ): WorkspaceConfigSnapshot {
    const raw = { ...current.raw };
    const discoveryRoots = uniqueSorted(
      (update.discoveryRoots ?? current.snapshot.discoveryRoots).map(normalizeAbsolutePath)
    );
    const workspaceAllowlist = uniqueSorted(
      (update.workspaceAllowlist ?? current.snapshot.workspaceAllowlist).map(normalizeAbsolutePath)
    );
    const repoMappings = update.repoMappings ?? current.snapshot.repoMappings;
    const projects = update.projects ?? current.snapshot.projects;

    raw.schemaVersion = 2;
    raw.defaultRepoId = current.snapshot.defaultRepoId;
    raw.workspaceDiscoveryRoots = discoveryRoots;
    raw.workspaceAllowlist = workspaceAllowlist;

    const previousMappings =
      raw.repoMappings && typeof raw.repoMappings === "object" && !Array.isArray(raw.repoMappings)
        ? (raw.repoMappings as Record<string, unknown>)
        : {};
    raw.repoMappings = Object.fromEntries(
      Object.entries(repoMappings)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([repoId, mapping]) => {
          const existing = previousMappings[repoId];
          const preserved =
            existing && typeof existing === "object" && !Array.isArray(existing)
              ? { ...(existing as Record<string, unknown>) }
              : {};
          preserved.path = normalizeAbsolutePath(mapping.path);
          return [repoId, preserved];
        })
    );

    const previousProjects =
      raw.projects && typeof raw.projects === "object" && !Array.isArray(raw.projects)
        ? (raw.projects as Record<string, unknown>)
        : {};
    raw.projects = Object.fromEntries(
      Object.entries(projects)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([projectSlug, project]) => {
          const existing = previousProjects[projectSlug];
          const preserved =
            existing && typeof existing === "object" && !Array.isArray(existing)
              ? { ...(existing as Record<string, unknown>) }
              : {};
          preserved.displayName = project.displayName.trim();
          preserved.primaryRepoId = project.primaryRepoId;
          preserved.repoIds = uniqueSorted(project.repoIds);
          return [projectSlug, preserved];
        })
    );

    const serialized = `${JSON.stringify(raw, null, 2)}\n`;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const tempPath = path.join(
      path.dirname(this.configPath),
      `.${path.basename(this.configPath)}.${process.pid}.${randomUUID()}.tmp`
    );
    try {
      fs.writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempPath, this.configPath);
      if (process.platform !== "win32") {
        fs.chmodSync(this.configPath, 0o600);
      }
    } finally {
      fs.rmSync(tempPath, { force: true });
    }

    return this.read().snapshot;
  }
}
