import fs from "node:fs";

import type { TokenPilotPaths } from "../types.js";
import { readIdentityEnv, type EnvLike } from "../core/identity-env.js";
import { resolveOAuthPublicConfig } from "./oauth-config.js";

export type OAuthReadinessStatus = "disabled" | "ready" | "needs-attention";

export interface OAuthReadiness {
  status: OAuthReadinessStatus;
  ready: boolean;
  required: boolean;
  protectedResourceMetadataUrl: string | null;
  detail: string;
  nextAction: string;
}

function readEnvFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

function runtimeWritable(paths: TokenPilotPaths): boolean {
  try {
    fs.accessSync(paths.runtimeDir, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function buildOAuthReadiness(
  paths: TokenPilotPaths,
  env: EnvLike = process.env
): OAuthReadiness {
  const exposed = readEnvFlag(readIdentityEnv("EXPOSED", env));
  if (!exposed) {
    return {
      status: "disabled",
      ready: false,
      required: false,
      protectedResourceMetadataUrl: null,
      detail: "Remote MCP OAuth is disabled in local-only mode.",
      nextAction: "No OAuth action is required for local-only operation."
    };
  }

  if (!readIdentityEnv("API_TOKEN", env)) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: null,
      detail: "Remote MCP OAuth needs the existing TokenPilot owner secret.",
      nextAction: "Set TOKENPILOT_API_TOKEN before enabling exposed mode."
    };
  }

  let config;
  try {
    config = resolveOAuthPublicConfig(env);
  } catch (error) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: null,
      detail: error instanceof Error ? error.message : "OAuth public origin is invalid.",
      nextAction: "Fix TOKENPILOT_PUBLIC_BASE_URL and restart TokenPilot."
    };
  }

  if (!config) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: null,
      detail: "Remote MCP OAuth needs a canonical public origin.",
      nextAction: "Set TOKENPILOT_PUBLIC_BASE_URL to the HTTPS origin without /mcp."
    };
  }

  if (!runtimeWritable(paths)) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
      detail: "TokenPilot runtime state is not writable for OAuth persistence.",
      nextAction: "Fix local runtime directory permissions, then restart TokenPilot."
    };
  }

  return {
    status: "ready",
    ready: true,
    required: true,
    protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
    detail: "ChatGPT Remote MCP OAuth discovery, PKCE and refresh-token state are ready.",
    nextAction: "Connect ChatGPT to the public /mcp endpoint and approve the browser authorization."
  };
}
