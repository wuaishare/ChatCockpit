import type { ProductIdentityKey } from "../types.js";

export type EnvLike = Record<string, string | undefined>;

export const RUNTIME_IDENTITY_ENV = {
  ALLOW_HIGH_TRUST_COMMANDS: {
    legacy: "TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS",
    target: "CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS"
  },
  API_TOKEN: {
    legacy: "TOKENPILOT_API_TOKEN",
    target: "CHATCOCKPIT_API_TOKEN"
  },
  BUNDLE_HISTORY_LIMIT: {
    legacy: "TOKENPILOT_BUNDLE_HISTORY_LIMIT",
    target: "CHATCOCKPIT_BUNDLE_HISTORY_LIMIT"
  },
  CODEX_BIN: {
    legacy: "TOKENPILOT_CODEX_BIN",
    target: "CHATCOCKPIT_CODEX_BIN"
  },
  CODEX_MODEL: {
    legacy: "TOKENPILOT_CODEX_MODEL",
    target: "CHATCOCKPIT_CODEX_MODEL"
  },
  CODEX_RUNNER_MODE: {
    legacy: "TOKENPILOT_CODEX_RUNNER_MODE",
    target: "CHATCOCKPIT_CODEX_RUNNER_MODE"
  },
  CONFIG_PATH: {
    legacy: "TOKENPILOT_CONFIG_PATH",
    target: "CHATCOCKPIT_CONFIG_PATH"
  },
  DIRECT_EXECUTORS_CONFIG_PATH: {
    legacy: "TOKENPILOT_DIRECT_EXECUTORS_CONFIG_PATH",
    target: "CHATCOCKPIT_DIRECT_EXECUTORS_CONFIG_PATH"
  },
  DISTRIBUTION_MODE: {
    legacy: "TOKENPILOT_DISTRIBUTION_MODE",
    target: "CHATCOCKPIT_DISTRIBUTION_MODE"
  },
  EXPOSED: {
    legacy: "TOKENPILOT_EXPOSED",
    target: "CHATCOCKPIT_EXPOSED"
  },
  HOST: {
    legacy: "TOKENPILOT_HOST",
    target: "CHATCOCKPIT_HOST"
  },
  INSTALL_ROOT: {
    legacy: "TOKENPILOT_INSTALL_ROOT",
    target: "CHATCOCKPIT_INSTALL_ROOT"
  },
  NODE_BIN: {
    legacy: "TOKENPILOT_NODE_BIN",
    target: "CHATCOCKPIT_NODE_BIN"
  },
  OAUTH_ALLOWED_REDIRECT_HOSTS: {
    legacy: "TOKENPILOT_OAUTH_ALLOWED_REDIRECT_HOSTS",
    target: "CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS"
  },
  PORT: {
    legacy: "TOKENPILOT_PORT",
    target: "CHATCOCKPIT_PORT"
  },
  PRIMARY_WORKSPACE_ROOT: {
    legacy: "TOKENPILOT_PRIMARY_WORKSPACE_ROOT",
    target: "CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT"
  },
  PUBLIC_BASE_URL: {
    legacy: "TOKENPILOT_PUBLIC_BASE_URL",
    target: "CHATCOCKPIT_PUBLIC_BASE_URL"
  },
  REPOMIX_HISTORY_LIMIT: {
    legacy: "TOKENPILOT_REPOMIX_HISTORY_LIMIT",
    target: "CHATCOCKPIT_REPOMIX_HISTORY_LIMIT"
  },
  REPO_ROOT: {
    legacy: "TOKENPILOT_REPO_ROOT",
    target: "CHATCOCKPIT_REPO_ROOT"
  },
  RESOURCE_MUTATIONS_EXPOSED: {
    legacy: "TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED",
    target: "CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED"
  },
  STATE_ROOT: {
    legacy: "TOKENPILOT_STATE_ROOT",
    target: "CHATCOCKPIT_STATE_ROOT"
  }
} as const;

export type RuntimeIdentityEnvKey = keyof typeof RUNTIME_IDENTITY_ENV;

export function runtimeIdentityEnvName(
  key: RuntimeIdentityEnvKey,
  productIdentity: ProductIdentityKey
): string {
  const pair = RUNTIME_IDENTITY_ENV[key];
  return productIdentity === "chatcockpit" ? pair.target : pair.legacy;
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export class IdentityEnvConflictError extends Error {
  readonly code = "IDENTITY_ENV_CONFLICT" as const;
  readonly legacyName: string;
  readonly targetName: string;

  constructor(legacyName: string, targetName: string) {
    super(`${targetName} conflicts with legacy ${legacyName}; remove one value or make them identical`);
    this.name = "IdentityEnvConflictError";
    this.legacyName = legacyName;
    this.targetName = targetName;
  }
}

export function readIdentityEnv(
  key: RuntimeIdentityEnvKey,
  env: EnvLike = process.env
): string | undefined {
  const pair = RUNTIME_IDENTITY_ENV[key];
  const legacyValue = normalized(env[pair.legacy]);
  const targetValue = normalized(env[pair.target]);

  if (legacyValue !== undefined && targetValue !== undefined && legacyValue !== targetValue) {
    throw new IdentityEnvConflictError(pair.legacy, pair.target);
  }

  return targetValue ?? legacyValue;
}
