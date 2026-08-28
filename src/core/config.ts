import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  TokenPilotDistributionContext,
  TokenPilotPaths,
  TokenPilotRepoGovernanceEntry,
  TokenPilotRepoGovernanceRecord,
  TokenPilotUserConfig
} from "../types.js";
import {
  buildDistributionContextFromPaths,
  buildSourceDistributionContext
} from "./distribution-context.js";
import { readIdentityEnv } from "./identity-env.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "./product-identity.js";
import {
  CHATCOCKPIT_TARGET_DEFAULT_REPO_ID,
  LEGACY_DEFAULT_REPO_ID,
  USER_CONFIG_SCHEMA_VERSION,
  parseUserConfig
} from "./user-config-schema.js";

export const DEFAULT_REPO_ID = DEFAULT_PRODUCT_IDENTITY.defaultRepoId;
const DEFAULT_SIBLING_REPOS: Record<string, string> = {
  "sourceflow-refactor": "sourceflow-refactor",
  "ai-wuaishare-cn": "ai.wuaishare.cn"
};

function defaultConfigPath(context?: TokenPilotDistributionContext): string {
  if (context) return context.configPath;
  return (
    readIdentityEnv("CONFIG_PATH") ??
    path.join(os.homedir(), DEFAULT_PRODUCT_IDENTITY.stateDirName, "config.json")
  );
}

function normalizeAbsolutePath(input: string): string {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    return resolved;
  }
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function assertUniqueRepoMappings(config: TokenPilotUserConfig): void {
  const seen = new Map<string, string>();
  for (const [repoId, mapping] of Object.entries(config.repoMappings).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const canonicalPath = normalizeAbsolutePath(mapping.path);
    const existingRepoId = seen.get(canonicalPath);
    if (existingRepoId && existingRepoId !== repoId) {
      throw new Error(
        `repoMappings ${existingRepoId} and ${repoId} resolve to the same canonical workspace path; keep one repoId per physical checkout`
      );
    }
    seen.set(canonicalPath, repoId);
  }
}

function dedupeSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function standaloneProject(repoId: string) {
  return {
    displayName: repoId,
    primaryRepoId: repoId,
    repoIds: [repoId]
  };
}

function buildDefaultConfig(
  repoRoot: string,
  context: TokenPilotDistributionContext,
  defaultRepoId: string = productIdentityForKey(context.productIdentity).defaultRepoId
): TokenPilotUserConfig {
  const normalizedRepoRoot = normalizeAbsolutePath(context.primaryWorkspaceRoot || repoRoot);
  const siblingMappings =
    context.mode === "source" ? discoverSiblingRepoMappings(normalizedRepoRoot) : {};
  const siblingAllowlist = Object.values(siblingMappings).map((mapping) => mapping.path);
  const repoMappings = {
    [defaultRepoId]: {
      path: normalizedRepoRoot
    },
    ...siblingMappings
  };
  return {
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    defaultRepoId,
    workspaceDiscoveryRoots: [],
    workspaceAllowlist: dedupeSorted([normalizedRepoRoot, ...siblingAllowlist]),
    repoMappings,
    projects: Object.fromEntries(
      Object.keys(repoMappings)
        .sort((left, right) => left.localeCompare(right))
        .map((repoId) => [repoId, standaloneProject(repoId)])
    )
  };
}

function discoverSiblingRepoMappings(normalizedRepoRoot: string): Record<string, { path: string }> {
  const repoParent = path.dirname(normalizedRepoRoot);
  return Object.fromEntries(
    Object.entries(DEFAULT_SIBLING_REPOS)
      .map(([repoId, dirName]) => [repoId, path.join(repoParent, dirName)] as const)
      .filter(([, repoPath]) => fs.existsSync(repoPath))
      .map(([repoId, repoPath]) => [
        repoId,
        {
          path: normalizeAbsolutePath(repoPath)
        }
      ])
  );
}

function normalizeConfig(config: TokenPilotUserConfig): TokenPilotUserConfig {
  return {
    schemaVersion: USER_CONFIG_SCHEMA_VERSION,
    defaultRepoId: config.defaultRepoId,
    workspaceDiscoveryRoots: dedupeSorted(
      (config.workspaceDiscoveryRoots || []).map(normalizeAbsolutePath)
    ),
    workspaceAllowlist: dedupeSorted(
      (config.workspaceAllowlist || []).map(normalizeAbsolutePath)
    ),
    repoMappings: Object.fromEntries(
      Object.entries(config.repoMappings || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([repoId, mapping]) => [
          repoId,
          {
            path: normalizeAbsolutePath(mapping.path)
          }
        ])
    ),
    projects: Object.fromEntries(
      Object.entries(config.projects || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([projectSlug, project]) => [
          projectSlug,
          {
            displayName: project.displayName.trim(),
            primaryRepoId: project.primaryRepoId,
            repoIds: dedupeSorted(project.repoIds)
          }
        ])
    )
  };
}

export function buildChatCockpitTargetConfigPreview(
  repoRoot: string,
  context: TokenPilotDistributionContext = buildSourceDistributionContext(repoRoot)
): TokenPilotUserConfig {
  return normalizeConfig(
    buildDefaultConfig(repoRoot, context, CHATCOCKPIT_TARGET_DEFAULT_REPO_ID)
  );
}

export function getUserConfigPath(context?: TokenPilotDistributionContext): string {
  return defaultConfigPath(context);
}

