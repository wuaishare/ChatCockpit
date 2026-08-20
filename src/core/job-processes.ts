import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ServiceError } from "../application/service-error.js";
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
  revision: number;
}

export interface PreparedJobProcessControl {
  jobId: string;
  action: JobControlAction;
  pid: number;
  signal: NodeJS.Signals;
  previousState: Extract<JobProcessState, "running" | "paused">;
  resultingState: Extract<JobProcessState, "running" | "paused" | "terminated">;
  expectedRevision: number;
}

export interface JobProcessControlResult {
  ok: true;
  jobId: string;
  action: JobControlAction;
  state: JobProcessState;
  revision: number;
  updatedAt: string;
  message: string;
}

export interface JobProcessSignalAdapter {
  signal(pid: number, signal: NodeJS.Signals): void;
}

const STATES = new Set<JobProcessState>(["running", "paused", "terminated", "completed", "failed"]);

function processesDir(paths: TokenPilotPaths): string {
  return path.join(paths.runtimeDir, "job-processes");
}

function processFile(paths: TokenPilotPaths, jobId: string): string {
  return path.join(processesDir(paths), `${jobId}.json`);
}

function normalizeRecord(raw: unknown, filePath: string): JobProcessRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ServiceError("JOB_PROCESS_RECORD_INVALID", `Tracked job process record is invalid: ${path.basename(filePath)}`);
  }
  const value = raw as Partial<JobProcessRecord> & { revision?: unknown };
  if (
    typeof value.jobId !== "string" || !value.jobId ||
    !Number.isInteger(value.pid) || Number(value.pid) <= 0 ||
    typeof value.startedAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.label !== "string" ||
    typeof value.state !== "string" || !STATES.has(value.state as JobProcessState)
  ) {
    throw new ServiceError("JOB_PROCESS_RECORD_INVALID", `Tracked job process record is invalid: ${path.basename(filePath)}`);
  }
  const revision = Number.isInteger(value.revision) && Number(value.revision) > 0
    ? Number(value.revision)
    : 1;
  return {
    jobId: value.jobId,
    pid: Number(value.pid),
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    state: value.state as JobProcessState,
    label: value.label,
    revision
  };
}

function readRecord(paths: TokenPilotPaths, jobId: string): JobProcessRecord | null {
  const filePath = processFile(paths, jobId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeRecord(JSON.parse(fs.readFileSync(filePath, "utf8")), filePath);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("JOB_PROCESS_RECORD_INVALID", `Tracked job process record is invalid: ${path.basename(filePath)}`, { cause: error });
  }
}

function writeRecord(paths: TokenPilotPaths, record: JobProcessRecord): JobProcessRecord {
  const filePath = processFile(paths, record.jobId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best-effort temp cleanup */ }
  }
  return record;
}

function transitionedRecord(current: JobProcessRecord, state: JobProcessState): JobProcessRecord {
  return {
    ...current,
    state,
    updatedAt: new Date().toISOString(),
    revision: current.revision + 1
  };
}

export function getTrackedJobProcess(
  paths: TokenPilotPaths,
  jobId: string
): Pick<JobProcessRecord, "state" | "updatedAt" | "label" | "revision"> | null {
  const record = readRecord(paths, jobId);
  if (!record) return null;
  return { state: record.state, updatedAt: record.updatedAt, label: record.label, revision: record.revision };
}

export function listTrackedJobProcesses(
  paths: TokenPilotPaths
): Array<Pick<JobProcessRecord, "jobId" | "state" | "updatedAt" | "label" | "revision">> {
  const dir = processesDir(paths);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .map((jobId) => readRecord(paths, jobId))
    .filter((record): record is JobProcessRecord => record !== null)
    .map(({ jobId, state, updatedAt, label, revision }) => ({ jobId, state, updatedAt, label, revision }));
}

export function trackJobProcess(
  paths: TokenPilotPaths,
  record: Omit<JobProcessRecord, "startedAt" | "updatedAt" | "state" | "revision">
): JobProcessRecord {
  const now = new Date().toISOString();
  return writeRecord(paths, { ...record, startedAt: now, updatedAt: now, state: "running", revision: 1 });
}

export function markJobProcessFinished(
  paths: TokenPilotPaths,
  jobId: string,
  state: Extract<JobProcessState, "completed" | "failed" | "terminated">
): JobProcessRecord | null {
  const current = readRecord(paths, jobId);
  if (!current) return null;
  if (current.state === state) return current;
  return writeRecord(paths, transitionedRecord(current, state));
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new ServiceError("JOB_PROCESS_RECORD_INVALID", "Tracked process pid is invalid");
  }
  try {
    process.kill(-pid, signal);
  } catch {
    process.kill(pid, signal);
  }
}

