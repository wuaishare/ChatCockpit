import { z } from "zod";

import { rootIdForRepoId } from "./project-config-identity.js";
import type {
  TokenPilotExecutionWorkspaceMapping,
  TokenPilotProjectMapping,
  TokenPilotProjectRootMapping,
  TokenPilotRepoMapping,
  TokenPilotUserConfig
} from "../types.js";

export const USER_CONFIG_SCHEMA_VERSION = 3 as const;
export const LEGACY_DEFAULT_REPO_ID = "tokenpilot" as const;
export const CHATCOCKPIT_TARGET_DEFAULT_REPO_ID = "primary" as const;

const mappingSchema = z.object({
  path: z.string().min(1)
});

const legacyProjectMappingSchema = z.object({
  displayName: z.string().min(1).max(240),
  primaryRepoId: z.string().min(1).max(80),
  repoIds: z.array(z.string().min(1).max(80)).min(1).max(128)
});

const projectMappingSchema = z.object({
  displayName: z.string().min(1).max(240),
  primaryRootId: z.string().min(1).max(160),
  rootIds: z.array(z.string().min(1).max(160)).min(1).max(256)
});

const projectRootMappingSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["git-repository", "directory"]),
  role: z.enum([
    "primary-source",
    "supporting-source",
    "documentation",
    "knowledge",
    "assets"
  ]),
  access: z.enum(["read-write", "read-only"])
});

const executionWorkspaceMappingSchema = z.object({
  projectRootId: z.string().min(1).max(160),
  path: z.string().min(1),
  kind: z.enum(["checkout", "worktree"]),
  provenance: z.enum(["registered", "chatcockpit-created"])
});

const discoverySchema = z.object({
  workspaceDiscoveryRoots: z.array(z.string()).default([]),
  workspaceAllowlist: z.array(z.string()).default([])
});

const legacyCommonSchema = discoverySchema.extend({
  repoMappings: z.record(z.string(), mappingSchema).default({})
});

const v1Schema = legacyCommonSchema.extend({
  schemaVersion: z.literal(1),
  defaultRepoId: z.string().min(1)
});

const v2Schema = legacyCommonSchema.extend({
  schemaVersion: z.literal(2),
  defaultRepoId: z.string().min(1),
  projects: z.record(z.string(), legacyProjectMappingSchema)
});

const v3Schema = discoverySchema.extend({
  schemaVersion: z.literal(USER_CONFIG_SCHEMA_VERSION),
  projects: z.record(z.string(), projectMappingSchema),
  projectRoots: z.record(z.string(), projectRootMappingSchema),
  executionWorkspaces: z.record(z.string(), executionWorkspaceMappingSchema)
});

interface LegacyProjectMapping {
  displayName: string;
  primaryRepoId: string;
  repoIds: string[];
}

interface CanonicalUserConfigV3 {
  schemaVersion: 3;
  workspaceDiscoveryRoots: string[];
  workspaceAllowlist: string[];
  projects: Record<string, TokenPilotProjectMapping>;
  projectRoots: Record<string, TokenPilotProjectRootMapping>;
  executionWorkspaces: Record<string, TokenPilotExecutionWorkspaceMapping>;
}

export interface UserConfigParseResult {
  sourceSchemaVersion: 0 | 1 | 2 | 3;
  config: TokenPilotUserConfig;
}

function hasSchemaVersion(value: unknown): value is { schemaVersion: unknown } {
  return typeof value === "object" && value !== null && "schemaVersion" in value;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function deterministicLegacyProjects(
  repoMappings: Record<string, TokenPilotRepoMapping>
): Record<string, LegacyProjectMapping> {
  return Object.fromEntries(
    Object.keys(repoMappings)
      .sort((left, right) => left.localeCompare(right))
      .map((repoId) => [
        repoId,
        {
          displayName: repoId,
          primaryRepoId: repoId,
          repoIds: [repoId]
        }
      ])
  );
}

function normalizeLegacyProjects(
  projects: Record<string, LegacyProjectMapping>
): Record<string, LegacyProjectMapping> {
  return Object.fromEntries(
    Object.entries(projects)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([projectSlug, project]) => [
        projectSlug,
        {
          displayName: project.displayName.trim(),
          primaryRepoId: project.primaryRepoId,
          repoIds: uniqueSorted(project.repoIds)
        }
      ])
  );
}

