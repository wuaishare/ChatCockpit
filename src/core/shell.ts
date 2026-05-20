import { spawnSync } from "node:child_process";

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string
): ShellResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${process.env.PATH || ""}:${cwd}/node_modules/.bin`,
      NODE: process.execPath
    }
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1
  };
}
