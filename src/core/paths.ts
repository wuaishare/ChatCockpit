import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TokenPilotPaths } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveRepoRoot(): string {
  const envRepoRoot = process.env.TOKENPILOT_REPO_ROOT?.trim();
  if (envRepoRoot) {
    return path.resolve(envRepoRoot);
  }
  return path.resolve(__dirname, "../../");
}

export function buildPaths(repoRoot = resolveRepoRoot()): TokenPilotPaths {
  const workspaceDir = path.join(repoRoot, ".tokenpilot");
  const jobsDir = path.join(workspaceDir, "jobs");
  const runtimeDir = path.join(workspaceDir, "runtime");
  return {
    repoRoot,
    workspaceDir,
    bundlesDir: path.join(workspaceDir, "bundles"),
    jobsDir,
    queuedJobsDir: path.join(jobsDir, "queued"),
    runningJobsDir: path.join(jobsDir, "running"),
    completedJobsDir: path.join(jobsDir, "completed"),
    failedJobsDir: path.join(jobsDir, "failed"),
    manifestsDir: path.join(workspaceDir, "manifests"),
    runtimeDir,
    runnerStatusPath: path.join(runtimeDir, "runner-status.json"),
    runnerLogPath: path.join(runtimeDir, "runner.log"),
    runnerPidPath: path.join(runtimeDir, "runner.pid"),
    runnerPlistPath: path.join(runtimeDir, "com.wuaishare.tokenpilot.runner.plist")
  };
}

export function ensureWorkspaceDirs(paths: TokenPilotPaths): void {
  for (const dir of [
    paths.workspaceDir,
    paths.bundlesDir,
    paths.jobsDir,
    paths.queuedJobsDir,
    paths.runningJobsDir,
    paths.completedJobsDir,
    paths.failedJobsDir,
    paths.manifestsDir,
    paths.runtimeDir
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