function validateLegacyRegistry(input: {
  defaultRepoId: string;
  repoMappings: Record<string, TokenPilotRepoMapping>;
  projects: Record<string, LegacyProjectMapping>;
  requireDefaultRepoMapping: boolean;
}): void {
  if (input.requireDefaultRepoMapping && !input.repoMappings[input.defaultRepoId]) {
    throw new Error(`User config defaultRepoId ${input.defaultRepoId} has no repo mapping`);
  }

  const ownerByRepoId = new Map<string, string>();
  for (const [projectSlug, project] of Object.entries(input.projects)) {
    if (!projectSlug.trim()) {
      throw new Error("User config project slug must not be empty");
    }
    if (!project.repoIds.includes(project.primaryRepoId)) {
      throw new Error(
        `User config project ${projectSlug} primaryRepoId ${project.primaryRepoId} must belong to repoIds`
      );
    }
    for (const repoId of project.repoIds) {
      if (!input.repoMappings[repoId]) {
        throw new Error(`User config project ${projectSlug} references unknown repoId ${repoId}`);
      }
      const existingOwner = ownerByRepoId.get(repoId);
      if (existingOwner && existingOwner !== projectSlug) {
        throw new Error(
          `User config repoId ${repoId} belongs to more than one project: ${existingOwner}, ${projectSlug}`
        );
      }
      ownerByRepoId.set(repoId, projectSlug);
    }
  }

  for (const repoId of Object.keys(input.repoMappings)) {
    if (!ownerByRepoId.has(repoId)) {
      throw new Error(`User config repoId ${repoId} is not assigned to a project`);
    }
  }
}

function normalizeCanonicalConfig(input: CanonicalUserConfigV3): CanonicalUserConfigV3 {
  return {
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    workspaceDiscoveryRoots: [...input.workspaceDiscoveryRoots],
    workspaceAllowlist: [...input.workspaceAllowlist],
    projects: Object.fromEntries(
      Object.entries(input.projects)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([projectSlug, project]) => [
          projectSlug,
          {
            displayName: project.displayName.trim(),
            primaryRootId: project.primaryRootId,
            rootIds: uniqueSorted(project.rootIds)
          }
        ])
    ),
    projectRoots: Object.fromEntries(
      Object.entries(input.projectRoots)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([rootId, root]) => [
          rootId,
          {
            path: root.path.trim(),
            kind: root.kind,
            role: root.role,
            access: root.access
          }
        ])
    ),
    executionWorkspaces: Object.fromEntries(
      Object.entries(input.executionWorkspaces)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([repoId, workspace]) => [
          repoId,
          {
            projectRootId: workspace.projectRootId,
            path: workspace.path.trim(),
            kind: workspace.kind,
            provenance: workspace.provenance
          }
        ])
    )
  };
}

