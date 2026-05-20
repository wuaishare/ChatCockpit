import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { readJson, writeJson } from "./files.js";
import type {
  JobRecord,
  JobType,
  TokenPilotJobPayload,
  TokenPilotPaths
} from "../types.js";

type JobStatus = JobRecord["status"];

const JOB_STATUS_DIR_KEYS: Record<JobStatus, keyof TokenPilotPaths> = {
  queued: "queuedJobsDir",
  running: "runningJobsDir",
  completed: "completedJobsDir",
  failed: "failedJobsDir"
};

function jobFileForStatus(paths: TokenPilotPaths, jobId: string, status: JobStatus): string {
  return path.join(paths[JOB_STATUS_DIR_KEYS[status]], `${jobId}.json`);
}

function legacyJobFile(paths: TokenPilotPaths, jobId: string): string {
  return path.join(paths.jobsDir, `${jobId}.json`);
}

function readJobFile(filePath: string): JobRecord<TokenPilotJobPayload> {
  return readJson<JobRecord<TokenPilotJobPayload>>(filePath);
}

function listStatusJobs(
  dirPath: string
): Array<{ filePath: string; job: JobRecord<TokenPilotJobPayload> }> {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const filePath = path.join(dirPath, name);
      return {
        filePath,
        job: readJobFile(filePath)
      };
    });
}

function migrateLegacyJobs(paths: TokenPilotPaths): void {
  if (!fs.existsSync(paths.jobsDir)) {
    return;
  }

  const reservedDirs = new Set(["queued", "running", "completed", "failed"]);
  for (const name of fs.readdirSync(paths.jobsDir)) {
    if (reservedDirs.has(name) || !name.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(paths.jobsDir, name);
    const job = readJobFile(filePath);
    const targetPath = jobFileForStatus(paths, job.id, job.status);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.renameSync(filePath, targetPath);
  }
}

function updateJobStatus(
  paths: TokenPilotPaths,
  jobId: string,
  status: JobStatus,
  updater: (job: JobRecord<TokenPilotJobPayload>) => JobRecord<TokenPilotJobPayload>
): JobRecord<TokenPilotJobPayload> {
  const current = getJob(paths, jobId);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const updated = updater(current.job);
  const targetPath = jobFileForStatus(paths, jobId, status);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeJson(targetPath, updated);

  if (current.filePath !== targetPath && fs.existsSync(current.filePath)) {
    fs.rmSync(current.filePath, { force: true });
  }

  return updated;
}

export function createJob<TPayload extends TokenPilotJobPayload>(
  paths: TokenPilotPaths,
  type: JobType,
  payload: TPayload
): JobRecord<TPayload> {
  const now = new Date().toISOString();
  const record: JobRecord<TPayload> = {
    id: crypto.randomUUID(),
    type,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    payload
  };
  writeJson(jobFileForStatus(paths, record.id, "queued"), record);
  return record;
}

export function getJob(
  paths: TokenPilotPaths,
  jobId: string
): { filePath: string; job: JobRecord<TokenPilotJobPayload> } | null {
  migrateLegacyJobs(paths);

  const candidatePaths = [
    jobFileForStatus(paths, jobId, "queued"),
    jobFileForStatus(paths, jobId, "running"),
    jobFileForStatus(paths, jobId, "completed"),
    jobFileForStatus(paths, jobId, "failed"),
    legacyJobFile(paths, jobId)
  ];

  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    return {
      filePath,
      job: readJobFile(filePath)
    };
  }

  return null;
}

export function listJobs(paths: TokenPilotPaths): JobRecord<TokenPilotJobPayload>[] {
  migrateLegacyJobs(paths);

  return [
    ...listStatusJobs(paths.queuedJobsDir),
    ...listStatusJobs(paths.runningJobsDir),
    ...listStatusJobs(paths.completedJobsDir),
    ...listStatusJobs(paths.failedJobsDir)
  ]
    .map(({ job }) => job)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
}

export function claimNextQueuedJob(
  paths: TokenPilotPaths
): JobRecord<TokenPilotJobPayload> | null {
  migrateLegacyJobs(paths);

  for (const { filePath, job } of listStatusJobs(paths.queuedJobsDir)) {
    const claimed: JobRecord<TokenPilotJobPayload> = {
      ...job,
      status: "running",
      updatedAt: new Date().toISOString()
    };
    const targetPath = jobFileForStatus(paths, job.id, "running");

    try {
      fs.renameSync(filePath, targetPath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    writeJson(targetPath, claimed);
    return claimed;
  }
  return null;
}

export function completeJob(
  paths: TokenPilotPaths,
  jobId: string,
  result: unknown
): JobRecord<TokenPilotJobPayload> {
  return updateJobStatus(paths, jobId, "completed", (current) => ({
    ...current,
    status: "completed",
    updatedAt: new Date().toISOString(),
    result
  }));
}

export function failJob(
  paths: TokenPilotPaths,
  jobId: string,
  error: string
): JobRecord<TokenPilotJobPayload> {
  return updateJobStatus(paths, jobId, "failed", (current) => ({
    ...current,
    status: "failed",
    updatedAt: new Date().toISOString(),
    error
  }));
}
