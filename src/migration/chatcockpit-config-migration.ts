import fs from "node:fs";
import path from "node:path";

import type { TokenPilotUserConfig } from "../types.js";
import {
  CHATCOCKPIT_TARGET_DEFAULT_REPO_ID,
  LEGACY_DEFAULT_REPO_ID,
  USER_CONFIG_SCHEMA_VERSION,
  parseUserConfig
} from "../core/user-config-schema.js";

export type TargetConfigDisposition = "absent" | "canonical-equivalent" | "conflict";

export interface ChatCockpitTargetConfigAssessment {
  disposition: TargetConfigDisposition;
  expected: TokenPilotUserConfig | null;
  actual: TokenPilotUserConfig | null;
  blockers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownConfigShape(raw: unknown): void {
  if (!isRecord(raw)) {
    throw new Error("User config must be an object");
  }
  const allowedTopLevel = new Set([
    "schemaVersion",
    "defaultRepoId",
    "workspaceDiscoveryRoots",
    "workspaceAllowlist",
    "repoMappings",
    "projects"
  ]);
  const unknownTopLevel = Object.keys(raw).filter((key) => !allowedTopLevel.has(key));
  if (unknownTopLevel.length > 0) {
    throw new Error(
      `User config contains unsupported field(s): ${unknownTopLevel.sort().join(", ")}`
    );
  }
  if (raw.repoMappings !== undefined) {
    if (!isRecord(raw.repoMappings)) {
      throw new Error("User config repoMappings must be an object");
    }
    for (const [repoId, mapping] of Object.entries(raw.repoMappings)) {
      if (!isRecord(mapping)) {
        throw new Error(`User config repoMappings.${repoId} must be an object`);
      }
      const unknownMappingFields = Object.keys(mapping).filter((key) => key !== "path");
      if (unknownMappingFields.length > 0) {
        throw new Error(
          `User config repoMappings.${repoId} contains unsupported field(s): ${unknownMappingFields
            .sort()
            .join(", ")}`
        );
      }
    }
  }
  if (raw.projects !== undefined) {
    if (!isRecord(raw.projects)) {
      throw new Error("User config projects must be an object");
    }
    for (const [projectSlug, project] of Object.entries(raw.projects)) {
      if (!isRecord(project)) {
        throw new Error(`User config projects.${projectSlug} must be an object`);
      }
      const allowedProjectFields = new Set(["displayName", "primaryRepoId", "repoIds"]);
      const unknownProjectFields = Object.keys(project).filter(
        (key) => !allowedProjectFields.has(key)
      );
      if (unknownProjectFields.length > 0) {
        throw new Error(
          `User config projects.${projectSlug} contains unsupported field(s): ${unknownProjectFields
            .sort()
            .join(", ")}`
        );
      }
    }
  }
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) return resolved;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function dedupeSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(canonicalPath))).sort();
}

