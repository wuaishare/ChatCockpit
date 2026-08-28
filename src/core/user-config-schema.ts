import { z } from "zod";

import type {
  TokenPilotProjectMapping,
  TokenPilotRepoMapping,
  TokenPilotUserConfig
} from "../types.js";

export const USER_CONFIG_SCHEMA_VERSION = 2 as const;
export const LEGACY_DEFAULT_REPO_ID = "tokenpilot" as const;
export const CHATCOCKPIT_TARGET_DEFAULT_REPO_ID = "primary" as const;

const mappingSchema = z.object({
  path: z.string().min(1)
});

const projectMappingSchema = z.object({
  displayName: z.string().min(1).max(240),
  primaryRepoId: z.string().min(1).max(80),
  repoIds: z.array(z.string().min(1).max(80)).min(1).max(128)
});

const commonSchema = z.object({
  workspaceDiscoveryRoots: z.array(z.string()).default([]),
  workspaceAllowlist: z.array(z.string()).default([]),
  repoMappings: z.record(z.string(), mappingSchema).default({})
});

const v1Schema = commonSchema.extend({
  schemaVersion: z.literal(1),
  defaultRepoId: z.string().min(1)
});

const v2Schema = commonSchema.extend({
  schemaVersion: z.literal(USER_CONFIG_SCHEMA_VERSION),
  defaultRepoId: z.string().min(1),
  projects: z.record(z.string(), projectMappingSchema)
});

export interface UserConfigParseResult {
  sourceSchemaVersion: 0 | 1 | 2;
  config: TokenPilotUserConfig;
}

function hasSchemaVersion(value: unknown): value is { schemaVersion: unknown } {
  return typeof value === "object" && value !== null && "schemaVersion" in value;
}

function deterministicProjects(
  repoMappings: Record<string, TokenPilotRepoMapping>
): Record<string, TokenPilotProjectMapping> {
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

function normalizedProjects(
  projects: Record<string, TokenPilotProjectMapping>
): Record<string, TokenPilotProjectMapping> {
  return Object.fromEntries(
    Object.entries(projects)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([projectSlug, project]) => [
        projectSlug,
        {
          displayName: project.displayName.trim(),
          primaryRepoId: project.primaryRepoId,
          repoIds: Array.from(new Set(project.repoIds)).sort((left, right) => left.localeCompare(right))
        }
      ])
  );
}

function validateProjectRegistry(
  config: TokenPilotUserConfig,
  options: { requireDefaultRepoMapping?: boolean } = {}
): TokenPilotUserConfig {
  if (options.requireDefaultRepoMapping !== false && !config.repoMappings[config.defaultRepoId]) {
    throw new Error(`User config defaultRepoId ${config.defaultRepoId} has no repo mapping`);
  }

  const ownerByRepoId = new Map<string, string>();
  for (const [projectSlug, project] of Object.entries(config.projects)) {
    if (!projectSlug.trim()) {
      throw new Error("User config project slug must not be empty");
    }
    if (!project.repoIds.includes(project.primaryRepoId)) {
      throw new Error(
        `User config project ${projectSlug} primaryRepoId ${project.primaryRepoId} must belong to repoIds`
      );
    }
    for (const repoId of project.repoIds) {
      if (!config.repoMappings[repoId]) {
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

  for (const repoId of Object.keys(config.repoMappings)) {
    if (!ownerByRepoId.has(repoId)) {
      throw new Error(`User config repoId ${repoId} is not assigned to a project`);
    }
  }

  return config;
}

function upgradedConfig(input: {
  defaultRepoId: string;
  workspaceDiscoveryRoots: string[];
  workspaceAllowlist: string[];
  repoMappings: Record<string, TokenPilotRepoMapping>;
  projects?: Record<string, TokenPilotProjectMapping>;
}, options: { requireDefaultRepoMapping?: boolean } = {}): TokenPilotUserConfig {
  return validateProjectRegistry({
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    defaultRepoId: input.defaultRepoId,
    workspaceDiscoveryRoots: input.workspaceDiscoveryRoots,
    workspaceAllowlist: input.workspaceAllowlist,
    repoMappings: input.repoMappings,
    projects: normalizedProjects(input.projects ?? deterministicProjects(input.repoMappings))
  }, options);
}

export function parseUserConfig(raw: unknown): UserConfigParseResult {
  if (hasSchemaVersion(raw)) {
    if (raw.schemaVersion === 1) {
      const parsed = v1Schema.parse(raw);
      return {
        sourceSchemaVersion: 1,
        config: upgradedConfig(parsed)
      };
    }
    if (raw.schemaVersion === USER_CONFIG_SCHEMA_VERSION) {
      const parsed = v2Schema.parse(raw);
      return {
        sourceSchemaVersion: 2,
        config: upgradedConfig(parsed)
      };
    }
    throw new Error(`User config schemaVersion ${String(raw.schemaVersion)} is unsupported`);
  }

  const legacy = commonSchema.parse(raw);
  return {
    sourceSchemaVersion: 0,
    config: upgradedConfig({
      defaultRepoId: LEGACY_DEFAULT_REPO_ID,
      workspaceDiscoveryRoots: legacy.workspaceDiscoveryRoots,
      workspaceAllowlist: legacy.workspaceAllowlist,
      repoMappings: legacy.repoMappings
    }, { requireDefaultRepoMapping: false })
  };
}
