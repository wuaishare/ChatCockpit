import fs from "node:fs";

import type { TokenPilotPaths } from "../types.js";
import {
  readIdentityEnv,
  runtimeIdentityEnvName,
  type EnvLike
} from "../core/identity-env.js";
import { productIdentityForKey } from "../core/product-identity.js";
import { resolveOAuthPublicConfig } from "./oauth-config.js";
import { hasConfiguredOperatorOwner } from "./operator-store.js";

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
  const identity = productIdentityForKey(paths.productIdentity);
  const apiTokenEnv = runtimeIdentityEnvName("API_TOKEN", paths.productIdentity);
  const publicBaseEnv = runtimeIdentityEnvName(
    "PUBLIC_BASE_URL",
    paths.productIdentity
  );
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
      detail: "Remote MCP exposure still requires the machine API authority.",
      nextAction: `Set ${apiTokenEnv} before enabling exposed mode.`
    };
  }

  let config;
  try {
    config = resolveOAuthPublicConfig(env, paths.productIdentity);
  } catch (error) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: null,
      detail: error instanceof Error ? error.message : "OAuth public origin is invalid.",
      nextAction: `Fix ${publicBaseEnv} and restart ${identity.displayName}.`
    };
  }

  if (!config) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: null,
      detail: "Remote MCP OAuth needs a canonical public origin.",
      nextAction: `Set ${publicBaseEnv} to the HTTPS origin without /mcp.`
    };
  }

  if (!runtimeWritable(paths)) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
      detail: `${identity.displayName} runtime state is not writable for OAuth persistence.`,
      nextAction: `Fix local runtime directory permissions, then restart ${identity.displayName}.`
    };
  }

  if (!hasConfiguredOperatorOwner(paths.runtimeDir)) {
    return {
      status: "needs-attention",
      ready: false,
      required: true,
      protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
      detail: "Remote MCP OAuth needs a configured Web Owner account for browser approval.",
      nextAction: `Run ${identity.cliName} operator set-password locally before connecting ChatGPT.`
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
