import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  TokenPilotDistributionContext,
  TokenPilotPaths,
  TokenPilotRepoTargetPaths
} from "../types.js";
import {
  buildDistributionContext,
  buildSourceDistributionContext
} from "./distribution-context.js";
import { productIdentityForKey } from "./product-identity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveRepoRoot(): string {
  return buildDistributionContext().primaryWorkspaceRoot;
}

export function buildPaths(
  input: string | TokenPilotDistributionContext = buildDistributionContext()
): TokenPilotPaths {
  const context =
    typeof input === "string" ? buildSourceDistributionContext(input) : input;
  const workspaceDir = context.stateRoot;
  const jobsDir = path.join(workspaceDir, "jobs");
  const runtimeDir = path.join(workspaceDir, "runtime");
  const identity = productIdentityForKey(context.productIdentity);
  return {
    productIdentity: context.productIdentity,
    repoRoot: context.primaryWorkspaceRoot,
    installRoot: context.installRoot,
    stateRoot: context.stateRoot,
    distributionMode: context.mode,
    nodeExecutable: context.nodeExecutable,
    configPath: context.configPath,
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
    runnerPlistPath: path.join(
      runtimeDir,
      `${identity.launchAgentPrefix}.runner.plist`
    ),
    deviceAgentLogPath: path.join(runtimeDir, "device-agent.log"),
    deviceAgentPidPath: path.join(runtimeDir, "device-agent.pid"),
    deviceAgentPlistPath: path.join(
      runtimeDir,
      `${identity.launchAgentPrefix}.device-agent.plist`
    ),
    processSupervisorSocketPath: path.join(runtimeDir, "process-supervisor.sock"),
    processSupervisorTokenPath: path.join(runtimeDir, "process-supervisor.token"),
    processSupervisorStatusPath: path.join(runtimeDir, "process-supervisor-status.json"),
    processSupervisorPidPath: path.join(runtimeDir, "process-supervisor.pid"),
    processSupervisorLogPath: path.join(runtimeDir, "process-supervisor.log"),
    processSupervisorEventsPath: path.join(runtimeDir, "process-supervisor-events.jsonl"),
    processSupervisorPlistPath: path.join(
      runtimeDir,
      `${identity.launchAgentPrefix}.process-supervisor.plist`
    )
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

export function buildRepoTargetPaths(
  basePaths: Pick<TokenPilotPaths, "runtimeDir">,
  repoId: string,
  repoRoot: string
): TokenPilotRepoTargetPaths {
  const repoWorkspaceRoot = path.join(basePaths.runtimeDir, "repos", repoId);
  return {
    repoRoot,
    workspaceDir: repoWorkspaceRoot,
    bundlesDir: path.join(repoWorkspaceRoot, "bundles"),
    manifestsDir: path.join(repoWorkspaceRoot, "manifests")
  };
}

export function ensureRepoTargetDirs(paths: TokenPilotRepoTargetPaths): void {
  for (const dir of [paths.workspaceDir, paths.bundlesDir, paths.manifestsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
