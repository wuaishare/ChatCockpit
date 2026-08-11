import process from "node:process";
import path from "node:path";

import { buildPaths, ensureWorkspaceDirs } from "../core/paths.js";
import { buildDistributionContextFromPaths } from "../core/distribution-context.js";
import { runDoctor } from "../core/doctor.js";
import { initLocalRuntime } from "../core/setup.js";
import { runPack } from "../core/pack.js";
import { buildBundleManifest } from "../core/manifest.js";
import { createTaskPack } from "../core/taskpack.js";
import { createJob, getJob, listJobs } from "../core/jobs.js";
import { buildServer } from "../server/app.js";
import { runRunner } from "../runner/index.js";
import { probeConfiguredDownstreamMcpExecutors } from "../direct/downstream-mcp-operator.js";
import { runProcessSupervisorUntilSignal } from "../process-supervisor/index.js";

function printUsage(): void {
  process.stdout.write(`TokenPilot CLI

Usage:
  tokenpilot init [--force]
  tokenpilot doctor [--fix] [--json]
  tokenpilot pack
  tokenpilot manifest
  tokenpilot taskpack --title "..." --problem "..."
  tokenpilot queue-pack
  tokenpilot queue-taskpack --title "..." --problem "..."
  tokenpilot queue-codex-run --title "..." --instructions "..." [--repo-id tokenpilot]
  tokenpilot jobs
  tokenpilot job --id "<job-id>"
  tokenpilot server
  tokenpilot runner [--once]
  tokenpilot runner --watch --interval 3
  tokenpilot process-supervisor
  tokenpilot probe-direct-executors [--executor-id "downstream-mcp:..."]
`);
}

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function redactForHumanOutput(value: string, repoRoot: string): string {
  let output = value;
  const replacements: Array<[string | undefined, string]> = [
    [repoRoot, "<repo-root>"],
    [process.env.HOME, "~"],
    [process.env.USER, "<local-user>"],
    [process.env.TOKENPILOT_API_TOKEN, "<redacted-token>"]
  ];
  for (const [from, to] of replacements) {
    if (from) {
      output = output.split(from).join(to);
    }
  }
  return output;
}

function redactObjectForHumanOutput<T>(value: T, repoRoot: string): T {
  if (typeof value === "string") {
    return redactForHumanOutput(value, repoRoot) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactObjectForHumanOutput(entry, repoRoot)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactObjectForHumanOutput(entry, repoRoot)])
    ) as T;
  }
  return value;
}

function printHumanJson(value: unknown, repoRoot: string): void {
  printJson(redactObjectForHumanOutput(value, repoRoot));
}