function normalizeConfig(config: TokenPilotUserConfig): TokenPilotUserConfig {
  return {
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    defaultRepoId: config.defaultRepoId,
    workspaceDiscoveryRoots: dedupeSorted(config.workspaceDiscoveryRoots),
    workspaceAllowlist: dedupeSorted(config.workspaceAllowlist),
    repoMappings: Object.fromEntries(
      Object.entries(config.repoMappings)
        .map(([repoId, mapping]) => [repoId, { path: canonicalPath(mapping.path) }] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    projects: Object.fromEntries(
      Object.entries(config.projects)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([projectSlug, project]) => [
          projectSlug,
          {
            displayName: project.displayName.trim(),
            primaryRepoId: project.primaryRepoId,
            repoIds: Array.from(new Set(project.repoIds)).sort((left, right) => left.localeCompare(right))
          }
        ])
    )
  };
}

function isWithinAllowlist(repoPath: string, allowlist: readonly string[]): boolean {
  const candidate = canonicalPath(repoPath);
  return allowlist.some((allowed) => {
    const root = canonicalPath(allowed);
    return candidate === root || candidate.startsWith(`${root}${path.sep}`);
  });
}

function assertConfigIntegrity(config: TokenPilotUserConfig): void {
  const defaultMapping = config.repoMappings[config.defaultRepoId];
  if (!defaultMapping) {
    throw new Error(`User config defaultRepoId ${config.defaultRepoId} has no repo mapping`);
  }

  const seenPaths = new Map<string, string>();
  for (const [repoId, mapping] of Object.entries(config.repoMappings)) {
    const normalizedPath = canonicalPath(mapping.path);
    const existing = seenPaths.get(normalizedPath);
    if (existing && existing !== repoId) {
      throw new Error(
        `User config repo mappings ${existing} and ${repoId} resolve to the same physical path`
      );
    }
    seenPaths.set(normalizedPath, repoId);
    if (!isWithinAllowlist(normalizedPath, config.workspaceAllowlist)) {
      throw new Error(`User config repoId ${repoId} is outside the workspace allowlist`);
    }
  }

  const ownerByRepoId = new Map<string, string>();
  for (const [projectSlug, project] of Object.entries(config.projects)) {
    if (!project.repoIds.includes(project.primaryRepoId)) {
      throw new Error(`User config project ${projectSlug} primaryRepoId must belong to repoIds`);
    }
    for (const repoId of project.repoIds) {
      if (!config.repoMappings[repoId]) {
        throw new Error(`User config project ${projectSlug} references unknown repoId ${repoId}`);
      }
      const existingOwner = ownerByRepoId.get(repoId);
      if (existingOwner && existingOwner !== projectSlug) {
        throw new Error(`User config repoId ${repoId} belongs to more than one project`);
      }
      ownerByRepoId.set(repoId, projectSlug);
    }
  }
  for (const repoId of Object.keys(config.repoMappings)) {
    if (!ownerByRepoId.has(repoId)) {
      throw new Error(`User config repoId ${repoId} is not assigned to a project`);
    }
  }
}

function remapLegacyProjectRegistry(
  source: TokenPilotUserConfig
): TokenPilotUserConfig["projects"] {
  const remapped: TokenPilotUserConfig["projects"] = {};
  for (const [projectSlug, project] of Object.entries(source.projects)) {
    const targetSlug =
      projectSlug === LEGACY_DEFAULT_REPO_ID
        ? CHATCOCKPIT_TARGET_DEFAULT_REPO_ID
        : projectSlug;
    if (remapped[targetSlug]) {
      throw new Error(`Legacy project ${projectSlug} conflicts with target project ${targetSlug}`);
    }
    const remapRepoId = (repoId: string) =>
      repoId === LEGACY_DEFAULT_REPO_ID
        ? CHATCOCKPIT_TARGET_DEFAULT_REPO_ID
        : repoId;
    remapped[targetSlug] = {
      displayName:
        projectSlug === LEGACY_DEFAULT_REPO_ID && project.displayName === LEGACY_DEFAULT_REPO_ID
          ? CHATCOCKPIT_TARGET_DEFAULT_REPO_ID
          : project.displayName,
      primaryRepoId: remapRepoId(project.primaryRepoId),
      repoIds: project.repoIds.map(remapRepoId)
    };
  }
  return remapped;
}

function stableConfig(config: TokenPilotUserConfig): string {
  const normalized = normalizeConfig(config);
  return JSON.stringify({
    schemaVersion: normalized.schemaVersion,
    defaultRepoId: normalized.defaultRepoId,
    workspaceDiscoveryRoots: [...normalized.workspaceDiscoveryRoots].sort(),
    workspaceAllowlist: [...normalized.workspaceAllowlist].sort(),
    repoMappings: Object.fromEntries(
      Object.entries(normalized.repoMappings).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    projects: Object.fromEntries(
      Object.entries(normalized.projects).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    )
  });
}

export function migrateLegacyUserConfigToChatCockpit(raw: unknown): TokenPilotUserConfig {
  assertKnownConfigShape(raw);
  const parsed = parseUserConfig(raw);
  const source = normalizeConfig(parsed.config);
  assertConfigIntegrity(source);

  if (source.defaultRepoId !== LEGACY_DEFAULT_REPO_ID) {
    throw new Error(
      `Legacy config defaultRepoId must be ${LEGACY_DEFAULT_REPO_ID}, received ${source.defaultRepoId}`
    );
  }
  const legacyDefaultMapping = source.repoMappings[LEGACY_DEFAULT_REPO_ID];
  if (!legacyDefaultMapping) {
    throw new Error(`Legacy config is missing ${LEGACY_DEFAULT_REPO_ID} repo mapping`);
  }
  if (source.repoMappings[CHATCOCKPIT_TARGET_DEFAULT_REPO_ID]) {
    throw new Error(
      `Legacy config already contains reserved target repoId ${CHATCOCKPIT_TARGET_DEFAULT_REPO_ID}`
    );
  }

  const repoMappings = Object.fromEntries(
    Object.entries(source.repoMappings).filter(([repoId]) => repoId !== LEGACY_DEFAULT_REPO_ID)
  );
  repoMappings[CHATCOCKPIT_TARGET_DEFAULT_REPO_ID] = {
    path: legacyDefaultMapping.path
  };

  const target = normalizeConfig({
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    defaultRepoId: CHATCOCKPIT_TARGET_DEFAULT_REPO_ID,
    workspaceDiscoveryRoots: source.workspaceDiscoveryRoots,
    workspaceAllowlist: source.workspaceAllowlist,
    repoMappings,
    projects: remapLegacyProjectRegistry(source)
  });
  assertConfigIntegrity(target);
  return target;
}

export function parseCanonicalChatCockpitTargetConfig(raw: unknown): TokenPilotUserConfig {
  assertKnownConfigShape(raw);
  const parsed = parseUserConfig(raw);
  if (parsed.sourceSchemaVersion !== 1 && parsed.sourceSchemaVersion !== 2) {
    throw new Error("ChatCockpit target config must use schemaVersion 1 or 2");
  }
  const config = normalizeConfig(parsed.config);
  if (config.defaultRepoId !== CHATCOCKPIT_TARGET_DEFAULT_REPO_ID) {
    throw new Error(
      `ChatCockpit target config defaultRepoId must be ${CHATCOCKPIT_TARGET_DEFAULT_REPO_ID}`
    );
  }
  if (config.repoMappings[LEGACY_DEFAULT_REPO_ID]) {
    throw new Error("ChatCockpit target config must not retain legacy tokenpilot repo mapping");
  }
  assertConfigIntegrity(config);
  return config;
}

export function assessChatCockpitTargetConfig(input: {
  legacyConfigRaw: unknown | null;
  targetConfigRaw: unknown | null;
}): ChatCockpitTargetConfigAssessment {
  const blockers: string[] = [];
  let expected: TokenPilotUserConfig | null = null;
  let actual: TokenPilotUserConfig | null = null;

  if (input.legacyConfigRaw !== null) {
    try {
      expected = migrateLegacyUserConfigToChatCockpit(input.legacyConfigRaw);
    } catch (error) {
      blockers.push(
        `legacy-config-invalid:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (input.targetConfigRaw === null) {
    return {
      disposition: blockers.length > 0 ? "conflict" : "absent",
      expected,
      actual,
      blockers
    };
  }

  try {
    actual = parseCanonicalChatCockpitTargetConfig(input.targetConfigRaw);
  } catch (error) {
    blockers.push(
      `target-config-invalid:${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!expected) {
    blockers.push("target-config-cannot-be-compared-without-valid-legacy-config");
  } else if (actual && stableConfig(actual) !== stableConfig(expected)) {
    blockers.push("target-config-does-not-match-migrated-legacy-config");
  }

  return {
    disposition: blockers.length === 0 ? "canonical-equivalent" : "conflict",
    expected,
    actual,
    blockers
  };
}
