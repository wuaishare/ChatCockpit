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
    method: "runtime.restart",
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
  return publicResult(
    operationId,
    requestHash,
    response.supervisorGeneration,
    response.result
  );
}
