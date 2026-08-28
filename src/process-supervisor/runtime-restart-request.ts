import { createHash, randomUUID } from "node:crypto";

import type { TokenPilotPaths } from "../types.js";
import { ProcessSupervisorClient } from "./client.js";

export type LocalRuntimeRestartState =
  | "scheduled"
  | "running"
  | "succeeded"
  | "failed";

interface SupervisorRuntimeRestartRecord {
  operationId: string;
  requestHash: string;
  state: LocalRuntimeRestartState;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
}

export interface LocalRuntimeRestartRequestResult {
  operationId: string;
  state: LocalRuntimeRestartState;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  supervisorGeneration: string;
}

export interface LocalRuntimeRestartClient {
  request<T>(
    method: "runtime.restart" | "runtime.restart.read",
    params: unknown
  ): Promise<{ supervisorGeneration: string; result: T }>;
}

export class LocalRuntimeRestartRequestError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LocalRuntimeRestartRequestError";
  }
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function publicResult(
  expectedOperationId: string,
  expectedRequestHash: string,
  supervisorGeneration: string,
  value: SupervisorRuntimeRestartRecord
): LocalRuntimeRestartRequestResult {
  const states: LocalRuntimeRestartState[] = [
    "scheduled",
    "running",
    "succeeded",
    "failed"
  ];
  if (
    value.operationId !== expectedOperationId ||
    value.requestHash !== expectedRequestHash ||
    !states.includes(value.state)
  ) {
    throw new LocalRuntimeRestartRequestError(
      "RUNTIME_RESTART_RESPONSE_INVALID",
      "Process Supervisor returned an invalid Runtime restart response"
    );
  }
  return {
    operationId: value.operationId,
    state: value.state,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    errorCode: value.errorCode,
    supervisorGeneration
  };
}

export async function requestLocalRuntimeRestart(
  paths: TokenPilotPaths,
  options: {
    nonce?: string;
    client?: LocalRuntimeRestartClient;
    waitForCompletion?: boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<LocalRuntimeRestartRequestResult> {
  const nonce = options.nonce ?? randomUUID();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(nonce)) {
    throw new LocalRuntimeRestartRequestError(
      "RUNTIME_RESTART_NONCE_INVALID",
      "Runtime restart request nonce is invalid"
    );
  }
  const operationId = `runtime_restart_local_${nonce}`;
  const requestHash = sha256({
    schemaVersion: 1,
    action: "restart",
    source: "local-runtime-entry",
    nonce
  });
  const client = options.client ?? new ProcessSupervisorClient({ paths });
  const response = await client.request<SupervisorRuntimeRestartRecord>(
    "runtime.restart",
    { operationId, requestHash }
  );
  const supervisorGeneration = response.supervisorGeneration;
  let result = publicResult(
    operationId,
    requestHash,
    supervisorGeneration,
    response.result
  );
  if (!options.waitForCompletion || result.state === "succeeded" || result.state === "failed") {
    return result;
  }

  const timeoutMs = Math.max(0, options.timeoutMs ?? 30_000);
  const pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 100);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  while (result.state === "scheduled" || result.state === "running") {
    if (Date.now() >= deadline) {
      throw new LocalRuntimeRestartRequestError(
        "RUNTIME_RESTART_TIMEOUT",
        "Runtime restart did not reach a terminal state before the local wait timeout"
      );
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    const read = await client.request<SupervisorRuntimeRestartRecord>(
      "runtime.restart.read",
      { operationId }
    );
    if (read.supervisorGeneration !== supervisorGeneration) {
      throw new LocalRuntimeRestartRequestError(
        "RUNTIME_RESTART_SUPERVISOR_CHANGED",
        "Process Supervisor generation changed while waiting for Runtime restart completion"
      );
    }
    result = publicResult(
      operationId,
      requestHash,
      supervisorGeneration,
      read.result
    );
  }
  return result;
}
