import { spawnSync } from "node:child_process";
import path from "node:path";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
import type {
  ShellRunPayload,
  ShellRunResponse,
  TokenPilotPaths
} from "../types.js";

// ── Security constants ──
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

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

// ── Argument validation ──
// These checks prevent path traversal and obvious shell injection even though
// we use spawnSync (not a shell). Extra defense in depth.

const DANGEROUS_ARG_PATTERNS = [
  /^~/,           // home directory expansion
  /\.\./,         // path traversal
  /[\|\&\;]/,     // shell metacharacters
  /[\`\$]/,       // command substitution / variable expansion
  /[\>\<]/,       // redirect operators
  /\n/,           // newlines in args
  /\r/,           // carriage returns
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

function resolveWorkDir(repoRoot: string, workdir?: string): string {
  if (!workdir) return repoRoot;

  const resolved = path.resolve(repoRoot, workdir);
  const normalizedRepoRoot = path.resolve(repoRoot);

  if (!resolved.startsWith(normalizedRepoRoot)) {
    throw new Error("workdir must be within the repository");
  }

  return resolved;
}

export function runShellCommand(
  paths: TokenPilotPaths,
  payload: ShellRunPayload
): ShellRunResponse {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);

  // 1. Validate command is in whitelist
  const allowedSubcommands = COMMAND_WHITELIST[payload.command];
  if (!allowedSubcommands) {
    throw new Error(
      `Command not allowed: ${payload.command}. ` +
      `Allowed commands: ${Object.keys(COMMAND_WHITELIST).join(", ")}`
    );
  }

  // 2. Validate subcommand
  if (!allowedSubcommands.includes("*")) {
    const subcommand = payload.args[0];
    if (!subcommand || !allowedSubcommands.includes(subcommand)) {
      throw new Error(
        `Subcommand not allowed for ${payload.command}: ${subcommand ?? "<none>"}. ` +
        `Allowed: ${allowedSubcommands.join(", ")}`
      );
    }
  }

  // 3. Validate all arguments
  validateArgs(payload.args);

  // 4. Resolve working directory
  const workdir = resolveWorkDir(repoRoot, payload.workdir);

  // 5. Execute
  const startTime = Date.now();
  let result;
  try {
    result = spawnSync(payload.command, payload.args, {
      cwd: workdir,
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES * 2,
      env: {
        // Stripped-down environment — no secrets
        HOME: process.env.HOME || "",
        PATH: process.env.PATH || "",
        LANG: "en_US.UTF-8",
        NODE: process.execPath,
        // Project-critical vars
        ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {}),
      },
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
