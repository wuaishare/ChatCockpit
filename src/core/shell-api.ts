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
  hostPermissionProfile: HostPermissionProfile = DEFAULT_HOST_PERMISSION_PROFILE
): PreparedWorkspaceExecCommand {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const policy = evaluateNativeWorkspaceCommand(payload.command, payload.args);
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
  for (const index of policy.projectPathArgIndexes) {
    args[index] = resolveWorkspaceExecPath(
      repoRoot,
      workdir,
      args[index],
      `command argument ${index}`
    );
  }
  return {
    repoRoot,
    command: policy.commandPath
      ? resolveWorkspaceExecPath(repoRoot, workdir, policy.command, "command")
      : policy.command,
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
  const standaloneReadOnly = policy.effect === "read";
  return {
    repoRoot,
    command: payload.command,
    args: [...policy.args],
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
