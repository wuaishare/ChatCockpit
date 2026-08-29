import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateNativeWorkspaceCommand,
  evaluateWorkspaceCommand,
  isBuiltinHostNpmScript,
  isHostManagedWorkspaceCommand
} from "./command-policy.js";
import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import {
  DEFAULT_HOST_PERMISSION_PROFILE,
  type HostPermissionProfile
} from "./host-permission-policy.js";
import {
  DEFAULT_WORKSPACE_EXECUTION_PROFILE,
  type WorkspaceExecutionProfile
} from "./workspace-execution-policy.js";
import { resolvePathInsideRoot } from "./path-guards.js";
import type {
  ShellRunPayload,
  ShellRunResponse,
  TokenPilotPaths,
  WorkspaceExecPayload
} from "../types.js";

// ── Security constants ──
const MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
export const MAX_COMMAND_TIMEOUT_MS = 120_000;
const LOCAL_ABSOLUTE_PATH = /(?:file:\/\/\/(?:Users|home|Applications|Volumes|private|var|tmp)\/[^\s,;:)"'`]+|\/(?:Users|home|Applications|Volumes|private|var|tmp)\/[^\s,;:)"'`]+|\b[A-Za-z]:\\[^\s,;:)"'`]+)/g;

export function publicSafeShellOutput(value: string, repoRoot: string): string {
  let output = value;
  const workspaceRoots = new Set<string>([repoRoot]);
  try {
    workspaceRoots.add(fs.realpathSync(repoRoot));
  } catch {
    // Keep the configured root when the filesystem cannot resolve a canonical path.
  }
  for (const root of [...workspaceRoots]) {
    if (root.startsWith("/private/")) {
      workspaceRoots.add(root.slice("/private".length));
    } else if (root.startsWith("/var/") || root.startsWith("/tmp/")) {
      workspaceRoots.add(`/private${root}`);
    }
  }
  for (const root of [...workspaceRoots].filter(Boolean).sort((a, b) => b.length - a.length)) {
    output = output.replaceAll(pathToFileURL(root).href, "[workspace]");
    output = output.replaceAll(root, "[workspace]");
  }
  const home = process.env.HOME;
  if (home) {
    output = output.replaceAll(pathToFileURL(home).href, "[local-home]");
    output = output.replaceAll(home, "[local-home]");
  }
  return output.replace(LOCAL_ABSOLUTE_PATH, "[local-path-hidden]");
}

function assertRepoAllowed(paths: TokenPilotPaths, repoId: string): string {
  const config = loadUserConfigForPaths(paths);
  return resolveRepoMapping(config, repoId).repoRoot;
}

function resolveWorkDir(repoRoot: string, workdir?: string): string {
  if (!workdir) return repoRoot;
  return resolvePathInsideRoot(repoRoot, workdir, "workdir").absolutePath;
}

export function resolveShellCommandTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined) return DEFAULT_COMMAND_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_COMMAND_TIMEOUT_MS) {
    throw new Error(
      `timeoutMs must be an integer between 1000 and ${MAX_COMMAND_TIMEOUT_MS}`
    );
  }
  return timeoutMs;
}

function resolveWorkspaceExecPath(
  repoRoot: string,
  workdir: string,
  input: string,
  label: string
): string {
  const candidate = path.resolve(workdir, input);
  const repoRelative = path.relative(repoRoot, candidate).replaceAll("\\", "/");
  return resolvePathInsideRoot(repoRoot, repoRelative, label).absolutePath;
}

function existingWorkspaceArgumentPath(arg: string): string | null {
  let candidate = arg;
  if (candidate.startsWith("@") && candidate.length > 1) {
    candidate = candidate.slice(1);
  } else if (candidate.startsWith("-") && candidate.includes("=")) {
    candidate = candidate.slice(candidate.indexOf("=") + 1);
  } else if (candidate.startsWith("-")) {
    return null;
  }
  if (
    !candidate ||
    candidate.includes("://") ||
    /\s/.test(candidate) ||
    path.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate)
  ) {
    return null;
  }
  return candidate;
}

function assertExistingWorkspaceArgumentContainment(
  repoRoot: string,
  workdir: string,
  args: string[]
): void {
  args.forEach((arg, index) => {
    const relativeCandidate = existingWorkspaceArgumentPath(arg);
    if (!relativeCandidate) return;
    const candidate = path.resolve(workdir, relativeCandidate);
    if (!fs.existsSync(candidate)) return;
    resolveWorkspaceExecPath(
      repoRoot,
      workdir,
      relativeCandidate,
      `command argument ${index}`
    );
  });
}

function governedWorkspaceToolSearchDirectories(
  includeDevelopmentPath = false
): string[] {
  const platformDefaults =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
      : process.platform === "linux"
        ? ["/usr/local/bin", "/usr/bin", "/bin"]
        : [];
  const inherited = includeDevelopmentPath
    ? (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter((entry) => entry.length > 0 && path.isAbsolute(entry))
    : [];
  return [...new Set([path.dirname(process.execPath), ...platformDefaults, ...inherited])];
}

export function resolveGovernedWorkspaceToolCommand(
  command: string,
  searchDirectories: string[] = governedWorkspaceToolSearchDirectories(false)
): string {
  if (command.includes("/") || command.includes("\\")) return command;
  const executableNames =
    process.platform === "win32" && !/\.[A-Za-z0-9]+$/.test(command)
      ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
      : [command];
  for (const directory of searchDirectories) {
    if (!path.isAbsolute(directory)) continue;
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        const canonical = fs.realpathSync.native(candidate);
        if (fs.statSync(canonical).isFile()) return canonical;
      } catch {
        // Continue through the governed development toolchain search path.
      }
    }
  }
  return command;
}

export interface PreparedShellCommand {
  repoRoot: string;
  command: string;
  args: string[];
  workdir: string;
  timeoutMs: number;
  outputBytesCap: number;
  environment: Record<string, string>;
  standaloneReadOnly: boolean;
  gitMetadataWrite: boolean;
  hostRuntimeAccess: boolean;
}

export interface PreparedWorkspaceExecCommand {
  repoRoot: string;
  command: string;
  args: string[];
  workdir: string;
  readOnly: boolean;
  executionMode: "native-sandbox" | "host-managed";
}

export function prepareWorkspaceExecCommand(
  paths: TokenPilotPaths,
  payload: WorkspaceExecPayload,
  workspaceExecutionProfile: WorkspaceExecutionProfile = DEFAULT_WORKSPACE_EXECUTION_PROFILE,
  hostPermissionProfile: HostPermissionProfile = DEFAULT_HOST_PERMISSION_PROFILE
): PreparedWorkspaceExecCommand {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const policy = evaluateNativeWorkspaceCommand(
    payload.command,
    payload.args,
    workspaceExecutionProfile
  );
  const executionMode = payload.executionMode ?? "native-sandbox";
  if (
    executionMode === "host-managed" &&
    !isHostManagedWorkspaceCommand(policy.command, policy.args, hostPermissionProfile)
  ) {
    throw new Error(
      "Host-managed workspace execution is limited to explicitly allowlisted macOS build scripts"
    );
  }
  const workdir = resolveWorkDir(repoRoot, payload.workdir);
  const args = [...policy.args];
  assertExistingWorkspaceArgumentContainment(repoRoot, workdir, args);
  for (const index of policy.projectPathArgIndexes) {
    args[index] = resolveWorkspaceExecPath(
      repoRoot,
      workdir,
      args[index],
      `command argument ${index}`
    );
  }
  const toolSearchDirectories =
    workspaceExecutionProfile === "development"
      ? [
          path.join(workdir, "node_modules", ".bin"),
          ...(workdir === repoRoot
            ? []
            : [path.join(repoRoot, "node_modules", ".bin")]),
          ...governedWorkspaceToolSearchDirectories(true)
        ]
      : governedWorkspaceToolSearchDirectories(false);
  const command = policy.commandPath
    ? resolveWorkspaceExecPath(repoRoot, workdir, policy.command, "command")
    : resolveGovernedWorkspaceToolCommand(policy.command, toolSearchDirectories);
  return {
    repoRoot,
    command,
    args,
    workdir,
    readOnly: policy.effect === "read",
    executionMode
  };
}

export function prepareShellCommand(
  paths: TokenPilotPaths,
  payload: ShellRunPayload
): PreparedShellCommand {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const policy = evaluateWorkspaceCommand(payload.command, payload.args);
  const workdir = resolveWorkDir(repoRoot, payload.workdir);
  const args = [...policy.args];
  for (const index of policy.projectPathArgIndexes ?? []) {
    args[index] = resolveWorkspaceExecPath(
      repoRoot,
      workdir,
      args[index],
      `command argument ${index}`
    );
  }
  const standaloneReadOnly = policy.effect === "read";
  return {
    repoRoot,
    command: resolveGovernedWorkspaceToolCommand(policy.command),
    args,
    workdir,
    timeoutMs: resolveShellCommandTimeoutMs(payload.timeoutMs),
    outputBytesCap: MAX_OUTPUT_BYTES,
    environment: {
      HOME: process.env.HOME || "",
      PATH: [path.dirname(process.execPath), process.env.PATH || ""]
        .filter(Boolean)
        .join(path.delimiter),
      LANG: "en_US.UTF-8",
      NODE: process.execPath,
      ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {})
    },
    standaloneReadOnly,
    gitMetadataWrite: payload.command === "git" && policy.effect === "write",
    hostRuntimeAccess: isBuiltinHostNpmScript(payload.command, policy.args)
  };
}

export function runShellCommand(
  paths: TokenPilotPaths,
  payload: ShellRunPayload
): ShellRunResponse {
  const prepared = prepareShellCommand(paths, payload);
  const startTime = Date.now();
  let result;
  try {
    result = spawnSync(prepared.command, prepared.args, {
      cwd: prepared.workdir,
      encoding: "utf8",
      timeout: prepared.timeoutMs,
      maxBuffer: prepared.outputBytesCap * 2,
      env: prepared.environment
    });
  } catch (err) {
    throw new Error(
      `Command execution failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const elapsed = Date.now() - startTime;
  const rawStdout = (result.stdout ?? "").slice(0, MAX_OUTPUT_BYTES);
  const rawStderr = (result.stderr ?? "").slice(0, MAX_OUTPUT_BYTES);
  const stdout = publicSafeShellOutput(rawStdout, prepared.repoRoot);
  const stderr = publicSafeShellOutput(rawStderr, prepared.repoRoot);
  const truncated =
    (result.stdout?.length ?? 0) > MAX_OUTPUT_BYTES ||
    (result.stderr?.length ?? 0) > MAX_OUTPUT_BYTES;

  const exitCode = result.signal
    ? (result.signal === "SIGTERM" ? 143 : 1)
    : (result.status ?? 1);

  return {
    ok: exitCode === 0,
    exitCode,
    stdout: stdout || (exitCode === 0 ? "(no output)" : ""),
    stderr,
    truncated,
    executedCommand: `${payload.command} ${payload.args.join(" ")} (${elapsed}ms)`
  };
}
