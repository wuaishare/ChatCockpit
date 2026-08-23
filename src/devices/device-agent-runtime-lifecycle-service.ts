import type { DeviceRuntimeLifecycleAdapter } from "./device-runtime-lifecycle-adapter.js";
import {
  DeviceRuntimeLifecycleError,
  type DeviceRuntimeConditions
} from "./device-runtime-lifecycle.js";
import type {
  DeviceRuntimeLifecycleRequestEnvelope,
  DeviceRuntimeLifecycleResultBody
} from "./device-runtime-lifecycle-rpc.js";
import {
  DeviceRuntimeOperationStore,
  DeviceRuntimeOperationStoreError,
  type DeviceRuntimeMutationAction,
  type DeviceRuntimeOperationRecord
} from "./device-runtime-operation-store.js";

export interface DeviceAgentRuntimeLifecycleServiceOptions {
  runtimeDir: string;
  adapter: DeviceRuntimeLifecycleAdapter;
  now?: () => string;
}

function errorResult(
  operationId: string,
  code: string,
  message: string
): DeviceRuntimeLifecycleResultBody {
  return { operationId, outcome: "error", error: { code, message } };
}
function operationProjection(record: DeviceRuntimeOperationRecord) {
  return {
    operationId: record.operationId,
    action: record.action,
    state: record.state,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    result: record.result,
    errorCode: record.errorCode
  };
}

function replayResult(record: DeviceRuntimeOperationRecord): DeviceRuntimeLifecycleResultBody {
  if (record.state === "succeeded" && record.result) {
    return { operationId: record.operationId, outcome: "ok", result: record.result };
  }
  if (record.state === "failed") {
    return errorResult(
      record.operationId,
      record.errorCode ?? "DEVICE_RUNTIME_OPERATION_FAILED",
      "Device Runtime lifecycle operation failed"
    );
  }
  if (record.state === "ambiguous") {
    return errorResult(
      record.operationId,
      "DEVICE_RUNTIME_OPERATION_AMBIGUOUS",
      "Device Runtime lifecycle outcome is ambiguous; query operation.get"
    );
  }
  return errorResult(
    record.operationId,
    "DEVICE_RUNTIME_OPERATION_IN_PROGRESS",
    "Device Runtime lifecycle operation is already in progress"
  );
}
function postflightSatisfied(
  action: DeviceRuntimeMutationAction,
  conditions: DeviceRuntimeConditions
): boolean {
  if (action === "stop") {
    return (
      conditions.controlPlane === "stopped" &&
      conditions.runner === "stopped" &&
      conditions.processSupervisor === "stopped"
    );
  }
  return (
    conditions.controlPlane === "running" &&
    conditions.runner === "registered" &&
    conditions.processSupervisor === "ready"
  );
}

function stableErrorCode(error: unknown): string {
  if (error instanceof DeviceRuntimeLifecycleError) return error.code;
  if (error instanceof DeviceRuntimeOperationStoreError) return error.code;
  return "DEVICE_RUNTIME_OPERATION_FAILED";
}

export class DeviceAgentRuntimeLifecycleService {
  private readonly store: DeviceRuntimeOperationStore;
  private readonly now: () => string;

  constructor(private readonly options: DeviceAgentRuntimeLifecycleServiceOptions) {
    this.store = new DeviceRuntimeOperationStore({ runtimeDir: options.runtimeDir });
    this.now = options.now ?? (() => new Date().toISOString());
    this.store.recoverExecutingAsAmbiguous(this.now());
  }
  close(): void {
    this.store.close();
  }

  operation(operationId: string): DeviceRuntimeOperationRecord | null {
    return this.store.get(operationId);
  }

  async execute(
    request: DeviceRuntimeLifecycleRequestEnvelope
  ): Promise<DeviceRuntimeLifecycleResultBody> {
    const now = this.now();
    const issuedAt = Date.parse(request.issuedAt);
    const expiresAt = Date.parse(request.expiresAt);
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= issuedAt ||
      expiresAt <= Date.parse(now)
    ) {
      return errorResult(
        request.operationId,
        "DEVICE_RUNTIME_LIFECYCLE_REQUEST_EXPIRED",
        "Device Runtime lifecycle request has expired"
      );
    }
    if (request.action === "status") {
      try {
        const result = await this.options.adapter.status();
        return { operationId: request.operationId, outcome: "ok", result };
      } catch (error) {
        return errorResult(
          request.operationId,
          stableErrorCode(error),
          "Device Runtime status could not be observed"
        );
      }
    }

    if (request.action === "operation.get") {
      const record = this.store.get(request.operationId);
      if (!record) {
        return errorResult(
          request.operationId,
          "DEVICE_RUNTIME_OPERATION_NOT_FOUND",
          "Device Runtime operation was not found"
        );
      }
      return { operationId: request.operationId, outcome: "ok", result: operationProjection(record) };
    }
    let prepared: DeviceRuntimeOperationRecord;
    try {
      prepared = this.store.prepare(request, this.now());
    } catch (error) {
      return errorResult(
        request.operationId,
        stableErrorCode(error),
        "Device Runtime operation request conflicts with durable history"
      );
    }
    if (prepared.state !== "prepared") return replayResult(prepared);

    const action = prepared.action;
    this.store.markExecuting(prepared.operationId, this.now());
    try {
      await this.invoke(action);
      const conditions = await this.options.adapter.status();
      if (!postflightSatisfied(action, conditions)) {
        throw new DeviceRuntimeLifecycleError(
          "DEVICE_RUNTIME_ACTION_FAILED",
          "Device Runtime lifecycle postflight did not reach the requested state"
        );
      }
      const succeeded = this.store.markSucceeded(
        prepared.operationId,
        conditions,
        this.now()
      );
      return replayResult(succeeded);
    } catch (error) {
      const code = stableErrorCode(error);
      const failed = this.store.markFailed(prepared.operationId, code, this.now());
      return replayResult(failed);
    }
  }

  private async invoke(action: DeviceRuntimeMutationAction): Promise<void> {
    if (action === "start") return this.options.adapter.start();
    if (action === "stop") return this.options.adapter.stop();
    return this.options.adapter.restart();
  }
}
