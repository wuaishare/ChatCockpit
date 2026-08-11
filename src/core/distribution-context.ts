import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TokenPilotDistributionContext, TokenPilotPaths } from "../types.js";

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
  overrides: Partial<TokenPilotDistributionContext> = {}
): TokenPilotDistributionContext {
  const env = process.env;
  const mode =
    overrides.mode ??
    (env.TOKENPILOT_DISTRIBUTION_MODE?.trim() === "packaged" ? "packaged" : "source");
  const installRoot = resolvePath(
    overrides.installRoot ??
      env.TOKENPILOT_INSTALL_ROOT?.trim() ??
      env.TOKENPILOT_REPO_ROOT?.trim() ??
      defaultSourceInstallRoot()
  );
  const supportRoot = defaultPackagedSupportRoot();
  const stateRoot = resolvePath(
    overrides.stateRoot ??
      env.TOKENPILOT_STATE_ROOT?.trim() ??
      (mode === "packaged" ? path.join(supportRoot, "state") : path.join(installRoot, ".tokenpilot"))
  );
  const primaryWorkspaceRoot = resolvePath(
    overrides.primaryWorkspaceRoot ??
      env.TOKENPILOT_PRIMARY_WORKSPACE_ROOT?.trim() ??
      installRoot
  );
  const nodeExecutable = resolvePath(
    overrides.nodeExecutable ?? env.TOKENPILOT_NODE_BIN?.trim() ?? process.execPath
  );
  const configPath = resolvePath(
    overrides.configPath ??
      env.TOKENPILOT_CONFIG_PATH?.trim() ??
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
