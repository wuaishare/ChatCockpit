import type { DeviceChannelHub } from "./device-channel.js";

export const DEVICE_RUNTIME_LIFECYCLE_REQUEST_MAX_BYTES = 8 * 1024;
export const DEVICE_RUNTIME_LIFECYCLE_RESULT_MAX_BYTES = 64 * 1024;
export const DEVICE_RUNTIME_LIFECYCLE_MAX_PENDING_GLOBAL = 64;
export const DEVICE_RUNTIME_LIFECYCLE_MAX_PENDING_PER_DEVICE = 8;
export const DEVICE_RUNTIME_LIFECYCLE_DEFAULT_TIMEOUT_MS = 30_000;

export const DEVICE_RUNTIME_LIFECYCLE_ACTIONS = [
  "status",
  "start",
  "stop",
  "restart",
  "operation.get"
] as const;

export type DeviceRuntimeLifecycleAction =
  typeof DEVICE_RUNTIME_LIFECYCLE_ACTIONS[number];

export interface DeviceRuntimeLifecycleRequestEnvelope {
  protocolVersion: 1;
  operationId: string;
  action: DeviceRuntimeLifecycleAction;
  issuedAt: string;
  expiresAt: string;
  expectedStateRevision?: number;
}

export type DeviceRuntimeLifecycleResultBody =
  | {
      operationId: string;
      outcome: "ok";
      result: unknown;
    }
  | {
      operationId: string;
      outcome: "error";
      error: {
        code: string;
        message: string;
      };
    };

export class DeviceRuntimeLifecycleRpcError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DeviceRuntimeLifecycleRpcError";
  }
}

interface PendingRequest {
  deviceId: string;
  channelId: string;
  envelope: DeviceRuntimeLifecycleRequestEnvelope;
  resolve: (body: DeviceRuntimeLifecycleResultBody) => void;
  reject: (error: DeviceRuntimeLifecycleRpcError) => void;
  timer: NodeJS.Timeout;
}

function encodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new DeviceRuntimeLifecycleRpcError(
      400,
      "DEVICE_RUNTIME_LIFECYCLE_PAYLOAD_INVALID",
      "Device Runtime lifecycle payload must be JSON serializable"
    );
  }
}

function validateOperationId(operationId: string): void {
  if (!/^cc_device_runtime_op_[A-Za-z0-9_-]{20,120}$/.test(operationId)) {
    throw new DeviceRuntimeLifecycleRpcError(
      400,
      "DEVICE_RUNTIME_LIFECYCLE_OPERATION_ID_INVALID",
      "Device Runtime lifecycle operation ID is invalid"
    );
  }
}

function validateExpectedRevision(value: number | undefined): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new DeviceRuntimeLifecycleRpcError(
      400,
      "DEVICE_RUNTIME_LIFECYCLE_REVISION_INVALID",
      "Device Runtime lifecycle expected state revision is invalid"
    );
  }
}

export class DeviceRuntimeLifecycleRpc {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly unsubscribeLifecycle: () => void;
  private readonly requestTimeoutMs: number;
  private readonly now: () => string;
  private closed = false;

  constructor(
    private readonly channels: DeviceChannelHub,
    options: {
      requestTimeoutMs?: number;
      now?: () => string;
    } = {}
  ) {
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEVICE_RUNTIME_LIFECYCLE_DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.unsubscribeLifecycle = channels.onLifecycle((event) => {
      for (const pending of [...this.pending.values()]) {
        if (
          pending.deviceId === event.deviceId &&
          pending.channelId === event.channelId
        ) {
          this.rejectPending(
            pending,
            new DeviceRuntimeLifecycleRpcError(
              503,
              "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_CLOSED",
              "Device Runtime lifecycle channel closed before the request completed"
            )
          );
        }
      }
    });
  }

