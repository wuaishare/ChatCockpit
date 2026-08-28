import fs from "node:fs";
import path from "node:path";

import type {
  TokenPilotExecutionWorkspaceMapping,
  TokenPilotProjectMapping,
  TokenPilotProjectRootMapping,
  TokenPilotUserConfig
} from "../types.js";
import { rootIdForRepoId } from "../core/project-config-identity.js";
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
  if (!isRecord(raw)) throw new Error("User config must be an object");
  const allowedTopLevel = new Set([
    "schemaVersion",
    "defaultRepoId",
    "workspaceDiscoveryRoots",
    "workspaceAllowlist",
    "repoMappings",
    "projects",
    "projectRoots",
    "executionWorkspaces"
  ]);
  const unknownTopLevel = Object.keys(raw).filter((key) => !allowedTopLevel.has(key));
  if (unknownTopLevel.length > 0) {
    throw new Error(
      `User config contains unsupported field(s): ${unknownTopLevel.sort().join(", ")}`
    );
  }

  if (raw.repoMappings !== undefined) {
    if (!isRecord(raw.repoMappings)) throw new Error("User config repoMappings must be an object");
    for (const [repoId, mapping] of Object.entries(raw.repoMappings)) {
      if (!isRecord(mapping)) {
        throw new Error(`User config repoMappings.${repoId} must be an object`);
      }
      const unknown = Object.keys(mapping).filter((key) => key !== "path");
      if (unknown.length > 0) {
        throw new Error(
          `User config repoMappings.${repoId} contains unsupported field(s): ${unknown.sort().join(", ")}`
        );
      }
    }
  }

  if (raw.projects !== undefined) {
    if (!isRecord(raw.projects)) throw new Error("User config projects must be an object");
    for (const [projectSlug, project] of Object.entries(raw.projects)) {
      if (!isRecord(project)) {
        throw new Error(`User config projects.${projectSlug} must be an object`);
      }
      const allowed = new Set([
        "displayName",
        "primaryRepoId",
        "repoIds",
        "primaryRootId",
        "rootIds"
      ]);
      const unknown = Object.keys(project).filter((key) => !allowed.has(key));
      if (unknown.length > 0) {
        throw new Error(
          `User config projects.${projectSlug} contains unsupported field(s): ${unknown.sort().join(", ")}`
        );
      }
    }
  }

  if (raw.projectRoots !== undefined && !isRecord(raw.projectRoots)) {
    throw new Error("User config projectRoots must be an object");
  }
  if (raw.executionWorkspaces !== undefined && !isRecord(raw.executionWorkspaces)) {
    throw new Error("User config executionWorkspaces must be an object");
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
  return Array.from(new Set(values.map(canonicalPath))).sort((left, right) => left.localeCompare(right));
}

function normalizeConfig(config: TokenPilotUserConfig): TokenPilotUserConfig {
  const parsed = parseUserConfig({
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    workspaceDiscoveryRoots: dedupeSorted(config.workspaceDiscoveryRoots),
    workspaceAllowlist: dedupeSorted(config.workspaceAllowlist),
    projects: Object.fromEntries(
      Object.entries(config.projects)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([projectSlug, project]) => [
          projectSlug,
          {
            displayName: project.displayName.trim(),
            primaryRootId: project.primaryRootId,
            rootIds: Array.from(new Set(project.rootIds)).sort((left, right) => left.localeCompare(right))
          }
        ])
    ),
    projectRoots: Object.fromEntries(
      Object.entries(config.projectRoots)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([rootId, root]) => [rootId, { ...root, path: canonicalPath(root.path) }])
    ),
    executionWorkspaces: Object.fromEntries(
      Object.entries(config.executionWorkspaces)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([repoId, workspace]) => [
          repoId,
          { ...workspace, path: canonicalPath(workspace.path) }
        ])
    )
  }).config;
  if (config.defaultRepoId && parsed.executionWorkspaces[config.defaultRepoId]) {
    parsed.defaultRepoId = config.defaultRepoId;
  }
  return parsed;
}

function isWithinAllowlist(repoPath: string, allowlist: readonly string[]): boolean {
  const candidate = canonicalPath(repoPath);
  return allowlist.some((allowed) => {
    const root = canonicalPath(allowed);
    return candidate === root || candidate.startsWith(`${root}${path.sep}`);
  });
}

function assertConfigIntegrity(config: TokenPilotUserConfig): void {
  const defaultWorkspace = config.executionWorkspaces[config.defaultRepoId];
  if (!defaultWorkspace) {
    throw new Error(`User config defaultRepoId ${config.defaultRepoId} has no execution workspace`);
  }

  const seenPaths = new Map<string, string>();
  for (const [repoId, workspace] of Object.entries(config.executionWorkspaces)) {
    const normalizedPath = canonicalPath(workspace.path);
    const existing = seenPaths.get(normalizedPath);
    if (existing && existing !== repoId) {
      throw new Error(
        `User config execution workspaces ${existing} and ${repoId} resolve to the same physical path`
      );
    }
    seenPaths.set(normalizedPath, repoId);
    if (!isWithinAllowlist(normalizedPath, config.workspaceAllowlist)) {
      throw new Error(`User config repoId ${repoId} is outside the workspace allowlist`);
    }
  }
}

