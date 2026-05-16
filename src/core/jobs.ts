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

function jobFile(paths: TokenPilotPaths, jobId: string): string {
  return path.join(paths.jobsDir, `${jobId}.json`);
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
  writeJson(jobFile(paths, record.id), record);
  return record;
}

export function getJob(
  paths: TokenPilotPaths,
  jobId: string
): JobRecord<TokenPilotJobPayload> | null {
  const filePath = jobFile(paths, jobId);
  if (!fs.existsSync(filePath)) return null;
  return readJson<JobRecord<TokenPilotJobPayload>>(filePath);
}

export function listJobs(paths: TokenPilotPaths): JobRecord<TokenPilotJobPayload>[] {
  return fs
    .readdirSync(paths.jobsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      readJson<JobRecord<TokenPilotJobPayload>>(path.join(paths.jobsDir, name))
    );
}

export function claimNextQueuedJob(
  paths: TokenPilotPaths
): JobRecord<TokenPilotJobPayload> | null {
  for (const job of listJobs(paths)) {
    if (job.status !== "queued") continue;
    const claimed: JobRecord<TokenPilotJobPayload> = {
      ...job,
      status: "running",
      updatedAt: new Date().toISOString()
    };
    writeJson(jobFile(paths, job.id), claimed);
    return claimed;
  }
  return null;
}

export function completeJob(
  paths: TokenPilotPaths,
  jobId: string,
  result: unknown
): JobRecord<TokenPilotJobPayload> {
  const current = getJob(paths, jobId);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const updated: JobRecord<TokenPilotJobPayload> = {
    ...current,
    status: "completed",
    updatedAt: new Date().toISOString(),
    result
  };
  writeJson(jobFile(paths, jobId), updated);
  return updated;
}

export function failJob(
  paths: TokenPilotPaths,
  jobId: string,
  error: string
): JobRecord<TokenPilotJobPayload> {
  const current = getJob(paths, jobId);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const updated: JobRecord<TokenPilotJobPayload> = {
    ...current,
    status: "failed",
    updatedAt: new Date().toISOString(),
    error
  };
  writeJson(jobFile(paths, jobId), updated);
  return updated;
}
