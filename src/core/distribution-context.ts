import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TokenPilotDistributionContext, TokenPilotPaths } from "../types.js";
import { readIdentityEnv, type EnvLike } from "./identity-env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePath(value: string): string {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) return resolved;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function defaultSourceInstallRoot(): string {
  return path.resolve(__dirname, "../../");
}

function defaultPackagedSupportRoot(): string {
  return path.join(os.homedir(), "Library", "Application Support", "TokenPilot");
}

export function buildDistributionContext(
  overrides: Partial<TokenPilotDistributionContext> = {},
  env: EnvLike = process.env
): TokenPilotDistributionContext {
  const mode =
    overrides.mode ??
    (readIdentityEnv("DISTRIBUTION_MODE", env) === "packaged" ? "packaged" : "source");
  const installRoot = resolvePath(
    overrides.installRoot ??
      readIdentityEnv("INSTALL_ROOT", env) ??
      readIdentityEnv("REPO_ROOT", env) ??
      defaultSourceInstallRoot()
  );
  const supportRoot = defaultPackagedSupportRoot();
  const stateRoot = resolvePath(
    overrides.stateRoot ??
      readIdentityEnv("STATE_ROOT", env) ??
      (mode === "packaged" ? path.join(supportRoot, "state") : path.join(installRoot, ".tokenpilot"))
  );
  const primaryWorkspaceRoot = resolvePath(
    overrides.primaryWorkspaceRoot ??
      readIdentityEnv("PRIMARY_WORKSPACE_ROOT", env) ??
      installRoot
  );
  const nodeExecutable = resolvePath(
    overrides.nodeExecutable ?? readIdentityEnv("NODE_BIN", env) ?? process.execPath
  );
  const configPath = resolvePath(
    overrides.configPath ??
      readIdentityEnv("CONFIG_PATH", env) ??
      (mode === "packaged"
        ? path.join(supportRoot, "config", "config.json")
        : path.join(os.homedir(), ".tokenpilot", "config.json"))
  );

  return {
    mode,
    installRoot,
    stateRoot,
    primaryWorkspaceRoot,
    nodeExecutable,
    configPath
  };
}

export function buildDistributionContextFromPaths(
  paths: TokenPilotPaths
): TokenPilotDistributionContext {
  return {
    mode: paths.distributionMode,
    installRoot: paths.installRoot,
    stateRoot: paths.stateRoot,
    primaryWorkspaceRoot: paths.repoRoot,
    nodeExecutable: paths.nodeExecutable,
    configPath: paths.configPath
  };
}

export function buildSourceDistributionContext(
  repoRoot: string,
  overrides: Partial<TokenPilotDistributionContext> = {}
): TokenPilotDistributionContext {
  const installRoot = resolvePath(repoRoot);
  return buildDistributionContext({
    ...overrides,
    mode: "source",
    installRoot,
    stateRoot: overrides.stateRoot ?? path.join(installRoot, ".tokenpilot"),
    primaryWorkspaceRoot: overrides.primaryWorkspaceRoot ?? installRoot
  });
}
