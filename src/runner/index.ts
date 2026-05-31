import { completeJob, claimNextQueuedJob, failJob, listJobs } from "../core/jobs.js";
import { runCodexRunJob } from "../core/codex-run.js";
import { getTrackedJobProcess } from "../core/job-processes.js";
import { runPackForRepo } from "../core/pack.js";
import { createTaskPack } from "../core/taskpack.js";
import {
  markRunnerClaimed,
  markRunnerCompleted,
  markRunnerFailed,
  markRunnerHeartbeat,
  markRunnerStarted,
  markRunnerStopped
} from "./status.js";
import type {
  PackJobPayload,
  CodexRunJobPayload,
  TaskPackJobPayload,
  TokenPilotJobPayload,
  TokenPilotPaths
} from "../types.js";

function isTaskPackPayload(payload: TokenPilotJobPayload): payload is TaskPackJobPayload {
  return (
    typeof (payload as TaskPackJobPayload).title === "string" &&
    typeof (payload as CodexRunJobPayload).instructions !== "string"
  );
}

function isCodexRunPayload(payload: TokenPilotJobPayload): payload is CodexRunJobPayload {
  return (
    typeof (payload as CodexRunJobPayload).repoId === "string" &&
    typeof (payload as CodexRunJobPayload).title === "string" &&
    typeof (payload as CodexRunJobPayload).instructions === "string"
  );
}

function isPackPayload(payload: TokenPilotJobPayload): payload is PackJobPayload {
  return (
    typeof (payload as PackJobPayload).repoId === "string" ||
    typeof (payload as { repoRoot?: string }).repoRoot === "string"
  );
}

function resolvePackRepoId(payload: TokenPilotJobPayload): string {
  if (typeof (payload as PackJobPayload).repoId === "string") {
    return (payload as PackJobPayload).repoId;
  }

  if (typeof (payload as { repoRoot?: string }).repoRoot === "string") {
    return "tokenpilot";
  }

  return "";
}

export interface RunnerOptions {
  intervalSeconds?: number;
  watch?: boolean;
}

async function sleep(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function reconcileTerminalRunningJobs(paths: TokenPilotPaths): number {
  let reconciled = 0;

  for (const job of listJobs(paths)) {
    if (job.status !== "running") {
      continue;
    }

    const processRecord = getTrackedJobProcess(paths, job.id);
    if (!processRecord || processRecord.state === "running" || processRecord.state === "paused") {
      continue;
    }

    const message = [
      `Tracked process is ${processRecord.state}, but job was still marked running.`,
      "Runner reconciled the stale running job; rerun the task if a persisted result is required."
    ].join(" ");
    failJob(paths, job.id, message);
    markRunnerFailed(paths, message);
    reconciled += 1;

    process.stdout.write(
      [
        "[TokenPilot runner]",
        "mode=reconcile",
        `job=${job.id}`,
        `processState=${processRecord.state}`
      ].join(" ") + "\n"
    );
  }

  return reconciled;
}

async function runNextJob(paths: TokenPilotPaths): Promise<boolean> {
  const startedAt = new Date().toISOString();
  const reconciledCount = reconcileTerminalRunningJobs(paths);
  const job = claimNextQueuedJob(paths);

  if (!job) {
    return reconciledCount > 0;
  }

  markRunnerClaimed(paths, job.id, job.type);

  process.stdout.write(
    [
      "[TokenPilot runner]",
      `mode=phase2-dual-mode`,
      `job=${job.id}`,
      `type=${job.type}`,
      `startedAt=${startedAt}`
    ].join(" ") + "\n"
  );

  try {
    if (job.type === "pack" && isPackPayload(job.payload)) {
      const repoId = resolvePackRepoId(job.payload);
      const manifest = runPackForRepo(paths, repoId);
      completeJob(paths, job.id, manifest);
      markRunnerCompleted(paths);
      return true;
    }

    if (job.type === "taskpack" && isTaskPackPayload(job.payload)) {
      const artifact = createTaskPack(paths, job.payload);
      completeJob(paths, job.id, artifact);
      markRunnerCompleted(paths);
      return true;
    }

    if (job.type === "codex-run" && isCodexRunPayload(job.payload)) {
      const result = await runCodexRunJob(paths, job.id, job.payload);
      completeJob(paths, job.id, result);
      markRunnerCompleted(paths);
      return true;
    }

    failJob(paths, job.id, `Unsupported job payload for type: ${job.type}`);
    markRunnerFailed(paths, `Unsupported job payload for type: ${job.type}`);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    failJob(
      paths,
      job.id,
      message
    );
    markRunnerFailed(paths, message);
  }

  return true;
}

export async function runRunner(
  paths: TokenPilotPaths,
  options: RunnerOptions = {}
): Promise<void> {
  const intervalSeconds = options.intervalSeconds ?? 3;
  markRunnerStarted(paths, options.watch ? "watch" : "once");

  if (!options.watch) {
    const didProcessJob = await runNextJob(paths);
    markRunnerHeartbeat(paths);
    if (!didProcessJob) {
      process.stdout.write(
        [
          "[TokenPilot runner]",
          "mode=once",
          "repoId=tokenpilot",
          `startedAt=${new Date().toISOString()}`,
          "No queued jobs found."
        ].join(" ") + "\n"
      );
    }
    markRunnerStopped(paths);
    return;
  }

  let stopRequested = false;
  let isIdle = false;
  const handleStop = (signal: string) => {
    if (stopRequested) return;
    stopRequested = true;
    process.stdout.write(
      `[TokenPilot runner] mode=watch signal=${signal} Stopping after current cycle.\n`
    );
  };

  process.once("SIGINT", () => handleStop("SIGINT"));
  process.once("SIGTERM", () => handleStop("SIGTERM"));

  process.stdout.write(
    [
      "[TokenPilot runner]",
      "mode=watch",
      "repoId=tokenpilot",
      `interval=${intervalSeconds}s`,
      `startedAt=${new Date().toISOString()}`
    ].join(" ") + "\n"
  );

  try {
    while (!stopRequested) {
      markRunnerHeartbeat(paths);
      const didProcessJob = await runNextJob(paths);

      if (didProcessJob) {
        isIdle = false;
        continue;
      }

      if (!isIdle) {
        isIdle = true;
        process.stdout.write(
          `[TokenPilot runner] mode=watch repoId=tokenpilot No queued jobs found. Waiting ${intervalSeconds}s.\n`
        );
      }

      await sleep(intervalSeconds);
    }
  } finally {
    markRunnerStopped(paths);
    process.stdout.write("[TokenPilot runner] mode=watch Graceful shutdown complete.\n");
  }
}