function validateCanonicalRegistry(input: CanonicalUserConfigV3): CanonicalUserConfigV3 {
  const ownerByRootId = new Map<string, string>();

  for (const [projectSlug, project] of Object.entries(input.projects)) {
    if (!projectSlug.trim()) {
      throw new Error("User config project slug must not be empty");
    }
    if (!project.rootIds.includes(project.primaryRootId)) {
      throw new Error(
        `User config project ${projectSlug} primaryRootId ${project.primaryRootId} must belong to rootIds`
      );
    }
    for (const rootId of project.rootIds) {
      if (!input.projectRoots[rootId]) {
        throw new Error(`User config project ${projectSlug} references unknown rootId ${rootId}`);
      }
      const existingOwner = ownerByRootId.get(rootId);
      if (existingOwner && existingOwner !== projectSlug) {
        throw new Error(
          `User config ProjectRoot ${rootId} belongs to more than one project: ${existingOwner}, ${projectSlug}`
        );
      }
      ownerByRootId.set(rootId, projectSlug);
    }
  }

  for (const rootId of Object.keys(input.projectRoots)) {
    if (!ownerByRootId.has(rootId)) {
      throw new Error(`User config ProjectRoot ${rootId} is not assigned to a project`);
    }
  }

  for (const [repoId, workspace] of Object.entries(input.executionWorkspaces)) {
    if (!repoId.trim()) {
      throw new Error("User config execution workspace repoId must not be empty");
    }
    const root = input.projectRoots[workspace.projectRootId];
    if (!root) {
      throw new Error(
        `User config execution workspace ${repoId} references unknown ProjectRoot ${workspace.projectRootId}`
      );
    }
    if (root.kind !== "git-repository") {
      throw new Error(
        `User config execution workspace ${repoId} must reference a git-repository ProjectRoot`
      );
    }
    if (workspace.kind === "checkout" && workspace.path !== root.path) {
      throw new Error(
        `User config checkout workspace ${repoId} path must equal its ProjectRoot path`
      );
    }
  }

  return input;
}

function legacyToCanonical(input: {
  defaultRepoId: string;
  workspaceDiscoveryRoots: string[];
  workspaceAllowlist: string[];
  repoMappings: Record<string, TokenPilotRepoMapping>;
  projects?: Record<string, LegacyProjectMapping>;
  requireDefaultRepoMapping?: boolean;
}): { canonical: CanonicalUserConfigV3; preferredDefaultRepoId: string } {
  const projects = normalizeLegacyProjects(
    input.projects ?? deterministicLegacyProjects(input.repoMappings)
  );
  validateLegacyRegistry({
    defaultRepoId: input.defaultRepoId,
    repoMappings: input.repoMappings,
    projects,
    requireDefaultRepoMapping: input.requireDefaultRepoMapping !== false
  });

  const canonicalProjects: Record<string, TokenPilotProjectMapping> = {};
  const projectRoots: Record<string, TokenPilotProjectRootMapping> = {};
  const executionWorkspaces: Record<string, TokenPilotExecutionWorkspaceMapping> = {};

  for (const [projectSlug, project] of Object.entries(projects)) {
    canonicalProjects[projectSlug] = {
      displayName: project.displayName,
      primaryRootId: rootIdForRepoId(project.primaryRepoId),
      rootIds: uniqueSorted(project.repoIds.map(rootIdForRepoId))
    };

    for (const repoId of project.repoIds) {
      const mapping = input.repoMappings[repoId];
      if (!mapping) continue;
      const rootId = rootIdForRepoId(repoId);
      projectRoots[rootId] = {
        path: mapping.path,
        kind: "git-repository",
        role: repoId === project.primaryRepoId ? "primary-source" : "supporting-source",
        access: "read-write"
      };
      executionWorkspaces[repoId] = {
        projectRootId: rootId,
        path: mapping.path,
        kind: "checkout",
        provenance: "registered"
      };
    }
  }

  return {
    canonical: validateCanonicalRegistry(
      normalizeCanonicalConfig({
        schemaVersion: USER_CONFIG_SCHEMA_VERSION,
        workspaceDiscoveryRoots: input.workspaceDiscoveryRoots,
        workspaceAllowlist: input.workspaceAllowlist,
        projects: canonicalProjects,
        projectRoots,
        executionWorkspaces
      })
    ),
    preferredDefaultRepoId: input.defaultRepoId
  };
}