function remapRootId(rootId: string): string {
  return rootId === rootIdForRepoId(LEGACY_DEFAULT_REPO_ID)
    ? rootIdForRepoId(CHATCOCKPIT_TARGET_DEFAULT_REPO_ID)
    : rootId;
}

function remapProjectRegistry(
  source: TokenPilotUserConfig
): Record<string, TokenPilotProjectMapping> {
  const remapped: Record<string, TokenPilotProjectMapping> = {};
  for (const [projectSlug, project] of Object.entries(source.projects)) {
    const targetSlug = projectSlug === LEGACY_DEFAULT_REPO_ID
      ? CHATCOCKPIT_TARGET_DEFAULT_REPO_ID
      : projectSlug;
    if (remapped[targetSlug]) {
      throw new Error(`Legacy project ${projectSlug} conflicts with target project ${targetSlug}`);
    }
    remapped[targetSlug] = {
      displayName:
        projectSlug === LEGACY_DEFAULT_REPO_ID && project.displayName === LEGACY_DEFAULT_REPO_ID
          ? CHATCOCKPIT_TARGET_DEFAULT_REPO_ID
          : project.displayName,
      primaryRootId: remapRootId(project.primaryRootId),
      rootIds: project.rootIds.map(remapRootId)
    };
  }
  return remapped;
}

function remapProjectRoots(
  source: TokenPilotUserConfig
): Record<string, TokenPilotProjectRootMapping> {
  const remapped: Record<string, TokenPilotProjectRootMapping> = {};
  for (const [rootId, root] of Object.entries(source.projectRoots)) {
    const targetRootId = remapRootId(rootId);
    if (remapped[targetRootId]) {
      throw new Error(`Legacy ProjectRoot ${rootId} conflicts with target ProjectRoot ${targetRootId}`);
    }
    remapped[targetRootId] = { ...root };
  }
  return remapped;
}

function remapExecutionWorkspaces(
  source: TokenPilotUserConfig
): Record<string, TokenPilotExecutionWorkspaceMapping> {
  const remapped: Record<string, TokenPilotExecutionWorkspaceMapping> = {};
  for (const [repoId, workspace] of Object.entries(source.executionWorkspaces)) {
    const targetRepoId = repoId === LEGACY_DEFAULT_REPO_ID
      ? CHATCOCKPIT_TARGET_DEFAULT_REPO_ID
      : repoId;
    if (remapped[targetRepoId]) {
      throw new Error(`Legacy workspace ${repoId} conflicts with target workspace ${targetRepoId}`);
    }
    remapped[targetRepoId] = {
      ...workspace,
      projectRootId: remapRootId(workspace.projectRootId)
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
    projects: Object.fromEntries(
      Object.entries(normalized.projects).sort(([left], [right]) => left.localeCompare(right))
    ),
    projectRoots: Object.fromEntries(
      Object.entries(normalized.projectRoots).sort(([left], [right]) => left.localeCompare(right))
    ),
    executionWorkspaces: Object.fromEntries(
      Object.entries(normalized.executionWorkspaces).sort(([left], [right]) => left.localeCompare(right))
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
  if (!source.executionWorkspaces[LEGACY_DEFAULT_REPO_ID]) {
    throw new Error(`Legacy config is missing ${LEGACY_DEFAULT_REPO_ID} execution workspace`);
  }
  if (source.executionWorkspaces[CHATCOCKPIT_TARGET_DEFAULT_REPO_ID]) {
    throw new Error(
      `Legacy config already contains reserved target repoId ${CHATCOCKPIT_TARGET_DEFAULT_REPO_ID}`
    );
  }

  const executionWorkspaces = remapExecutionWorkspaces(source);
  const target = normalizeConfig({
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    defaultRepoId: CHATCOCKPIT_TARGET_DEFAULT_REPO_ID,
    workspaceDiscoveryRoots: source.workspaceDiscoveryRoots,
    workspaceAllowlist: source.workspaceAllowlist,
    projects: remapProjectRegistry(source),
    projectRoots: remapProjectRoots(source),
    executionWorkspaces,
    repoMappings: Object.fromEntries(
      Object.entries(executionWorkspaces).map(([repoId, workspace]) => [
        repoId,
        { path: workspace.path }
      ])
    )
  });
  target.defaultRepoId = CHATCOCKPIT_TARGET_DEFAULT_REPO_ID;
  assertConfigIntegrity(target);
  return target;
}

export function parseCanonicalChatCockpitTargetConfig(raw: unknown): TokenPilotUserConfig {
  assertKnownConfigShape(raw);
  const parsed = parseUserConfig(raw);
  if (![1, 2, 3].includes(parsed.sourceSchemaVersion)) {
    throw new Error("ChatCockpit target config must use a versioned schema");
  }
  const config = normalizeConfig(parsed.config);
  if (config.defaultRepoId !== CHATCOCKPIT_TARGET_DEFAULT_REPO_ID) {
    throw new Error(
      `ChatCockpit target config defaultRepoId must be ${CHATCOCKPIT_TARGET_DEFAULT_REPO_ID}`
    );
  }
  if (config.executionWorkspaces[LEGACY_DEFAULT_REPO_ID]) {
    throw new Error("ChatCockpit target config must not retain legacy tokenpilot workspace mapping");
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