export function loadUserConfig(
  repoRoot: string,
  context: TokenPilotDistributionContext = buildSourceDistributionContext(repoRoot)
): TokenPilotUserConfig {
  const configPath = getUserConfigPath(context);
  if (!fs.existsSync(configPath)) {
    const config = buildDefaultConfig(repoRoot, context);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  const parsed = parseUserConfig(raw);
  const normalized = normalizeConfig(parsed.config);
  const normalizedRepoRoot = normalizeAbsolutePath(context.primaryWorkspaceRoot || repoRoot);

  if (parsed.sourceSchemaVersion === 0 && !normalized.repoMappings[LEGACY_DEFAULT_REPO_ID]) {
    normalized.repoMappings[LEGACY_DEFAULT_REPO_ID] = {
      path: normalizedRepoRoot
    };
    normalized.projects[LEGACY_DEFAULT_REPO_ID] = standaloneProject(LEGACY_DEFAULT_REPO_ID);
  }
  if (!normalized.repoMappings[normalized.defaultRepoId]) {
    throw new Error(`User config defaultRepoId ${normalized.defaultRepoId} has no repo mapping`);
  }

  const siblingMappings =
    context.mode === "source" ? discoverSiblingRepoMappings(normalizedRepoRoot) : {};
  for (const [repoId, mapping] of Object.entries(siblingMappings)) {
    if (!normalized.repoMappings[repoId]) {
      normalized.repoMappings[repoId] = mapping;
      normalized.projects[repoId] = standaloneProject(repoId);
    }
  }

  if (!normalized.workspaceAllowlist.includes(normalizedRepoRoot)) {
    normalized.workspaceAllowlist.push(normalizedRepoRoot);
  }
  normalized.workspaceAllowlist = dedupeSorted([
    ...normalized.workspaceAllowlist,
    ...Object.values(siblingMappings).map((mapping) => mapping.path)
  ]);
  assertUniqueRepoMappings(normalized);

  return normalized;
}

export function resolveUserConfigPathForPaths(paths: TokenPilotPaths): string {
  const context = buildDistributionContextFromPaths(paths);
  if (context.mode === "source") {
    const envConfigPath = readIdentityEnv("CONFIG_PATH");
    if (envConfigPath) {
      return normalizeAbsolutePath(envConfigPath);
    }
  }
  return normalizeAbsolutePath(context.configPath);
}

export function loadUserConfigForPaths(paths: TokenPilotPaths): TokenPilotUserConfig {
  const context = buildDistributionContextFromPaths(paths);
  context.configPath = resolveUserConfigPathForPaths(paths);
  return loadUserConfig(paths.repoRoot, context);
}

export function isWithinWorkspaceAllowlist(repoRoot: string, allowlist: string[]): boolean {
  const normalizedRepoRoot = normalizeAbsolutePath(repoRoot);
  return allowlist.some((allowedRoot) => {
    const normalizedAllowedRoot = normalizeAbsolutePath(allowedRoot);
    return (
      normalizedRepoRoot === normalizedAllowedRoot ||
      normalizedRepoRoot.startsWith(`${normalizedAllowedRoot}${path.sep}`)
    );
  });
}

export function resolveRepoMapping(
  config: TokenPilotUserConfig,
  repoId: string
): { repoId: string; repoRoot: string } {
  const mapping = config.repoMappings[repoId];
  if (!mapping) {
    throw new Error(`Unknown repoId: ${repoId}`);
  }

  const repoRoot = normalizeAbsolutePath(mapping.path);
  if (!isWithinWorkspaceAllowlist(repoRoot, config.workspaceAllowlist)) {
    throw new Error(`repoId ${repoId} is not in the workspace allowlist`);
  }

  return { repoId, repoRoot };
}

function getDefaultRepoIds(configuredDefaultRepoId: string): string[] {
  return [configuredDefaultRepoId, ...Object.keys(DEFAULT_SIBLING_REPOS)].sort();
}

export function buildRepoGovernance(
  repoRoot: string,
  context: TokenPilotDistributionContext = buildSourceDistributionContext(repoRoot)
): TokenPilotRepoGovernanceRecord {
  const config = loadUserConfig(repoRoot, context);
  const defaultRepoIds = getDefaultRepoIds(config.defaultRepoId);
  const repoIds = Array.from(
    new Set([...defaultRepoIds, ...Object.keys(config.repoMappings)])
  ).sort((a, b) => {
    if (a === config.defaultRepoId) return -1;
    if (b === config.defaultRepoId) return 1;
    return a.localeCompare(b);
  });

  const repos: TokenPilotRepoGovernanceEntry[] = repoIds.map((repoId) => {
    const mapping = config.repoMappings[repoId];
    const pathConfigured = Boolean(mapping?.path);
    const allowlisted = pathConfigured
      ? isWithinWorkspaceAllowlist(mapping.path, config.workspaceAllowlist)
      : false;
    const isKnownDefault = defaultRepoIds.includes(repoId);
    const status = pathConfigured ? (allowlisted ? "enabled" : "blocked") : "missing";
    const source =
      repoId === config.defaultRepoId
        ? "default"
        : isKnownDefault
          ? "default-sibling"
          : "local-config";

    return {
      repoId,
      status,
      defaultRepo: repoId === config.defaultRepoId,
      source,
      pathConfigured,
      allowlisted,
      pathVisibility: "hidden",
      capabilities: allowlisted ? ["pack", "files-read", "codex-run"] : []
    };
  });

  return {
    defaultRepoId: config.defaultRepoId,
    configScope: "local-private",
    pathVisibility: "hidden",
    repos
  };
}
