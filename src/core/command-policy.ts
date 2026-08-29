import path from "node:path";

import { readIdentityEnv } from "./identity-env.js";
import {
  DEFAULT_HOST_PERMISSION_PROFILE,
  fullHostCommandsAllowed,
  hostDeviceDiagnosticsAllowed,
  hostManagedWorkspaceAllowed,
  type HostPermissionProfile
} from "./host-permission-policy.js";

export type CommandEffect = "read" | "write";

export interface CommandPolicyDecision {
  command: string;
  args: string[];
  effect: CommandEffect;
}

const WORKSPACE_COMMAND_WHITELIST: Record<string, string[]> = {
  npm: ["run", "test", "install", "ci", "audit", "build", "lint", "typecheck", "start", "dev"],
  npx: ["*"],
  pnpm: ["run", "test", "install", "build", "lint"],
  yarn: ["run", "test", "install", "build", "lint"],
  node: ["*"],
  tsx: ["*"],
  tsc: ["--noEmit", "--project", "-p", "--version"],
  eslint: ["*"],
  prettier: ["--check", "--write", "--list-different"],
  vitest: ["run", "--run"],
  jest: ["--passWithNoTests"],
  python: ["*"],
  python3: ["*"],
  make: ["*"],
  cargo: ["build", "test", "check", "clippy", "fmt", "run"],
  go: ["build", "test", "vet", "fmt", "run"],
  git: ["status", "diff", "log", "branch", "restore", "stash", "show", "rev-parse", "rev-list", "fetch", "rebase", "push"]
};

const HIGH_TRUST_COMMANDS = new Set([
  "node",
  "python",
  "python3",
  "npx",
  "tsx",
  "make"
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "rev-list"
]);

const NATIVE_WORKSPACE_GIT_SUBCOMMANDS = new Set([
  "am", "apply", "archive", "bisect", "blame", "branch", "bundle",
  "cat-file", "checkout", "cherry-pick", "clean", "clone", "commit", "describe",
  "diff", "fetch", "for-each-ref", "format-patch", "gc", "grep", "init", "log",
  "ls-files", "ls-tree", "maintenance", "merge", "merge-base", "mv", "name-rev",
  "notes", "prune", "pull", "push", "rebase", "reflog", "remote", "replace",
  "reset", "restore", "rev-list", "rev-parse", "revert", "rm", "show",
  "sparse-checkout", "stash", "status", "submodule", "switch", "tag",
  "update-ref", "worktree"
]);

const NATIVE_WORKSPACE_READ_ONLY_GIT_SUBCOMMANDS = new Set([
  ...READ_ONLY_GIT_SUBCOMMANDS,
  "blame", "grep", "ls-files", "ls-tree", "cat-file", "for-each-ref",
  "describe", "name-rev", "merge-base"
]);

const NATIVE_WORKSPACE_PROJECT_COMMANDS = new Set(
  Object.keys(WORKSPACE_COMMAND_WHITELIST).filter((command) => command !== "git")
);
const NATIVE_WORKSPACE_SCRIPT_COMMANDS = new Set(["node", "python", "python3", "tsx"]);
const BUILTIN_HOST_NPM_SCRIPTS = new Set([
  "doctor:runtime",
  "mvp:start",
  "start:local",
  "mvp:stop",
  "stop:local",
  "mvp:restart",
  "mvp:status",
  "mvp:reset",
  "reset:local"
]);
const HOST_MANAGED_WORKSPACE_NPM_SCRIPTS = new Set([
  "build:macos-desktop",
  "build:macos-runtime"
]);
const MAX_COMMAND_LENGTH = 1024;

export function isBuiltinHostNpmScript(command: string, args: string[]): boolean {
  return command === "npm" && args[0] === "run" && BUILTIN_HOST_NPM_SCRIPTS.has(args[1] ?? "");
}

export function isHostManagedWorkspaceCommand(
  command: string,
  args: string[],
  profile: HostPermissionProfile = DEFAULT_HOST_PERMISSION_PROFILE
): boolean {
  return (
    hostManagedWorkspaceAllowed(profile) &&
    command === "npm" &&
    args.length === 2 &&
    args[0] === "run" &&
    HOST_MANAGED_WORKSPACE_NPM_SCRIPTS.has(args[1] ?? "")
  );
}