  request(
    deviceId: string,
    input: {
      operationId: string;
      action: DeviceRuntimeLifecycleAction;
      expectedStateRevision?: number;
    }
  ): Promise<DeviceRuntimeLifecycleResultBody> {
    try {
      validateOperationId(input.operationId);
      validateExpectedRevision(input.expectedStateRevision);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.closed) {
      return Promise.reject(new DeviceRuntimeLifecycleRpcError(
        503,
        "DEVICE_RUNTIME_LIFECYCLE_RPC_CLOSED",
        "Device Runtime lifecycle RPC broker is closed"
      ));
    }
    if (!DEVICE_RUNTIME_LIFECYCLE_ACTIONS.includes(input.action)) {
      return Promise.reject(new DeviceRuntimeLifecycleRpcError(
        400,
        "DEVICE_RUNTIME_LIFECYCLE_ACTION_INVALID",
        "Device Runtime lifecycle action is invalid"
      ));
    }
    if (this.pending.has(input.operationId)) {
      return Promise.reject(new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_OPERATION_PENDING",
        "Device Runtime lifecycle operation is already pending"
      ));
    }
    const channel = this.channels.runtimeLifecycleRpcChannel(deviceId);
    if (!channel) {
      return Promise.reject(new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_UNSUPPORTED",
        "Device does not have an active Runtime lifecycle channel"
      ));
    }
    if (this.pending.size >= DEVICE_RUNTIME_LIFECYCLE_MAX_PENDING_GLOBAL) {
      return Promise.reject(new DeviceRuntimeLifecycleRpcError(
        429,
        "DEVICE_RUNTIME_LIFECYCLE_REQUEST_LIMIT",
        "Too many Device Runtime lifecycle requests are already pending"
      ));
    }
    let devicePending = 0;
    for (const pending of this.pending.values()) {
      if (pending.deviceId === deviceId) devicePending += 1;
    }
    if (devicePending >= DEVICE_RUNTIME_LIFECYCLE_MAX_PENDING_PER_DEVICE) {
      return Promise.reject(new DeviceRuntimeLifecycleRpcError(
        429,
        "DEVICE_RUNTIME_LIFECYCLE_DEVICE_REQUEST_LIMIT",
        "Too many Runtime lifecycle requests are pending for this device"
      ));
    }

    const issuedAt = this.now();
    const issuedAtMs = Date.parse(issuedAt);
    const envelope: DeviceRuntimeLifecycleRequestEnvelope = {
      protocolVersion: 1,
      operationId: input.operationId,
      action: input.action,
      issuedAt,
      expiresAt: new Date(
        (Number.isFinite(issuedAtMs) ? issuedAtMs : Date.now()) + this.requestTimeoutMs
      ).toISOString(),
      ...(input.expectedStateRevision === undefined
        ? {}
        : { expectedStateRevision: input.expectedStateRevision })
    };
    if (encodedBytes(envelope) > DEVICE_RUNTIME_LIFECYCLE_REQUEST_MAX_BYTES) {
      return Promise.reject(new DeviceRuntimeLifecycleRpcError(
        413,
        "DEVICE_RUNTIME_LIFECYCLE_REQUEST_TOO_LARGE",
        "Device Runtime lifecycle request exceeded the allowed size"
      ));
    }

    return new Promise<DeviceRuntimeLifecycleResultBody>((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = this.pending.get(envelope.operationId);
        if (!current) return;
        this.rejectPending(
          current,
          new DeviceRuntimeLifecycleRpcError(
            504,
            "DEVICE_RUNTIME_LIFECYCLE_REQUEST_TIMEOUT",
            "Device Runtime lifecycle request timed out"
          )
        );
      }, this.requestTimeoutMs);
      timer.unref?.();
      const pending: PendingRequest = {
        deviceId,
        channelId: channel.channelId,
        envelope,
        resolve,
        reject,
        timer
      };
      this.pending.set(envelope.operationId, pending);
      if (!channel.send(envelope)) {
        this.rejectPending(
          pending,
          new DeviceRuntimeLifecycleRpcError(
            503,
            "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_CLOSED",
            "Device Runtime lifecycle request could not be written to the active channel"
          )
        );
      }
    });
  }

  assertExpectedResult(input: {
    deviceId: string;
    channelId: string;
    body: DeviceRuntimeLifecycleResultBody;
  }): void {
    if (encodedBytes(input.body) > DEVICE_RUNTIME_LIFECYCLE_RESULT_MAX_BYTES) {
      throw new DeviceRuntimeLifecycleRpcError(
        413,
        "DEVICE_RUNTIME_LIFECYCLE_RESULT_TOO_LARGE",
        "Device Runtime lifecycle result exceeded the allowed size"
      );
    }
    const pending = this.pending.get(input.body.operationId);
    if (!pending) {
      throw new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_OPERATION_UNKNOWN",
        "Device Runtime lifecycle result does not match a pending operation"
      );
    }
    if (pending.deviceId !== input.deviceId) {
      throw new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_DEVICE_MISMATCH",
        "Device Runtime lifecycle result came from the wrong device"
      );
    }
    if (pending.channelId !== input.channelId) {
      throw new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_MISMATCH",
        "Device Runtime lifecycle result came from the wrong channel"
      );
    }
    if (Date.parse(pending.envelope.expiresAt) <= Date.parse(this.now())) {
      this.rejectPending(
        pending,
        new DeviceRuntimeLifecycleRpcError(
          504,
          "DEVICE_RUNTIME_LIFECYCLE_REQUEST_TIMEOUT",
          "Device Runtime lifecycle request timed out"
        )
      );
      throw new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_OPERATION_UNKNOWN",
        "Device Runtime lifecycle result arrived after its operation expired"
      );
    }
  }

  completeExpectedResult(input: {
    deviceId: string;
    channelId: string;
    body: DeviceRuntimeLifecycleResultBody;
  }): void {
    const pending = this.pending.get(input.body.operationId);
    if (!pending) {
      throw new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_OPERATION_UNKNOWN",
        "Device Runtime lifecycle result does not match a pending operation"
      );
    }
    if (pending.deviceId !== input.deviceId) {
      throw new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_DEVICE_MISMATCH",
        "Device Runtime lifecycle result came from the wrong device"
      );
    }
    if (pending.channelId !== input.channelId) {
      throw new DeviceRuntimeLifecycleRpcError(
        409,
        "DEVICE_RUNTIME_LIFECYCLE_CHANNEL_MISMATCH",
        "Device Runtime lifecycle result came from the wrong channel"
      );
    }
    this.pending.delete(input.body.operationId);
    clearTimeout(pending.timer);
    pending.resolve(input.body);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeLifecycle();
    for (const pending of [...this.pending.values()]) {
      this.rejectPending(
        pending,
        new DeviceRuntimeLifecycleRpcError(
          503,
          "DEVICE_RUNTIME_LIFECYCLE_RPC_CLOSED",
          "Device Runtime lifecycle RPC broker is closed"
        )
      );
    }
  }

  private rejectPending(
    pending: PendingRequest,
    error: DeviceRuntimeLifecycleRpcError
  ): void {
    if (this.pending.get(pending.envelope.operationId) !== pending) return;
    this.pending.delete(pending.envelope.operationId);
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}
