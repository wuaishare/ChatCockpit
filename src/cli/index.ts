import process from "node:process";

import { buildPaths, ensureWorkspaceDirs } from "../core/paths.js";
import { runDoctor } from "../core/doctor.js";
import { runPack } from "../core/pack.js";
import { buildBundleManifest } from "../core/manifest.js";
import { createTaskPack } from "../core/taskpack.js";
import { createJob, getJob, listJobs } from "../core/jobs.js";
import { buildServer } from "../server/app.js";
import { runRunner } from "../runner/index.js";

function printUsage(): void {
  process.stdout.write(`TokenPilot CLI

Usage:
  tokenpilot doctor
  tokenpilot pack
  tokenpilot manifest
  tokenpilot taskpack --title "..." --problem "..."
  tokenpilot queue-pack
  tokenpilot queue-taskpack --title "..." --problem "..."
  tokenpilot jobs
  tokenpilot job --id "<job-id>"
  tokenpilot server
  tokenpilot runner
`);
}

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const paths = buildPaths();
  ensureWorkspaceDirs(paths);

  switch (command) {
    case "doctor": {
      const checks = runDoctor(paths.repoRoot);
      process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
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
        `${paths.workspaceDir}/repomix-output.xml`
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
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    case "server": {
      const app = buildServer(paths);
      const port = Number(process.env.TOKENPILOT_PORT || "4318");
      const host = process.env.TOKENPILOT_HOST || "127.0.0.1";
      await app.listen({ host, port });
      return;
    }
    case "runner": {
      await runRunner(paths);
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
