import { spawnSync } from "node:child_process";
import os from "node:os";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export function runGit(cwd: string, args: string[]): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_SYSTEM: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0"
    }
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
  } = {}
): void {
  runGit(cwd, ["init", "-q"]);
  runGit(cwd, ["config", "user.email", options.email ?? "fixture@example.invalid"]);
  runGit(cwd, ["config", "user.name", options.name ?? "ChatCockpit Fixture"]);
  runGit(cwd, ["add", "-A"]);
  runGit(cwd, ["commit", "-qm", options.commitMessage ?? "fixture"]);
}
