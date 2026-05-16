import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TokenPilotPaths } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveRepoRoot(): string {
  return path.resolve(__dirname, "../../");
}

export function buildPaths(repoRoot = resolveRepoRoot()): TokenPilotPaths {
  const workspaceDir = path.join(repoRoot, ".tokenpilot");
  return {
    repoRoot,
    workspaceDir,
    bundlesDir: path.join(workspaceDir, "bundles"),
    jobsDir: path.join(workspaceDir, "jobs"),
    manifestsDir: path.join(workspaceDir, "manifests")
  };
}

export function ensureWorkspaceDirs(paths: TokenPilotPaths): void {
  for (const dir of [
    paths.workspaceDir,
    paths.bundlesDir,
    paths.jobsDir,
    paths.manifestsDir
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