function displayPath(filePath: string, repoRoot: string): string {
  const relative = path.relative(repoRoot, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return redactForHumanOutput(filePath, repoRoot);
}

function printInitResult(result: ReturnType<typeof initLocalRuntime>, repoRoot: string): void {
  process.stdout.write("TokenPilot init\n");
  process.stdout.write(`Status: ${result.created ? "created local runtime config" : "already initialized"}\n`);
  process.stdout.write(`Runtime env: ${displayPath(result.envPath, repoRoot)}\n`);
  process.stdout.write(`Token generated: ${result.tokenGenerated ? "yes" : "no"}\n`);
  process.stdout.write("Next actions:\n");
  for (const message of result.messages) {
    process.stdout.write(`- ${redactForHumanOutput(message, repoRoot)}\n`);
  }
  process.stdout.write("Details JSON:\n");
  printHumanJson(result, repoRoot);
}

function printDoctorResult(result: ReturnType<typeof runDoctor>, repoRoot: string): void {
  process.stdout.write("TokenPilot doctor\n");
  process.stdout.write(`Summary: ${result.summary}\n`);
  process.stdout.write(`Status: ${result.ok ? "ready" : "needs attention"}\n`);
  if (result.fixes.length > 0) {
    process.stdout.write("Fixes applied:\n");
    for (const fix of result.fixes) {
      process.stdout.write(`- ${redactForHumanOutput(fix, repoRoot)}\n`);
    }
  }
  process.stdout.write("Checks:\n");
  for (const check of result.checks) {
    process.stdout.write(
      `- ${check.name}: ${check.ok ? "OK" : "Needs attention"} - ${redactForHumanOutput(check.detail, repoRoot)}\n`
    );
  }
  process.stdout.write("Details JSON:\n");
  printHumanJson(result, repoRoot);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const paths = buildPaths();
  if (command !== "doctor") {
    ensureWorkspaceDirs(paths);
  }

  switch (command) {
    case "init": {
      const result = initLocalRuntime(paths, {
        force: process.argv.includes("--force")
      });
      if (process.argv.includes("--json")) {
        printJson(result);
      } else {
        printInitResult(result, paths.repoRoot);
      }
      return;
    }
    case "doctor": {
      const result = runDoctor(paths.repoRoot, {
        fix: process.argv.includes("--fix"),
        context: buildDistributionContextFromPaths(paths)
      });
      if (process.argv.includes("--json")) {
        printJson(result);
      } else {
        printDoctorResult(result, paths.repoRoot);
      }
      return;
    }
    case "pack": {
      const manifest = runPack(paths);
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }
    case "manifest": {
      const manifest = buildBundleManifest(
        paths.repoRoot,
        paths.bundlesDir,
        `${paths.workspaceDir}/repomix-output-manual.xml`
      );
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }
    case "taskpack": {
      const title = getFlag("--title");
      const problem = getFlag("--problem");
      if (!title || !problem) {
        throw new Error("taskpack requires --title and --problem");
      }
      const artifact = createTaskPack(paths, {
        title,
        problem
      });
      process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
      return;
    }
    case "queue-pack": {
      const job = createJob(paths, "pack", {
        repoId: "tokenpilot"
      });
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    case "queue-taskpack": {
      const title = getFlag("--title");
      const problem = getFlag("--problem");
      if (!title || !problem) {
        throw new Error("queue-taskpack requires --title and --problem");
      }
      const job = createJob(paths, "taskpack", {
        title,
        problem
      });
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    case "queue-codex-run": {
      const repoId = getFlag("--repo-id") || "tokenpilot";
      const title = getFlag("--title");
      const instructions = getFlag("--instructions");
      const executionMode = getFlag("--execution-mode") || "develop";
      const worktreePolicy = getFlag("--worktree-policy") || "auto";
      const commitPolicy = getFlag("--commit-policy") || "propose";
      if (!title || !instructions) {
        throw new Error("queue-codex-run requires --title and --instructions");
      }
      if (!["plan", "review", "develop"].includes(executionMode)) {
        throw new Error("queue-codex-run --execution-mode must be plan, review, or develop");
      }
      if (!["auto", "always", "never"].includes(worktreePolicy)) {
        throw new Error("queue-codex-run --worktree-policy must be auto, always, or never");
      }
      if (!["none", "propose", "commit"].includes(commitPolicy)) {
        throw new Error("queue-codex-run --commit-policy must be none, propose, or commit");
      }
      const job = createJob(paths, "codex-run", {
        repoId,
        title,
        instructions,
        executionMode: executionMode as "plan" | "review" | "develop",
        worktreePolicy: worktreePolicy as "auto" | "always" | "never",
        commitPolicy: commitPolicy as "none" | "propose" | "commit"
      });
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    case "jobs": {
      process.stdout.write(`${JSON.stringify(listJobs(paths), null, 2)}\n`);
      return;
    }
    case "job": {
      const id = getFlag("--id");
      if (!id) {
        throw new Error("job requires --id");
      }
      const job = getJob(paths, id);
      if (!job) {
        throw new Error(`Job not found: ${id}`);
      }
      process.stdout.write(`${JSON.stringify(job.job, null, 2)}\n`);
      return;
    }
    case "server": {
      const app = buildServer(paths);
      const port = Number(process.env.TOKENPILOT_PORT || "4318");
      const host = process.env.TOKENPILOT_HOST || "127.0.0.1";
      await app.listen({ host, port });
      return;
    }
    case "process-supervisor": {
      await runProcessSupervisorUntilSignal(paths);
      return;
    }
    case "probe-direct-executors": {
      const executorId = getFlag("--executor-id");
      const results = await probeConfiguredDownstreamMcpExecutors({
        paths,
        ...(executorId ? { executorId } : {})
      });
      if (process.argv.includes("--json")) {
        printJson(results);
      } else if (results.length === 0) {
        process.stdout.write(
          "No downstream MCP executors are configured in the local Direct Executor config.\n"
        );
      } else {
        process.stdout.write("TokenPilot Direct Executor probe\n");
        printHumanJson(results, paths.repoRoot);
      }
      return;
    }
    case "runner": {
      const once = process.argv.includes("--once");
      const watch = process.argv.includes("--watch");
      const intervalValue = getFlag("--interval");

      if (once && watch) {
        throw new Error("runner accepts either --once or --watch, not both");
      }

      const intervalSeconds = intervalValue ? Number(intervalValue) : 3;
      if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
        throw new Error("runner --interval must be a positive number");
      }

      await runRunner(paths, {
        watch,
        intervalSeconds
      });
      return;
    }
    default:
      printUsage();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
