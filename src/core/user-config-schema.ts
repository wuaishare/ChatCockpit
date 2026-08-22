import { z } from "zod";

import type { TokenPilotUserConfig } from "../types.js";

export const USER_CONFIG_SCHEMA_VERSION = 1 as const;
export const LEGACY_DEFAULT_REPO_ID = "tokenpilot" as const;
export const CHATCOCKPIT_TARGET_DEFAULT_REPO_ID = "primary" as const;

const mappingSchema = z.object({
  path: z.string().min(1)
});

const commonSchema = z.object({
  workspaceDiscoveryRoots: z.array(z.string()).default([]),
  workspaceAllowlist: z.array(z.string()).default([]),
  repoMappings: z.record(z.string(), mappingSchema).default({})
});

const v1Schema = commonSchema.extend({
  schemaVersion: z.literal(USER_CONFIG_SCHEMA_VERSION),
  defaultRepoId: z.string().min(1)
});

export interface UserConfigParseResult {
  sourceSchemaVersion: 0 | 1;
  config: TokenPilotUserConfig;
}

function hasSchemaVersion(value: unknown): value is { schemaVersion: unknown } {
  return typeof value === "object" && value !== null && "schemaVersion" in value;
}

export function parseUserConfig(raw: unknown): UserConfigParseResult {
  if (hasSchemaVersion(raw)) {
    if (raw.schemaVersion !== USER_CONFIG_SCHEMA_VERSION) {
      throw new Error(`User config schemaVersion ${String(raw.schemaVersion)} is unsupported`);
    }
    const parsed = v1Schema.parse(raw);
    if (!parsed.repoMappings[parsed.defaultRepoId]) {
      throw new Error(`User config defaultRepoId ${parsed.defaultRepoId} has no repo mapping`);
    }
    return {
      sourceSchemaVersion: 1,
      config: parsed
    };
  }

  const legacy = commonSchema.parse(raw);
  return {
    sourceSchemaVersion: 0,
    config: {
      schemaVersion: USER_CONFIG_SCHEMA_VERSION,
      defaultRepoId: LEGACY_DEFAULT_REPO_ID,
      workspaceDiscoveryRoots: legacy.workspaceDiscoveryRoots,
      workspaceAllowlist: legacy.workspaceAllowlist,
      repoMappings: legacy.repoMappings
    }
  };
}
