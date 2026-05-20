import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TokenPilotUserConfig } from "../types.js";

const DEFAULT_REPO_ID = "tokenpilot";
const DEFAULT_SIBLING_REPOS: Record<string, string> = {
  "sourceflow-refactor": "sourceflow-refactor",
  "ai-wuaishare-cn": "ai.wuaishare.cn"
};

function defaultConfigPath(): string {
  return path.join(os.homedir(), ".tokenpilot", "config.json");
}

function normalizeAbsolutePath(input: string): string {
  return path.resolve(input);
}

function dedupeSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function buildDefaultConfig(repoRoot: string): TokenPilotUserConfig {
  const normalizedRepoRoot = normalizeAbsolutePath(repoRoot);
  const siblingMappings = discoverSiblingRepoMappings(normalizedRepoRoot);
  const siblingAllowlist = Object.values(siblingMappings).map((mapping) => mapping.path);
  return {
    workspaceAllowlist: dedupeSorted([normalizedRepoRoot, ...siblingAllowlist]),
    repoMappings: {
      [DEFAULT_REPO_ID]: {
        path: normalizedRepoRoot
      },
      ...siblingMappings
    }
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
    workspaceAllowlist: dedupeSorted(
      (config.workspaceAllowlist || []).map(normalizeAbsolutePath)
    ),
    repoMappings: Object.fromEntries(
      Object.entries(config.repoMappings || {}).map(([repoId, mapping]) => [
        repoId,
        {
          path: normalizeAbsolutePath(mapping.path)
        }
      ])
    )
  };
}

export function getUserConfigPath(): string {
  return process.env.TOKENPILOT_CONFIG_PATH?.trim() || defaultConfigPath();
}

export function loadUserConfig(repoRoot: string): TokenPilotUserConfig {
  const configPath = getUserConfigPath();
  if (!fs.existsSync(configPath)) {
    const config = buildDefaultConfig(repoRoot);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as TokenPilotUserConfig;
  const normalized = normalizeConfig(parsed);
  const needsDefaultRepoMapping = !normalized.repoMappings[DEFAULT_REPO_ID];
  const normalizedRepoRoot = normalizeAbsolutePath(repoRoot);

  if (needsDefaultRepoMapping) {
    normalized.repoMappings[DEFAULT_REPO_ID] = {
      path: normalizedRepoRoot
    };
  }

  const siblingMappings = discoverSiblingRepoMappings(normalizedRepoRoot);
  for (const [repoId, mapping] of Object.entries(siblingMappings)) {
    if (!normalized.repoMappings[repoId]) {
      normalized.repoMappings[repoId] = mapping;
    }
  }

  if (!normalized.workspaceAllowlist.includes(normalizedRepoRoot)) {
    normalized.workspaceAllowlist.push(normalizedRepoRoot);
  }
  normalized.workspaceAllowlist = dedupeSorted([
    ...normalized.workspaceAllowlist,
    ...Object.values(siblingMappings).map((mapping) => mapping.path)
  ]);

  return normalized;
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
