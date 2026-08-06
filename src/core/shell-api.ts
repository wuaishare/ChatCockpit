import { spawnSync } from "node:child_process";
import path from "node:path";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
import { resolvePathInsideRoot } from "./path-guards.js";
import type {
  ShellRunPayload,
  ShellRunResponse,
  TokenPilotPaths
} from "../types.js";

// ── Security constants ──
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 25_000; // GPT Action 超时 ~30s，留 5s 余量

// ── Command whitelist ──
// Each command maps to allowed subcommands/patterns.
// "*" means any args are allowed (subject to arg validation).
// This is intentionally narrow — add commands as needed.

const COMMAND_WHITELIST: Record<string, string[]> = {
  // Node.js ecosystem
  "npm":        ["run", "test", "install", "ci", "build", "lint", "typecheck", "start", "dev"],
  "npx":        ["*"],     // npx can run anything, but args validated below
  "pnpm":       ["run", "test", "install", "build", "lint"],
  "yarn":       ["run", "test", "install", "build", "lint"],
  "node":       ["*"],     // Running scripts — path validated below
  "tsx":        ["*"],     // TypeScript runner

  // Linting / formatting
  "tsc":        ["--noEmit", "--project", "-p", "--version"],
  "eslint":     ["*"],
  "prettier":   ["--check", "--write", "--list-different"],

  // Testing
  "vitest":     ["run", "--run"],
  "jest":       ["--passWithNoTests"],

  // Python
  "python":     ["*"],
  "python3":    ["*"],

  // Build tools
  "make":       ["*"],
  "cargo":      ["build", "test", "check", "clippy", "fmt", "run"],
  "go":         ["build", "test", "vet", "fmt", "run"],

  // Version control (dedicated endpoints exist, but useful for edge cases)
  "git":        ["status", "diff", "log", "branch", "add", "restore", "stash", "show", "rev-parse", "rev-list"],
};

const HIGH_TRUST_COMMANDS = new Set(["node", "python", "python3", "npx", "tsx", "make"]);

// ── Argument validation ──
// These checks prevent path traversal and obvious shell injection even though
// we use spawnSync (not a shell). Extra defense in depth.

// spawnSync bypasses the shell — only path-safety patterns are relevant.
// Shell metacharacters (;, |, &, $, `, >, <) are harmless inside spawn args.
const DANGEROUS_ARG_PATTERNS = [
  /^~/,           // home directory expansion
  /\.\./,         // path traversal
];

function validateArgs(args: string[]): void {
  for (const arg of args) {
    if (!arg || typeof arg !== "string") {
      throw new Error("Each argument must be a non-empty string");
    }

    if (arg.length > 2048) {
      throw new Error("Argument exceeds maximum length of 2048 characters");
    }

    for (const pattern of DANGEROUS_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        throw new Error(
          `Argument contains disallowed characters: ${JSON.stringify(arg.slice(0, 80))}`
        );
      }
    }

    // Block absolute paths (except well-known tool paths)
    if (path.isAbsolute(arg) && !arg.startsWith("/usr/") && !arg.startsWith("/bin/")) {
      throw new Error("Absolute paths are not allowed in command arguments");
    }
  }
}

function assertRepoAllowed(paths: TokenPilotPaths, repoId: string): string {
  const config = loadUserConfig(paths.repoRoot);
  return resolveRepoMapping(config, repoId).repoRoot;
}

function envFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

function assertHighTrustCommandAllowed(command: string): void {
  if (!HIGH_TRUST_COMMANDS.has(command)) {
    return;
  }

  const exposed = envFlagEnabled(process.env.TOKENPILOT_EXPOSED);
  const explicitlyAllowed = envFlagEnabled(process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS);
  if (exposed && !explicitlyAllowed) {
    throw new Error(
      `High-trust command ${command} is blocked in exposed mode. ` +
      "Set TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS=true only in a private authenticated operator environment."
    );
  }
}

function resolveWorkDir(repoRoot: string, workdir?: string): string {
  if (!workdir) return repoRoot;
  return resolvePathInsideRoot(repoRoot, workdir, "workdir").absolutePath;
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

const STANDALONE_READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "rev-list"
]);

export function prepareShellCommand(
  paths: TokenPilotPaths,
  payload: ShellRunPayload
): PreparedShellCommand {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const allowedSubcommands = COMMAND_WHITELIST[payload.command];
  if (!allowedSubcommands) {
    throw new Error(
      `Command not allowed: ${payload.command}. ` +
      `Allowed commands: ${Object.keys(COMMAND_WHITELIST).join(", ")}`
    );
  }
  assertHighTrustCommandAllowed(payload.command);
  if (!allowedSubcommands.includes("*")) {
    const subcommand = payload.args[0];
    if (!subcommand || !allowedSubcommands.includes(subcommand)) {
      throw new Error(
        `Subcommand not allowed for ${payload.command}: ${subcommand ?? "<none>"}. ` +
        `Allowed: ${allowedSubcommands.join(", ")}`
      );
    }
  }
  validateArgs(payload.args);
  const workdir = resolveWorkDir(repoRoot, payload.workdir);
  const standaloneReadOnly =
    payload.command === "git" &&
    STANDALONE_READ_ONLY_GIT_SUBCOMMANDS.has(payload.args[0] ?? "");
  return {
    repoRoot,
    command: payload.command,
    args: [...payload.args],
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