const NPM_AUDIT_LEVEL_OPTION = /^--audit-level=(?:low|moderate|high|critical)$/;

function assertSafeNpmAuditArgs(args: string[]): void {
  if (args[0] !== "audit") return;
  if (args.length === 1) return;
  if (args.length === 2 && NPM_AUDIT_LEVEL_OPTION.test(args[1] ?? "")) return;
  throw new Error(
    "npm audit is limited to a read-only report with optional --audit-level=low|moderate|high|critical"
  );
}

const PURE_HOST_GIT_SUBCOMMANDS = READ_ONLY_GIT_SUBCOMMANDS;
const PURE_HOST_LS_OPTION = /^(?:--|-?[AaCcdFfghiklmnopqrstuvwx1]+)$/;
const MAX_COMMAND_ARGS = 64;
const MAX_ARG_LENGTH = 2048;

function envFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

function assertHighTrustCommandAllowed(command: string): void {
  if (!HIGH_TRUST_COMMANDS.has(command)) {
    return;
  }
  const exposed = envFlagEnabled(readIdentityEnv("EXPOSED"));
  const explicitlyAllowed = envFlagEnabled(readIdentityEnv("ALLOW_HIGH_TRUST_COMMANDS"));
  if (exposed && !explicitlyAllowed) {
    throw new Error(
      `High-trust command ${command} is blocked in exposed mode. ` +
        "Set CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS=true only in a private authenticated operator environment."
    );
  }
}

function assertNativeWorkspaceProjectCodeAllowed(command: string): void {
  const exposed = envFlagEnabled(readIdentityEnv("EXPOSED"));
  const explicitlyAllowed = envFlagEnabled(readIdentityEnv("ALLOW_HIGH_TRUST_COMMANDS"));
  if (exposed && !explicitlyAllowed) {
    throw new Error(
      `Native workspace project-code command ${command} is blocked in exposed mode. ` +
        "Set CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS=true only for an authenticated operator environment that trusts the selected project code."
    );
  }
}

export function validateCommandArgs(args: string[]): string[] {
  if (!Array.isArray(args)) {
    throw new Error("Command args must be an array");
  }
  if (args.length > MAX_COMMAND_ARGS) {
    throw new Error(`Command args exceed maximum count of ${MAX_COMMAND_ARGS}`);
  }
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new Error("Each argument must be a non-empty string");
    }
    if (arg.length > MAX_ARG_LENGTH) {
      throw new Error(`Argument exceeds maximum length of ${MAX_ARG_LENGTH} characters`);
    }
    if (arg.includes("\0")) {
      throw new Error("Command arguments cannot contain NUL bytes");
    }
    if (/^~/.test(arg) || /(^|[\\/])\.\.([\\/]|$)/.test(arg)) {
      throw new Error(
        `Argument contains a blocked path form: ${JSON.stringify(arg.slice(0, 80))}`
      );
    }
    if (
      path.isAbsolute(arg) &&
      !arg.startsWith("/usr/") &&
      !arg.startsWith("/bin/")
    ) {
      throw new Error("Absolute paths are not allowed in command arguments");
    }
  }
  return [...args];
}

export function evaluateWorkspaceCommand(
  command: string,
  args: string[]
): CommandPolicyDecision {
  const allowedSubcommands = WORKSPACE_COMMAND_WHITELIST[command];
  if (!allowedSubcommands) {
    throw new Error(
      `Command not allowed: ${command}. ` +
        `Allowed commands: ${Object.keys(WORKSPACE_COMMAND_WHITELIST).join(", ")}`
    );
  }
  assertHighTrustCommandAllowed(command);
  const safeArgs = validateCommandArgs(args);
  if (!allowedSubcommands.includes("*")) {
    const subcommand = safeArgs[0];
    if (!subcommand || !allowedSubcommands.includes(subcommand)) {
      throw new Error(
        `Subcommand not allowed for ${command}: ${subcommand ?? "<none>"}. ` +
          `Allowed: ${allowedSubcommands.join(", ")}`
      );
    }
  }
  if (command === "npm") {
    assertSafeNpmAuditArgs(safeArgs);
  }
  if (command === "git") {
    const subcommand = safeArgs[0] ?? "";
    if (
      subcommand === "fetch" &&
      !(safeArgs.length === 1 || (safeArgs.length === 2 && safeArgs[1] === "--prune"))
    ) {
      throw new Error("git fetch is limited to the configured upstream; only optional --prune is allowed");
    }
    if (
      subcommand === "rebase" &&
      !(safeArgs.length === 2 && safeArgs[1] === "@{upstream}")
    ) {
      throw new Error("git rebase is limited to @{upstream}");
    }
    if (subcommand === "push" && safeArgs.length !== 1) {
      throw new Error("git push uses the configured upstream and does not accept additional arguments");
    }
  }
  const effect: CommandEffect =
    command === "git" && READ_ONLY_GIT_SUBCOMMANDS.has(safeArgs[0] ?? "")
      ? "read"
      : command === "npm" && safeArgs[0] === "audit"
        ? "read"
        : "write";
  return { command, args: safeArgs, effect };
}

