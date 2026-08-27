import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  evaluateNativeWorkspaceCommand,
  evaluateWorkspaceCommand
} from "./command-policy.js";
import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import { resolvePathInsideRoot } from "./path-guards.js";
import type {
  ShellRunPayload,
  ShellRunResponse,
  TokenPilotPaths,
  WorkspaceExecPayload
} from "../types.js";

// ── Security constants ──
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 25_000; // GPT Action 超时 ~30s，留 5s 余量

function assertRepoAllowed(paths: TokenPilotPaths, repoId: string): string {
  const config = loadUserConfigForPaths(paths);
  return resolveRepoMapping(config, repoId).repoRoot;
}

function resolveWorkDir(repoRoot: string, workdir?: string): string {
  if (!workdir) return repoRoot;
  return resolvePathInsideRoot(repoRoot, workdir, "workdir").absolutePath;
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
}

export interface PreparedWorkspaceExecCommand {
  repoRoot: string;
  command: string;
  args: string[];
  workdir: string;
  readOnly: boolean;
}

export function prepareWorkspaceExecCommand(
  paths: TokenPilotPaths,
  payload: WorkspaceExecPayload
): PreparedWorkspaceExecCommand {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const policy = evaluateNativeWorkspaceCommand(payload.command, payload.args);
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
    readOnly: policy.effect === "read"
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
    timeoutMs: COMMAND_TIMEOUT_MS,
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
    standaloneReadOnly
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
  const stdout = (result.stdout ?? "").slice(0, MAX_OUTPUT_BYTES);
  const stderr = (result.stderr ?? "").slice(0, MAX_OUTPUT_BYTES);
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