function compatibilityDefaultRepoId(
  canonical: CanonicalUserConfigV3,
  preferredDefaultRepoId?: string
): string {
  if (preferredDefaultRepoId && canonical.executionWorkspaces[preferredDefaultRepoId]) {
    return preferredDefaultRepoId;
  }
  if (canonical.executionWorkspaces[CHATCOCKPIT_TARGET_DEFAULT_REPO_ID]) {
    return CHATCOCKPIT_TARGET_DEFAULT_REPO_ID;
  }

  for (const project of Object.values(canonical.projects)) {
    const match = Object.entries(canonical.executionWorkspaces)
      .filter(([, workspace]) => workspace.projectRootId === project.primaryRootId)
      .sort(([left], [right]) => left.localeCompare(right))[0];
    if (match) return match[0];
  }

  return Object.keys(canonical.executionWorkspaces).sort((left, right) => left.localeCompare(right))[0]
    ?? preferredDefaultRepoId
    ?? LEGACY_DEFAULT_REPO_ID;
}

function withCompatibilityProjection(
  canonical: CanonicalUserConfigV3,
  preferredDefaultRepoId?: string
): TokenPilotUserConfig {
  const repoMappings = Object.fromEntries(
    Object.entries(canonical.executionWorkspaces)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([repoId, workspace]) => [repoId, { path: workspace.path }])
  );
  return {
    ...canonical,
    defaultRepoId: compatibilityDefaultRepoId(canonical, preferredDefaultRepoId),
    repoMappings
  };
}

export function parseUserConfig(raw: unknown): UserConfigParseResult {
  if (hasSchemaVersion(raw)) {
    if (raw.schemaVersion === 1) {
      const parsed = v1Schema.parse(raw);
      const migrated = legacyToCanonical(parsed);
      return {
        sourceSchemaVersion: 1,
        config: withCompatibilityProjection(migrated.canonical, migrated.preferredDefaultRepoId)
      };
    }
    if (raw.schemaVersion === 2) {
      const parsed = v2Schema.parse(raw);
      const migrated = legacyToCanonical(parsed);
      return {
        sourceSchemaVersion: 2,
        config: withCompatibilityProjection(migrated.canonical, migrated.preferredDefaultRepoId)
      };
    }
    if (raw.schemaVersion === USER_CONFIG_SCHEMA_VERSION) {
      const parsed = v3Schema.parse(raw);
      const canonical = validateCanonicalRegistry(normalizeCanonicalConfig(parsed));
      return {
        sourceSchemaVersion: 3,
        config: withCompatibilityProjection(canonical)
      };
    }
    throw new Error(`User config schemaVersion ${String(raw.schemaVersion)} is unsupported`);
  }

  const legacy = legacyCommonSchema.parse(raw);
  const migrated = legacyToCanonical({
    defaultRepoId: LEGACY_DEFAULT_REPO_ID,
    workspaceDiscoveryRoots: legacy.workspaceDiscoveryRoots,
    workspaceAllowlist: legacy.workspaceAllowlist,
    repoMappings: legacy.repoMappings,
    requireDefaultRepoMapping: false
  });
  return {
    sourceSchemaVersion: 0,
    config: withCompatibilityProjection(migrated.canonical, migrated.preferredDefaultRepoId)
  };
}

export function serializeUserConfigV3(
  config: TokenPilotUserConfig,
  options: { existingRaw?: Record<string, unknown> } = {}
): Record<string, unknown> {
  const canonical = validateCanonicalRegistry(
    normalizeCanonicalConfig({
      schemaVersion: USER_CONFIG_SCHEMA_VERSION,
      workspaceDiscoveryRoots: config.workspaceDiscoveryRoots,
      workspaceAllowlist: config.workspaceAllowlist,
      projects: config.projects,
      projectRoots: config.projectRoots,
      executionWorkspaces: config.executionWorkspaces
    })
  );

  const raw: Record<string, unknown> = { ...(options.existingRaw ?? {}) };
  delete raw.defaultRepoId;
  delete raw.repoMappings;
  raw.schemaVersion = USER_CONFIG_SCHEMA_VERSION;
  raw.workspaceDiscoveryRoots = [...canonical.workspaceDiscoveryRoots];
  raw.workspaceAllowlist = [...canonical.workspaceAllowlist];
  raw.projects = sortedRecord(canonical.projects);
  raw.projectRoots = sortedRecord(canonical.projectRoots);
  raw.executionWorkspaces = sortedRecord(canonical.executionWorkspaces);
  return raw;
}
