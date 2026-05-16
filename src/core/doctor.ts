import fs from "node:fs";
import path from "node:path";

import { runCommand } from "./shell.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function runDoctor(repoRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const git = runCommand("git", ["rev-parse", "--show-toplevel"], repoRoot);
  checks.push({
    name: "git",
    ok: git.exitCode === 0,
    detail: git.exitCode === 0 ? git.stdout.trim() : git.stderr.trim()
  });

  const node = runCommand("node", ["--version"], repoRoot);
  checks.push({
    name: "node",
    ok: node.exitCode === 0,
    detail: node.exitCode === 0 ? node.stdout.trim() : node.stderr.trim()
  });

  const npm = runCommand("npm", ["--version"], repoRoot);
  checks.push({
    name: "npm",
    ok: npm.exitCode === 0,
    detail: npm.exitCode === 0 ? npm.stdout.trim() : npm.stderr.trim()
  });

  const python = runCommand("python3", ["--version"], repoRoot);
  checks.push({
    name: "python3",
    ok: python.exitCode === 0,
    detail: python.exitCode === 0 ? python.stdout.trim() || python.stderr.trim() : python.stderr.trim()
  });

  const repomixBin = path.join(repoRoot, "node_modules", ".bin", "repomix");
  checks.push({
    name: "repomix",
    ok: fs.existsSync(repomixBin),
    detail: fs.existsSync(repomixBin)
      ? repomixBin
      : "Install dependencies with `npm install` before running pack."
  });

  return checks;
}