function nativeWorkspacePathLooksAbsolute(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^~(?:[\\/]|$)/.test(value) ||
    /^file:\/\//i.test(value)
  );
}

function validateNativeWorkspaceArgs(args: string[]): string[] {
  const safeArgs = validateCommandArgs(args);
  for (const arg of safeArgs) {
    if (nativeWorkspacePathLooksAbsolute(arg)) {
      throw new Error("Native workspace command paths must be workspace-relative");
    }
    const equalsIndex = arg.indexOf("=");
    if (arg.startsWith("-") && equalsIndex > 0) {
      const optionValue = arg.slice(equalsIndex + 1);
      if (nativeWorkspacePathLooksAbsolute(optionValue)) {
        throw new Error("Native workspace command option paths must be workspace-relative");
      }
    }
    if (arg.startsWith("@") && nativeWorkspacePathLooksAbsolute(arg.slice(1))) {
      throw new Error("Native workspace response-file paths must be workspace-relative");
    }
  }
  return safeArgs;
}

function isNativeWorkspaceRelativeExecutable(command: string): boolean {
  if (!command.includes("/")) return false;
  if (nativeWorkspacePathLooksAbsolute(command) || command.includes("\\")) return false;
  const normalized = path.posix.normalize(command);
  return !(normalized === ".." || normalized.startsWith("../") || normalized.includes("/../"));
}

export interface NativeWorkspaceCommandPolicyDecision extends CommandPolicyDecision {
  commandPath: boolean;
  projectPathArgIndexes: number[];
}

export function evaluateNativeWorkspaceCommand(
  command: string,
  args: string[]
): NativeWorkspaceCommandPolicyDecision {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    command.length > MAX_COMMAND_LENGTH ||
    command.includes("\0")
  ) {
    throw new Error("Native workspace command is invalid");
  }
  const safeArgs = validateNativeWorkspaceArgs(args);
  const commandPath = isNativeWorkspaceRelativeExecutable(command);

  if (command === "git") {
    const subcommand = safeArgs[0] ?? "";
    if (!subcommand || subcommand.startsWith("-")) {
      throw new Error("Native workspace git global options are not allowed; use the workspace cwd instead");
    }
    if (!NATIVE_WORKSPACE_GIT_SUBCOMMANDS.has(subcommand)) {
      throw new Error(`Native workspace git subcommand is not allowed: ${subcommand}`);
    }
    if (subcommand === "submodule" && safeArgs[1] === "foreach") {
      throw new Error("Native workspace git submodule foreach is not allowed");
    }
    if (subcommand === "apply" && safeArgs.includes("--unsafe-paths")) {
      throw new Error("Native workspace git apply --unsafe-paths is not allowed");
    }
    return {
      command,
      args: safeArgs,
      effect: NATIVE_WORKSPACE_READ_ONLY_GIT_SUBCOMMANDS.has(subcommand) ? "read" : "write",
      commandPath: false,
      projectPathArgIndexes: []
    };
  }

  if (commandPath) {
    assertNativeWorkspaceProjectCodeAllowed(command);
    return { command, args: safeArgs, effect: "write", commandPath: true, projectPathArgIndexes: [] };
  }

  if (isBuiltinHostNpmScript(command, safeArgs)) {
    throw new Error("Host Runtime npm scripts require the builtin host execution lane");
  }

  const allowedSubcommands = WORKSPACE_COMMAND_WHITELIST[command];
  if (!NATIVE_WORKSPACE_PROJECT_COMMANDS.has(command) || !allowedSubcommands) {
    throw new Error(`Native workspace command is not allowed: ${command}`);
  }
  assertNativeWorkspaceProjectCodeAllowed(command);
  if (!allowedSubcommands.includes("*")) {
    const subcommand = safeArgs[0];
    if (!subcommand || !allowedSubcommands.includes(subcommand)) {
      throw new Error(`Native workspace subcommand is not allowed for ${command}: ${subcommand ?? "<none>"}`);
    }
  }
  if (command === "npm" && safeArgs[0] === "audit") {
    assertSafeNpmAuditArgs(safeArgs);
    return {
      command,
      args: safeArgs,
      effect: "read",
      commandPath: false,
      projectPathArgIndexes: []
    };
  }
  const projectPathArgIndexes: number[] = [];
  if (NATIVE_WORKSPACE_SCRIPT_COMMANDS.has(command)) {
    const script = safeArgs[0];
    if (!script || script.startsWith("-") || nativeWorkspacePathLooksAbsolute(script)) {
      throw new Error(`${command} requires a relative project script; inline evaluation is not allowed`);
    }
    projectPathArgIndexes.push(0);
  }
  return { command, args: safeArgs, effect: "write", commandPath: false, projectPathArgIndexes };
}

