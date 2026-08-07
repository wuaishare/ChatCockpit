import fs from "node:fs";
import path from "node:path";

import { buildOAuthReadiness } from "../auth/oauth-readiness.js";
import { runCommand } from "./shell.js";
import { buildPaths, ensureWorkspaceDirs } from "./paths.js";
import { listJobs } from "./jobs.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  summary: string;
  checks: DoctorCheck[];
  fixes: string[];
}

export function runDoctor(repoRoot: string, options: { fix?: boolean } = {}): DoctorResult {
  const checks: DoctorCheck[] = [];
  const fixes: string[] = [];
  const paths = buildPaths(repoRoot);

  if (options.fix) {
    ensureWorkspaceDirs(paths);
    fixes.push(`ensured runtime directories under ${path.relative(repoRoot, paths.workspaceDir)}`);
  }

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

  checks.push({
    name: "bundle-engine",
    ok: true,
    detail: "TokenPilot internal XML bundle generator"
  });

  const oauth = buildOAuthReadiness(paths);
  checks.push({
    name: "chatgpt-mcp-oauth",
    ok: !oauth.required || oauth.ready,
    detail:
      oauth.status === "ready"
        ? `ready metadata=${oauth.protectedResourceMetadataUrl}`
        : oauth.detail
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

  const ok = checks.every((check) => check.ok);
  const summary = ok
    ? "TokenPilot local prerequisites look ready."
    : "TokenPilot needs attention before the local workflow is fully ready.";

  return {
    ok,
    summary,
    checks,
    fixes
  };
}
