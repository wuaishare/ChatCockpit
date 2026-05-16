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

export async function runRunner(paths: TokenPilotPaths): Promise<void> {
  const startedAt = new Date().toISOString();
  const job = claimNextQueuedJob(paths);

  if (!job) {
    process.stdout.write(
      [
        "[TokenPilot runner]",
        `mode=phase1-local`,
        "repoId=tokenpilot",
        `startedAt=${startedAt}`,
        "No queued jobs found."
      ].join(" ") + "\n"
    );
    return;
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
        return;
      }
      const manifest = runPack(paths);
      completeJob(paths, job.id, manifest);
      return;
    }

    if (job.type === "taskpack" && isTaskPackPayload(job.payload)) {
      const artifact = createTaskPack(paths, job.payload);
      completeJob(paths, job.id, artifact);
      return;
    }

    failJob(paths, job.id, `Unsupported job payload for type: ${job.type}`);
  } catch (error) {
    failJob(
      paths,
      job.id,
      error instanceof Error ? error.stack || error.message : String(error)
    );
  }
}
