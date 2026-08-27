import { createHash } from "node:crypto";

import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import {
  ProcessSupervisorClient,
  ProcessSupervisorClientError
} from "../process-supervisor/client.js";
import type { TokenPilotPaths } from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import { assertChatDirectWriterLease } from "./workspace-mutation-governance.js";

export interface RuntimeRestartInput {
  repoId: string;
  sessionId: string;
  idempotencyKey: string;
}

export interface RuntimeRestartReadInput {
  operationId: string;
}

export type RuntimeRestartState =
  | "scheduled"
  | "running"
  | "succeeded"
  | "failed";
export interface RuntimeRestartRecord {
  operationId: string;
  state: RuntimeRestartState;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
}

interface SupervisorRuntimeRestartRecord extends RuntimeRestartRecord {
  requestHash: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function publicRestartRecord(
  expectedOperationId: string,
  value: SupervisorRuntimeRestartRecord
): RuntimeRestartRecord {
  const states: RuntimeRestartState[] = [
    "scheduled",
    "running",
    "succeeded",
    "failed"
  ];
  if (
    value.operationId !== expectedOperationId ||
    !states.includes(value.state) ||
    !/^[a-f0-9]{64}$/.test(value.requestHash)
  ) {
    throw new ServiceError(
      "RUNTIME_LIFECYCLE_RESPONSE_INVALID",
      "Process Supervisor returned an invalid Runtime lifecycle result"
    );
  }
  for (const timestamp of [value.startedAt, value.completedAt]) {
    if (timestamp !== null && !Number.isFinite(Date.parse(timestamp))) {
      throw new ServiceError(
        "RUNTIME_LIFECYCLE_RESPONSE_INVALID",
        "Process Supervisor returned an invalid Runtime lifecycle timestamp"
      );
    }
  }
  if (value.errorCode !== null && typeof value.errorCode !== "string") {
    throw new ServiceError(
      "RUNTIME_LIFECYCLE_RESPONSE_INVALID",
      "Process Supervisor returned an invalid Runtime lifecycle error"
    );
  }
  return {
    operationId: value.operationId,
    state: value.state,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    errorCode: value.errorCode
  };
}

function mapSupervisorError(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }
  if (error instanceof ProcessSupervisorClientError) {
    return new ServiceError(error.code, error.message, {
      hint: "Verify the local Process Supervisor is ready, then retry the Runtime lifecycle operation."
    });
  }
  return new ServiceError(
    "RUNTIME_LIFECYCLE_UNAVAILABLE",
    "Runtime lifecycle control is unavailable"
  );
}
export interface RuntimeLifecycleSupervisorClient {
  request<T>(
    method: "runtime.restart" | "runtime.restart.read",
    params: unknown
  ): Promise<{ supervisorGeneration: string; result: T }>;
}

export class RuntimeLifecycleService {
  private readonly supervisor: RuntimeLifecycleSupervisorClient;

  constructor(
    paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    supervisor?: RuntimeLifecycleSupervisorClient
  ) {
    this.supervisor = supervisor ?? new ProcessSupervisorClient({ paths });
  }

  async restart(
    context: OperationContext,
    input: RuntimeRestartInput
  ): Promise<RuntimeRestartRecord> {
    const authority = assertChatDirectWriterLease(
      this.repositories,
      context,
      input.repoId,
      input.sessionId
    );
    const operationId = `runtime_restart_${sha256({
      schemaVersion: 1,
      repoId: input.repoId,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey
    }).slice(0, 40)}`;
    const requestHash = sha256({
      schemaVersion: 1,
      action: "restart",
      repoId: input.repoId,
      sessionId: input.sessionId,
      workspaceId: authority.workspace.id
    });
    try {
      const response = await this.supervisor.request<SupervisorRuntimeRestartRecord>(
        "runtime.restart",
        { operationId, requestHash }
      );
      return publicRestartRecord(operationId, response.result);
    } catch (error) {
      throw mapSupervisorError(error);
    }
  }

  async read(input: RuntimeRestartReadInput): Promise<RuntimeRestartRecord> {
    try {
      const response = await this.supervisor.request<SupervisorRuntimeRestartRecord>(
        "runtime.restart.read",
        { operationId: input.operationId }
      );
      return publicRestartRecord(input.operationId, response.result);
    } catch (error) {
      throw mapSupervisorError(error);
    }
  }
}
