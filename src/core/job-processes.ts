import fs from "node:fs";
import path from "node:path";

import { writeJson } from "./files.js";
import type { TokenPilotPaths } from "../types.js";

export type JobProcessState = "running" | "paused" | "terminated" | "completed" | "failed";
export type JobControlAction = "pause" | "resume" | "terminate";

export interface JobProcessRecord {
  jobId: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  state: JobProcessState;
  label: string;
}

function processesDir(paths: TokenPilotPaths): string {
  return path.join(paths.runtimeDir, "job-processes");
}

function processFile(paths: TokenPilotPaths, jobId: string): string {
  return path.join(processesDir(paths), `${jobId}.json`);
}

function readRecord(paths: TokenPilotPaths, jobId: string): JobProcessRecord | null {
  const filePath = processFile(paths, jobId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JobProcessRecord;
}

export function getTrackedJobProcess(
  paths: TokenPilotPaths,
  jobId: string
): Pick<JobProcessRecord, "state" | "updatedAt" | "label"> | null {
  const record = readRecord(paths, jobId);
  if (!record) {
    return null;
  }

  return {
    state: record.state,
    updatedAt: record.updatedAt,
    label: record.label
  };
}

function writeRecord(paths: TokenPilotPaths, record: JobProcessRecord): JobProcessRecord {
  const next = {
    ...record,
    updatedAt: new Date().toISOString()
  };
  writeJson(processFile(paths, record.jobId), next);
  return next;
}

export function trackJobProcess(
  paths: TokenPilotPaths,
  record: Omit<JobProcessRecord, "startedAt" | "updatedAt" | "state">
): JobProcessRecord {
  const now = new Date().toISOString();
  return writeRecord(paths, {
    ...record,
    startedAt: now,
    updatedAt: now,
    state: "running"
  });
}

export function markJobProcessFinished(
  paths: TokenPilotPaths,
  jobId: string,
  state: Extract<JobProcessState, "completed" | "failed" | "terminated">
): JobProcessRecord | null {
  const current = readRecord(paths, jobId);
  if (!current) {
    return null;
  }
  return writeRecord(paths, {
    ...current,
    state
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Invalid tracked process pid");
  }

  try {
    process.kill(-pid, signal);
  } catch {
    process.kill(pid, signal);
  }
}

function trySignalProcessGroup(pid: number, signal: NodeJS.Signals): string | null {
  try {
    signalProcessGroup(pid, signal);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function controlJobProcess(
  paths: TokenPilotPaths,
  jobId: string,
  action: JobControlAction
): { ok: boolean; jobId: string; action: JobControlAction; state: JobProcessState; message: string } {
  const current = readRecord(paths, jobId);
  if (!current) {
    return {
      ok: false,
      jobId,
      action,
      state: "completed",
      message: "No tracked process for job"
    };
  }

  if (!Number.isInteger(current.pid) || current.pid <= 0) {
    const next = writeRecord(paths, { ...current, state: "failed" });
    return {
      ok: false,
      jobId,
      action,
      state: next.state,
      message: "Tracked process pid is invalid"
    };
  }

  if (current.state !== "running" && current.state !== "paused") {
    return {
      ok: false,
      jobId,
      action,
      state: current.state,
      message: `Job process is already ${current.state}`
    };
  }

  if (action === "pause") {
    const error = trySignalProcessGroup(current.pid, "SIGSTOP");
    if (error) {
      const next = writeRecord(paths, { ...current, state: "failed" });
      return { ok: false, jobId, action, state: next.state, message: `Failed to pause job process: ${error}` };
    }
    const next = writeRecord(paths, { ...current, state: "paused" });
    return { ok: true, jobId, action, state: next.state, message: "Job process paused" };
  }

  if (action === "resume") {
    const error = trySignalProcessGroup(current.pid, "SIGCONT");
    if (error) {
      const next = writeRecord(paths, { ...current, state: "failed" });
      return { ok: false, jobId, action, state: next.state, message: `Failed to resume job process: ${error}` };
    }
    const next = writeRecord(paths, { ...current, state: "running" });
    return { ok: true, jobId, action, state: next.state, message: "Job process resumed" };
  }

  const error = trySignalProcessGroup(current.pid, "SIGTERM");
  if (error) {
    const next = writeRecord(paths, { ...current, state: "failed" });
    return { ok: false, jobId, action, state: next.state, message: `Failed to terminate job process: ${error}` };
  }
  const next = writeRecord(paths, { ...current, state: "terminated" });
  return { ok: true, jobId, action, state: next.state, message: "Job process terminated" };
}

export function terminateAllJobProcesses(paths: TokenPilotPaths): {
  ok: true;
  terminated: Array<{ jobId: string; state: JobProcessState; message: string }>;
} {
  const dir = processesDir(paths);
  if (!fs.existsSync(dir)) {
    return { ok: true, terminated: [] };
  }

  const terminated = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .map((jobId) => {
      const result = controlJobProcess(paths, jobId, "terminate");
      return {
        jobId,
        state: result.state,
        message: result.message
      };
    });

  return { ok: true, terminated };
}
