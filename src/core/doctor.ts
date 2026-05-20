import fs from "node:fs";
import path from "node:path";

import { runCommand } from "./shell.js";
import { buildPaths } from "./paths.js";
import { listJobs } from "./jobs.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function runDoctor(repoRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const paths = buildPaths(repoRoot);

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

  const jobs = listJobs(paths);
  const queued = jobs.filter((job) => job.status === "queued").length;
  const running = jobs.filter((job) => job.status === "running").length;
  const completed = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  checks.push({
    name: "job-queue",
    ok: true,
    detail: `queued=${queued} running=${running} completed=${completed} failed=${failed}`
  });

  const runnerStatusPath = paths.runnerStatusPath;
  if (fs.existsSync(runnerStatusPath)) {
    const raw = fs.readFileSync(runnerStatusPath, "utf8");
    checks.push({
      name: "runner-status",
      ok: true,
      detail: raw.trim()
    });
  } else {
    checks.push({
      name: "runner-status",
      ok: false,
      detail: `Missing ${runnerStatusPath}`
    });
  }

  return checks;
}
