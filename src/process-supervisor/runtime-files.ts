import { randomBytes } from "node:crypto";
import fs from "node:fs";

import type { TokenPilotPaths } from "../types.js";
import { PROCESS_SUPERVISOR_PROTOCOL_VERSION } from "./protocol.js";

export interface ProcessSupervisorStatus {
  generation: string;
  startedAt: string;
  heartbeatAt: string;
  state: "starting" | "ready" | "stopping";
  ownedProcessCount: number;
  protocolVersion: 1;
}

export function ensureProcessSupervisorRuntime(paths: TokenPilotPaths): void {
  fs.mkdirSync(paths.runtimeDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(paths.runtimeDir, 0o700);
}

function writePrivateFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function rotateProcessSupervisorToken(paths: TokenPilotPaths): string {
  ensureProcessSupervisorRuntime(paths);
  const token = randomBytes(32).toString("base64url");
  writePrivateFile(paths.processSupervisorTokenPath, `${token}\n`);
  return token;
}

export function readProcessSupervisorToken(paths: TokenPilotPaths): string {
  const token = fs.readFileSync(paths.processSupervisorTokenPath, "utf8").trim();
  if (token.length < 32) {
    throw new Error("Process Supervisor token is missing or invalid");
  }
  return token;
}

export function writeProcessSupervisorStatus(
  paths: TokenPilotPaths,
  status: ProcessSupervisorStatus
): void {
  if (status.protocolVersion !== PROCESS_SUPERVISOR_PROTOCOL_VERSION) {
    throw new Error("Process Supervisor status protocol version is invalid");
  }
  ensureProcessSupervisorRuntime(paths);
  writePrivateFile(
    paths.processSupervisorStatusPath,
    `${JSON.stringify(status, null, 2)}\n`
  );
}

export function writeProcessSupervisorPid(paths: TokenPilotPaths, pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Process Supervisor PID must be a positive integer");
  }
  ensureProcessSupervisorRuntime(paths);
  writePrivateFile(paths.processSupervisorPidPath, `${pid}\n`);
}

export function removeProcessSupervisorPid(paths: TokenPilotPaths): void {
  fs.rmSync(paths.processSupervisorPidPath, { force: true });
}

export function removeStaleProcessSupervisorSocket(paths: TokenPilotPaths): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(paths.processSupervisorSocketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!stat.isSocket()) {
    throw new Error(
      "Process Supervisor socket path is occupied by a non-socket file; refusing stale-socket cleanup"
    );
  }
  fs.unlinkSync(paths.processSupervisorSocketPath);
}

export function tightenProcessSupervisorSocketPermissions(paths: TokenPilotPaths): void {
  const stat = fs.lstatSync(paths.processSupervisorSocketPath);
  if (!stat.isSocket()) {
    throw new Error("Process Supervisor socket path is not a Unix socket");
  }
  fs.chmodSync(paths.processSupervisorSocketPath, 0o600);
}
