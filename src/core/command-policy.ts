import path from "node:path";

export type CommandEffect = "read" | "write";

export interface CommandPolicyDecision {
  command: string;
  args: string[];
  effect: CommandEffect;
}

const WORKSPACE_COMMAND_WHITELIST: Record<string, string[]> = {
  npm: ["run", "test", "install", "ci", "build", "lint", "typecheck", "start", "dev"],
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
  git: ["status", "diff", "log", "branch", "add", "restore", "stash", "show", "rev-parse", "rev-list"]
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
  const exposed = envFlagEnabled(process.env.TOKENPILOT_EXPOSED);
  const explicitlyAllowed = envFlagEnabled(
    process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS
  );
  if (exposed && !explicitlyAllowed) {
    throw new Error(
      `High-trust command ${command} is blocked in exposed mode. ` +
        "Set TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS=true only in a private authenticated operator environment."
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
  const effect: CommandEffect =
    command === "git" && READ_ONLY_GIT_SUBCOMMANDS.has(safeArgs[0] ?? "")
      ? "read"
      : "write";
  return { command, args: safeArgs, effect };
}

export interface PureHostCommandPolicyDecision extends CommandPolicyDecision {
  relativePathArgs: string[];
}

export function evaluatePureHostCommand(
  command: string,
  args: string[]
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

  throw new Error(
    "Pure Host commands are limited to pwd, ls, and read-only git inspection"
  );
}

export function isWorkspaceReadOnlyCommand(command: string, args: string[]): boolean {
  return evaluateWorkspaceCommand(command, args).effect === "read";
}
