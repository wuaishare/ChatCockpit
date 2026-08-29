import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";

const BLOCKED_GIT_ENV_KEYS = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_ASKPASS",
  "GIT_COMMON_DIR",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PROXY_COMMAND",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_WORK_TREE",
  "SSH_ASKPASS"
]);

export const GOVERNED_GIT_CONFIG_ARGS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "submodule.recurse=false"
] as const;

export function governedSshCommand(
  base: NodeJS.ProcessEnv = process.env
): string {
  if (process.platform === "win32") {
    const systemRoot = base.SystemRoot || "C:\\Windows";
    return `"${systemRoot}\\System32\\OpenSSH\\ssh.exe" -oBatchMode=yes`;
  }
  return "/usr/bin/ssh -oBatchMode=yes";
}

export function buildGovernedGitEnv(
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if (
      BLOCKED_GIT_ENV_KEYS.has(key) ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
    ) {
      delete env[key];
    }
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ALLOW_PROTOCOL = "https:ssh";
  env.GIT_SSH_COMMAND = governedSshCommand(base);
  env.GIT_ATTR_NOSYSTEM = "1";
  return env;
}

export function governedGitArgs(
  args: readonly string[],
  options: { disableCommitSigning?: boolean } = {}
): string[] {
  return [
    ...GOVERNED_GIT_CONFIG_ARGS,
    ...(options.disableCommitSigning
      ? ["-c", "commit.gpgSign=false"]
      : []),
    ...args
  ];
}

export function spawnGovernedGit(
  cwd: string,
  args: readonly string[],
  options: {
    timeoutMs?: number;
    maxBuffer?: number;
    disableCommitSigning?: boolean;
  } = {}
): SpawnSyncReturns<string> {
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 10_000,
    env: buildGovernedGitEnv()
  };
  if (options.maxBuffer !== undefined) {
    spawnOptions.maxBuffer = options.maxBuffer;
  }
  return spawnSync(
    "git",
    governedGitArgs(args, {
      disableCommitSigning: options.disableCommitSigning
    }),
    spawnOptions
  );
}
