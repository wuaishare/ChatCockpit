import fs from "node:fs";

import { writeJson } from "../core/files.js";
import type { TokenPilotPaths } from "../types.js";

type RunnerMode = "once" | "watch";

export interface RunnerStatusRecord {
  startedAt?: string;
  stoppedAt?: string;
  heartbeatAt?: string;
  lastJobClaimedAt?: string;
  lastJobCompletedAt?: string;
  lastJobFailedAt?: string;
  lastJobId?: string;
  lastJobType?: string;
  lastError?: string;
  mode: RunnerMode;
  pid: number;
  state: "idle" | "processing" | "stopped";
}

function readStatus(paths: TokenPilotPaths): RunnerStatusRecord | null {
  if (!fs.existsSync(paths.runnerStatusPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(paths.runnerStatusPath, "utf8")) as RunnerStatusRecord;
}

function writeStatus(paths: TokenPilotPaths, value: RunnerStatusRecord): void {
  writeJson(paths.runnerStatusPath, value);
  fs.writeFileSync(paths.runnerPidPath, `${process.pid}\n`, "utf8");
}

export function markRunnerStarted(
  paths: TokenPilotPaths,
  mode: RunnerMode
): RunnerStatusRecord {
  const now = new Date().toISOString();
  const current = readStatus(paths);
  const next: RunnerStatusRecord = {
    ...(current ?? {}),
    startedAt: now,
    heartbeatAt: now,
    mode,
    pid: process.pid,
    state: "idle",
    stoppedAt: undefined,
    lastError: undefined
  };
  writeStatus(paths, next);
  return next;
}

export function markRunnerHeartbeat(paths: TokenPilotPaths): void {
  const current = readStatus(paths);
  if (!current) {
    return;
  }
  writeStatus(paths, {
    ...current,
    heartbeatAt: new Date().toISOString()
  });
}

export function markRunnerClaimed(
  paths: TokenPilotPaths,
  jobId: string,
  jobType: string
): void {
  const current = readStatus(paths);
  const now = new Date().toISOString();
  writeStatus(paths, {
    ...(current ?? {
      mode: "once",
      pid: process.pid,
      state: "idle"
    }),
    heartbeatAt: now,
    lastJobClaimedAt: now,
    lastJobId: jobId,
    lastJobType: jobType,
    pid: process.pid,
    state: "processing"
  });
}

export function markRunnerCompleted(paths: TokenPilotPaths): void {
  const current = readStatus(paths);
  const now = new Date().toISOString();
  if (!current) {
    return;
  }
  writeStatus(paths, {
    ...current,
    heartbeatAt: now,
    lastJobCompletedAt: now,
    state: "idle",
    lastError: undefined
  });
}

export function markRunnerFailed(paths: TokenPilotPaths, error: string): void {
  const current = readStatus(paths);
  const now = new Date().toISOString();
  writeStatus(paths, {
    ...(current ?? {
      mode: "once",
      pid: process.pid,
      state: "idle"
    }),
    heartbeatAt: now,
    lastJobFailedAt: now,
    state: "idle",
    lastError: error
  });
}

export function markRunnerStopped(paths: TokenPilotPaths): void {
  const current = readStatus(paths);
  const now = new Date().toISOString();
  if (!current) {
    return;
  }
  writeStatus(paths, {
    ...current,
    heartbeatAt: now,
    stoppedAt: now,
    state: "stopped"
  });
}
