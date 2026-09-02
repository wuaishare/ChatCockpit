import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import os from "node:os";

const BLOCKED_GIT_ENV_KEYS = new Set([
  "EMAIL",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_ASKPASS",
  "GIT_ATTR_SOURCE",
  "GIT_AUTHOR_DATE",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_CEILING_DIRECTORIES",
  "GIT_COMMITTER_DATE",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMON_DIR",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_CURL_VERBOSE",
  "GIT_DIFF_OPTS",
  "GIT_DIR",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_GLOB_PATHSPECS",
  "GIT_ICASE_PATHSPECS",
  "GIT_INDEX_FILE",
  "GIT_LITERAL_PATHSPECS",
  "GIT_NAMESPACE",
  "GIT_NOGLOB_PATHSPECS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PAGER",
  "GIT_PROTOCOL_FROM_USER",
  "GIT_PROXY_COMMAND",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_SSL_CAINFO",
  "GIT_SSL_CAPATH",
  "GIT_SSL_NO_VERIFY",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
  "GIT_WORK_TREE",
  "SSH_ASKPASS"
]);

export const GOVERNED_GIT_CONFIG_ARGS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.pager=",
  "-c",
  "submodule.recurse=false",
  "-c",
  "http.sslVerify=true"
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
  base: NodeJS.ProcessEnv = process.env,
  options: { disableUserConfig?: boolean } = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if (
      BLOCKED_GIT_ENV_KEYS.has(key) ||
      key.startsWith("GIT_TRACE") ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
    ) {
      delete env[key];
    }
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ALLOW_PROTOCOL = "https:ssh";
  env.GIT_SSH_COMMAND = governedSshCommand(base);
  env.GIT_SSH_VARIANT = "ssh";
  env.GIT_ATTR_NOSYSTEM = "1";
  env.GIT_CONFIG_NOSYSTEM = "1";
  if (options.disableUserConfig) {
    env.GIT_CONFIG_GLOBAL = os.devNull;
    env.GIT_CONFIG_SYSTEM = os.devNull;
  }
  env.GIT_NO_REPLACE_OBJECTS = "1";
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
    disableUserConfig?: boolean;
  } = {}
): SpawnSyncReturns<string> {
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 10_000,
    env: buildGovernedGitEnv(process.env, {
      disableUserConfig: options.disableUserConfig
    })
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