export interface PureHostCommandPolicyDecision extends CommandPolicyDecision {
  relativePathArgs: string[];
}

const HOST_DIAGNOSTIC_DF_OPTION = /^-[hHkmgP]+$/;
const HOST_DIAGNOSTIC_DU_OPTION = /^-[hksmgxa]+$/;
const HOST_DIAGNOSTIC_DU_DEPTH_OPTION = /^-d[0-4]$/;
const HOST_DIAGNOSTIC_UNAME_OPTION = /^-[amnprsv]+$/;
const HOST_DIAGNOSTIC_SYSTEM_PROFILER_TYPES = new Set([
  "SPHardwareDataType",
  "SPMemoryDataType",
  "SPNVMeDataType",
  "SPSoftwareDataType",
  "SPStorageDataType"
]);
const FULL_HOST_BLOCKED_COMMANDS = new Set([
  "bash",
  "csh",
  "dash",
  "env",
  "fish",
  "ksh",
  "node",
  "osascript",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
  "sh",
  "sudo",
  "tcsh",
  "zsh"
]);

function evaluateDeviceDiagnosticCommand(
  command: string,
  safeArgs: string[]
): PureHostCommandPolicyDecision | null {
  if (command === "df") {
    const relativePathArgs: string[] = [];
    for (const arg of safeArgs) {
      if (arg.startsWith("-")) {
        if (!HOST_DIAGNOSTIC_DF_OPTION.test(arg)) {
          throw new Error(`Pure Host df option is not allowed: ${arg}`);
        }
      } else {
        relativePathArgs.push(arg);
      }
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs };
  }

  if (command === "du") {
    const relativePathArgs: string[] = [];
    let expectsDepth = false;
    for (const arg of safeArgs) {
      if (expectsDepth) {
        if (!/^[0-4]$/.test(arg)) {
          throw new Error("Pure Host du depth must be an integer between 0 and 4");
        }
        expectsDepth = false;
        continue;
      }
      if (arg === "-d") {
        expectsDepth = true;
        continue;
      }
      if (arg.startsWith("-")) {
        if (
          !HOST_DIAGNOSTIC_DU_OPTION.test(arg) &&
          !HOST_DIAGNOSTIC_DU_DEPTH_OPTION.test(arg)
        ) {
          throw new Error(`Pure Host du option is not allowed: ${arg}`);
        }
        continue;
      }
      relativePathArgs.push(arg);
    }
    if (expectsDepth) {
      throw new Error("Pure Host du -d requires a depth between 0 and 4");
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs };
  }

  if (command === "diskutil") {
    const operation = safeArgs[0];
    if (operation === "list" && safeArgs.length === 1) {
      return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
    }
    if (
      operation === "info" &&
      safeArgs.length === 2 &&
      /^[A-Za-z0-9._-]+$/.test(safeArgs[1] ?? "")
    ) {
      return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
    }
    throw new Error("Pure Host diskutil is limited to list and info <disk-identifier>");
  }

  if (command === "system_profiler") {
    if (safeArgs.length === 0) {
      throw new Error("Pure Host system_profiler requires an allowlisted data type");
    }
    for (const arg of safeArgs) {
      if (arg === "-json") continue;
      if (!HOST_DIAGNOSTIC_SYSTEM_PROFILER_TYPES.has(arg)) {
        throw new Error(`Pure Host system_profiler data type is not allowed: ${arg}`);
      }
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
  }

  if (command === "vm_stat") {
    if (safeArgs.length !== 0) {
      throw new Error("Pure Host vm_stat does not accept arguments");
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
  }

  if (command === "memory_pressure") {
    if (!(safeArgs.length === 0 || (safeArgs.length === 1 && safeArgs[0] === "-Q"))) {
      throw new Error("Pure Host memory_pressure only accepts optional -Q");
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
  }

  if (command === "sw_vers") {
    if (
      !(
        safeArgs.length === 0 ||
        (safeArgs.length === 1 &&
          ["-buildVersion", "-productName", "-productVersion"].includes(safeArgs[0] ?? ""))
      )
    ) {
      throw new Error("Pure Host sw_vers accepts at most one standard version selector");
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
  }

  if (command === "uname") {
    if (
      safeArgs.length > 1 ||
      (safeArgs.length === 1 && !HOST_DIAGNOSTIC_UNAME_OPTION.test(safeArgs[0] ?? ""))
    ) {
      throw new Error("Pure Host uname options are restricted to standard read-only selectors");
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
  }

  return null;
}

export function evaluatePureHostCommand(
  command: string,
  args: string[],
  profile: HostPermissionProfile = DEFAULT_HOST_PERMISSION_PROFILE
): PureHostCommandPolicyDecision {
  const safeArgs = validateCommandArgs(args);

  if (command === "pwd") {
    if (safeArgs.length !== 0) {
      throw new Error("Pure Host pwd does not accept arguments");
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
  }

  if (command === "ls") {
    const relativePathArgs: string[] = [];
    for (const arg of safeArgs) {
      if (arg.startsWith("-")) {
        if (!PURE_HOST_LS_OPTION.test(arg)) {
          throw new Error(`Pure Host ls option is not allowed: ${arg}`);
        }
        continue;
      }
      if (path.isAbsolute(arg)) {
        throw new Error("Pure Host ls path must be relative");
      }
      relativePathArgs.push(arg);
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs };
  }

  if (command === "git") {
    const subcommand = safeArgs[0];
    if (!subcommand || !PURE_HOST_GIT_SUBCOMMANDS.has(subcommand)) {
      throw new Error(
        `Pure Host git subcommand is not allowed: ${subcommand ?? "<none>"}`
      );
    }
    return { command, args: safeArgs, effect: "read", relativePathArgs: [] };
  }

  if (hostDeviceDiagnosticsAllowed(profile)) {
    const diagnostic = evaluateDeviceDiagnosticCommand(command, safeArgs);
    if (diagnostic) return diagnostic;
  }

  if (fullHostCommandsAllowed(profile)) {
    if (!/^[A-Za-z0-9._+-]+$/.test(command) || FULL_HOST_BLOCKED_COMMANDS.has(command)) {
      throw new Error(`Full Host command is blocked: ${command}`);
    }
    return {
      command,
      args: safeArgs,
      effect: "write",
      // Full Host is intentionally danger-level: command arguments are not
      // projected as Host Root paths because many admin commands use non-path
      // operands (PIDs, service names, volume identifiers, etc.). The Host Root
      // still governs the working directory, while exact operator approval and
      // audit govern the command itself.
      relativePathArgs: []
    };
  }

  throw new Error(
    profile === "device-maintenance"
      ? "Pure Host command is outside the device-maintenance diagnostic allowlist"
      : "Pure Host commands are limited by the selected Host permission profile"
  );
}

export function isWorkspaceReadOnlyCommand(command: string, args: string[]): boolean {
  return evaluateWorkspaceCommand(command, args).effect === "read";
}