export const defaultJobProcessSignalAdapter: JobProcessSignalAdapter = {
  signal: signalProcessGroup
};

function controlPlan(action: JobControlAction, state: JobProcessState): {
  signal: NodeJS.Signals;
  resultingState: Extract<JobProcessState, "running" | "paused" | "terminated">;
} {
  if (action === "pause" && state === "running") return { signal: "SIGSTOP", resultingState: "paused" };
  if (action === "resume" && state === "paused") return { signal: "SIGCONT", resultingState: "running" };
  if (action === "terminate" && (state === "running" || state === "paused")) {
    return { signal: "SIGTERM", resultingState: "terminated" };
  }
  throw new ServiceError("JOB_PROCESS_INVALID_STATE", `Cannot ${action} a job process that is ${state}`);
}

export function prepareJobProcessControl(
  paths: TokenPilotPaths,
  input: { jobId: string; action: JobControlAction; expectedRevision: number }
): PreparedJobProcessControl {
  const current = readRecord(paths, input.jobId);
  if (!current) throw new ServiceError("JOB_PROCESS_NOT_FOUND", `Tracked job process not found: ${input.jobId}`);
  if (current.revision !== input.expectedRevision) {
    throw new ServiceError("REVISION_CONFLICT", `Tracked job process ${input.jobId} revision does not match`);
  }
  const plan = controlPlan(input.action, current.state);
  return {
    jobId: current.jobId,
    action: input.action,
    pid: current.pid,
    signal: plan.signal,
    previousState: current.state as Extract<JobProcessState, "running" | "paused">,
    resultingState: plan.resultingState,
    expectedRevision: current.revision
  };
}

export function signalPreparedJobProcessControl(
  prepared: PreparedJobProcessControl,
  adapter: JobProcessSignalAdapter = defaultJobProcessSignalAdapter
): void {
  try {
    adapter.signal(prepared.pid, prepared.signal);
  } catch (error) {
    throw new ServiceError("JOB_PROCESS_SIGNAL_FAILED", `Failed to ${prepared.action} tracked job process`, { cause: error });
  }
}

export function commitPreparedJobProcessControl(
  paths: TokenPilotPaths,
  prepared: PreparedJobProcessControl
): JobProcessControlResult {
  const current = readRecord(paths, prepared.jobId);
  if (!current) {
    throw new ServiceError("JOB_PROCESS_STATE_CHANGED_AFTER_SIGNAL", `Tracked job process disappeared after ${prepared.action}`);
  }
  if (
    current.revision === prepared.expectedRevision + 1 &&
    current.state === prepared.resultingState
  ) {
    return {
      ok: true, jobId: current.jobId, action: prepared.action, state: current.state,
      revision: current.revision, updatedAt: current.updatedAt, message: `Job process ${prepared.action}d`
    };
  }
  if (current.revision !== prepared.expectedRevision || current.state !== prepared.previousState) {
    throw new ServiceError(
      "JOB_PROCESS_STATE_CHANGED_AFTER_SIGNAL",
      `Tracked job process changed while ${prepared.action} was being committed`
    );
  }
  const next = writeRecord(paths, transitionedRecord(current, prepared.resultingState));
  return {
    ok: true, jobId: next.jobId, action: prepared.action, state: next.state,
    revision: next.revision, updatedAt: next.updatedAt, message: `Job process ${prepared.action}d`
  };
}

export function controlJobProcess(
  paths: TokenPilotPaths,
  jobId: string,
  action: JobControlAction
): { ok: boolean; jobId: string; action: JobControlAction; state: JobProcessState; message: string } {
  const current = readRecord(paths, jobId);
  if (!current) return { ok: false, jobId, action, state: "completed", message: "No tracked process for job" };
  try {
    const prepared = prepareJobProcessControl(paths, { jobId, action, expectedRevision: current.revision });
    signalPreparedJobProcessControl(prepared);
    const result = commitPreparedJobProcessControl(paths, prepared);
    return { ok: true, jobId, action, state: result.state, message: result.message };
  } catch (error) {
    const latest = readRecord(paths, jobId) ?? current;
    return {
      ok: false, jobId, action, state: latest.state,
      message: error instanceof Error ? error.message : `Failed to ${action} job process`
    };
  }
}

export function terminateAllJobProcesses(paths: TokenPilotPaths): {
  ok: true;
  terminated: Array<{ jobId: string; state: JobProcessState; message: string }>;
} {
  return {
    ok: true,
    terminated: listTrackedJobProcesses(paths).map(({ jobId }) => {
      const result = controlJobProcess(paths, jobId, "terminate");
      return { jobId, state: result.state, message: result.message };
    })
  };
}
