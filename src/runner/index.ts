import { completeJob, claimNextQueuedJob, failJob } from "../core/jobs.js";
import { runPack } from "../core/pack.js";
import { createTaskPack } from "../core/taskpack.js";
import type {
  PackJobPayload,
  TaskPackJobPayload,
  TokenPilotJobPayload,
  TokenPilotPaths
} from "../types.js";

function isTaskPackPayload(payload: TokenPilotJobPayload): payload is TaskPackJobPayload {
  return typeof (payload as TaskPackJobPayload).title === "string";
}

function isPackPayload(payload: TokenPilotJobPayload): payload is PackJobPayload {
  return typeof (payload as PackJobPayload).repoId === "string";
}

export interface RunnerOptions {
  intervalSeconds?: number;
  watch?: boolean;
}

async function sleep(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function runNextJob(paths: TokenPilotPaths): Promise<boolean> {
  const startedAt = new Date().toISOString();
  const job = claimNextQueuedJob(paths);

  if (!job) {
    return false;
  }

  process.stdout.write(
    [
      "[TokenPilot runner]",
      `mode=phase1-local`,
      `job=${job.id}`,
      `type=${job.type}`,
      `startedAt=${startedAt}`
    ].join(" ") + "\n"
  );

  try {
    if (job.type === "pack" && isPackPayload(job.payload)) {
      if (job.payload.repoId !== "tokenpilot") {
        failJob(paths, job.id, `Unsupported repoId: ${job.payload.repoId}`);
        return true;
      }
      const manifest = runPack(paths);
      completeJob(paths, job.id, manifest);
      return true;
    }

    if (job.type === "taskpack" && isTaskPackPayload(job.payload)) {
      const artifact = createTaskPack(paths, job.payload);
      completeJob(paths, job.id, artifact);
      return true;
    }

    failJob(paths, job.id, `Unsupported job payload for type: ${job.type}`);
  } catch (error) {
    failJob(
      paths,
      job.id,
      error instanceof Error ? error.stack || error.message : String(error)
    );
  }

  return true;
}

export async function runRunner(
  paths: TokenPilotPaths,
  options: RunnerOptions = {}
): Promise<void> {
  const intervalSeconds = options.intervalSeconds ?? 3;

  if (!options.watch) {
    const didProcessJob = await runNextJob(paths);
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
    process.stdout.write("[TokenPilot runner] mode=watch Graceful shutdown complete.\n");
  }
}
