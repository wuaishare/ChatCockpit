import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TokenPilotUserConfig } from "../types.js";

const DEFAULT_REPO_ID = "tokenpilot";

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
  return {
    workspaceAllowlist: [normalizedRepoRoot],
    repoMappings: {
      [DEFAULT_REPO_ID]: {
        path: normalizedRepoRoot
      }
    }
  };
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

  if (!normalized.workspaceAllowlist.includes(normalizedRepoRoot)) {
    normalized.workspaceAllowlist.push(normalizedRepoRoot);
    normalized.workspaceAllowlist = dedupeSorted(normalized.workspaceAllowlist);
  }

  return normalized;
}
