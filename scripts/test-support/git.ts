import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export function hermeticGitEnv(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0"
  };
}

export function createHermeticGitFixtureEnv(
  root: string,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const home = path.join(root, "home");
  const xdgConfigHome = path.join(home, ".config");
  const xdgCacheHome = path.join(home, ".cache");
  const tmpDir = path.join(home, "tmp");
  fs.mkdirSync(xdgConfigHome, { recursive: true });
  fs.mkdirSync(xdgCacheHome, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  return hermeticGitEnv({
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_CACHE_HOME: xdgCacheHome,
    TMPDIR: tmpDir
  });
}

export function runGit(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = hermeticGitEnv()
): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with status ${result.status ?? "unknown"}: ${stderr || stdout}`
    );
  }
  return { stdout, stderr };
}

export function initializeGitFixture(
  cwd: string,
  options: {
    email?: string;
    name?: string;
    commitMessage?: string;
  } = {},
  env: NodeJS.ProcessEnv = hermeticGitEnv()
): void {
  runGit(cwd, ["init", "-q"], env);
  runGit(cwd, ["config", "user.email", options.email ?? "fixture@example.invalid"], env);
  runGit(cwd, ["config", "user.name", options.name ?? "ChatCockpit Fixture"], env);
  runGit(cwd, ["add", "-A"], env);
  runGit(cwd, ["commit", "-qm", options.commitMessage ?? "fixture"], env);
}
