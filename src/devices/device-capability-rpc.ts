import crypto from "node:crypto";

import type { DeviceChannelHub } from "./device-channel.js";

export const DEVICE_CAPABILITY_REQUEST_MAX_BYTES = 64 * 1024;
export const DEVICE_CAPABILITY_RESULT_MAX_BYTES = 256 * 1024;
export const DEVICE_CAPABILITY_MAX_PENDING_GLOBAL = 64;
export const DEVICE_CAPABILITY_MAX_PENDING_PER_DEVICE = 8;
export const DEVICE_CAPABILITY_DEFAULT_TIMEOUT_MS = 30_000;

export const DEVICE_CAPABILITY_OPERATIONS = [
  "capabilities.list",
  "capabilities.inspect",
  "capabilities.read.invoke",
  "workspace.read.invoke"
] as const;

export type DeviceCapabilityOperation = typeof DEVICE_CAPABILITY_OPERATIONS[number];

export interface DeviceCapabilityRequestEnvelope {
  protocolVersion: 1;
  requestId: string;
  operation: DeviceCapabilityOperation;
  issuedAt: string;
  expiresAt: string;
  payload: unknown;
}

export type DeviceCapabilityResultBody =
  | {
      requestId: string;
      outcome: "ok";
      result: unknown;
    }
  | {
      requestId: string;
      outcome: "error";
      error: {
        code: string;
        message: string;
      };
    };

export class DeviceCapabilityRpcError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DeviceCapabilityRpcError";
  }
}

interface PendingRequest {
  deviceId: string;
  channelId: string;
  envelope: DeviceCapabilityRequestEnvelope;
  resolve: (body: DeviceCapabilityResultBody) => void;
  reject: (error: DeviceCapabilityRpcError) => void;
  timer: NodeJS.Timeout;
}

function encodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new DeviceCapabilityRpcError(
      400,
      "DEVICE_CAPABILITY_PAYLOAD_INVALID",
      "Device capability payload must be JSON serializable"
    );
  }
}

function requestId(): string {
  return `cc_device_request_${crypto.randomBytes(18).toString("base64url")}`;
}

export class DeviceCapabilityRpc {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly unsubscribeLifecycle: () => void;
  private readonly requestTimeoutMs: number;
  private readonly now: () => string;
  private readonly makeRequestId: () => string;
  private closed = false;

  constructor(
    private readonly channels: DeviceChannelHub,
    options: {
      requestTimeoutMs?: number;
      now?: () => string;
      requestIdFactory?: () => string;
    } = {}
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEVICE_CAPABILITY_DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.makeRequestId = options.requestIdFactory ?? requestId;
    this.unsubscribeLifecycle = channels.onLifecycle((event) => {
      for (const pending of [...this.pending.values()]) {
        if (
          pending.deviceId === event.deviceId &&
          pending.channelId === event.channelId
        ) {
          this.rejectPending(
            pending,
            new DeviceCapabilityRpcError(
              503,
              "DEVICE_CAPABILITY_CHANNEL_CLOSED",
              "Device capability channel closed before the request completed"
            )
          );
        }
      }
    });
  }

  request(
    deviceId: string,
    operation: DeviceCapabilityOperation,
    payload: unknown
  ): Promise<DeviceCapabilityResultBody> {
    if (this.closed) {
      return Promise.reject(new DeviceCapabilityRpcError(
        503,
        "DEVICE_CAPABILITY_RPC_CLOSED",
        "Device capability RPC broker is closed"
      ));
    }
    const channel = this.channels.capabilityRpcChannel(deviceId);
    if (!channel) {
      return Promise.reject(new DeviceCapabilityRpcError(
        409,
        "DEVICE_CHANNEL_RPC_UNSUPPORTED",
        "Device does not have an active capability RPC channel"
      ));
    }
    if (operation === "workspace.read.invoke" && channel.protocolVersion < 4) {
      return Promise.reject(new DeviceCapabilityRpcError(
        409,
        "DEVICE_WORKSPACE_RPC_UNSUPPORTED",
        "Device does not support remote workspace requests"
      ));
    }
    if (this.pending.size >= DEVICE_CAPABILITY_MAX_PENDING_GLOBAL) {
      return Promise.reject(new DeviceCapabilityRpcError(
        429,
        "DEVICE_CAPABILITY_REQUEST_LIMIT",
        "Too many device capability requests are already pending"
      ));
    }
    let devicePending = 0;
    for (const pending of this.pending.values()) {
      if (pending.deviceId === deviceId) devicePending += 1;
    }
    if (devicePending >= DEVICE_CAPABILITY_MAX_PENDING_PER_DEVICE) {
      return Promise.reject(new DeviceCapabilityRpcError(
        429,
        "DEVICE_CAPABILITY_DEVICE_REQUEST_LIMIT",
        "Too many capability requests are already pending for this device"
      ));
    }

    const issuedAt = this.now();
    const issuedAtMs = Date.parse(issuedAt);
    const envelope: DeviceCapabilityRequestEnvelope = {
      protocolVersion: 1,
      requestId: this.makeRequestId(),
      operation,
      issuedAt,
      expiresAt: new Date(
        (Number.isFinite(issuedAtMs) ? issuedAtMs : Date.now()) + this.requestTimeoutMs
      ).toISOString(),
      payload
    };
    if (encodedBytes(envelope) > DEVICE_CAPABILITY_REQUEST_MAX_BYTES) {
      return Promise.reject(new DeviceCapabilityRpcError(
        413,
        "DEVICE_CAPABILITY_REQUEST_TOO_LARGE",
        "Device capability request exceeded the allowed size"
      ));
    }

    return new Promise<DeviceCapabilityResultBody>((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = this.pending.get(envelope.requestId);
        if (!current) return;
        this.rejectPending(
          current,
          new DeviceCapabilityRpcError(
            504,
            "DEVICE_CAPABILITY_REQUEST_TIMEOUT",
            "Device capability request timed out"
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
      this.pending.set(envelope.requestId, pending);
      if (!channel.send(envelope)) {
        this.rejectPending(
          pending,
          new DeviceCapabilityRpcError(
            503,
            "DEVICE_CAPABILITY_CHANNEL_CLOSED",
            "Device capability request could not be written to the active channel"
          )
        );
      }
    });
  }

  assertExpectedResult(input: {
    deviceId: string;
    channelId: string;
    body: DeviceCapabilityResultBody;
  }): void {
    if (encodedBytes(input.body) > DEVICE_CAPABILITY_RESULT_MAX_BYTES) {
      throw new DeviceCapabilityRpcError(
        413,
        "DEVICE_CAPABILITY_RESULT_TOO_LARGE",
        "Device capability result exceeded the allowed size"
      );
    }
    const pending = this.pending.get(input.body.requestId);
    if (!pending) {
      throw new DeviceCapabilityRpcError(
        409,
        "DEVICE_CAPABILITY_REQUEST_UNKNOWN",
        "Device capability result does not match a pending request"
      );
    }
    if (pending.deviceId !== input.deviceId) {
      throw new DeviceCapabilityRpcError(
        409,
        "DEVICE_CAPABILITY_DEVICE_MISMATCH",
        "Device capability result came from the wrong device"
      );
    }
    if (pending.channelId !== input.channelId) {
      throw new DeviceCapabilityRpcError(
        409,
        "DEVICE_CAPABILITY_CHANNEL_MISMATCH",
        "Device capability result came from the wrong channel"
      );
    }
    if (Date.parse(pending.envelope.expiresAt) <= Date.parse(this.now())) {
      this.rejectPending(
        pending,
        new DeviceCapabilityRpcError(
          504,
          "DEVICE_CAPABILITY_REQUEST_TIMEOUT",
          "Device capability request timed out"
        )
      );
      throw new DeviceCapabilityRpcError(
        409,
        "DEVICE_CAPABILITY_REQUEST_UNKNOWN",
        "Device capability result arrived after its request expired"
      );
    }
  }

  acceptResult(input: {
    deviceId: string;
    channelId: string;
    body: DeviceCapabilityResultBody;
  }): void {
    this.assertExpectedResult(input);
    this.completeExpectedResult(input);
  }

  completeExpectedResult(input: {
    deviceId: string;
    channelId: string;
    body: DeviceCapabilityResultBody;
  }): void {
    const pending = this.pending.get(input.body.requestId);
    if (!pending) {
      throw new DeviceCapabilityRpcError(
        409,
        "DEVICE_CAPABILITY_REQUEST_UNKNOWN",
        "Device capability result does not match a pending request"
      );
    }
    if (pending.deviceId !== input.deviceId) {
      throw new DeviceCapabilityRpcError(
        409,
        "DEVICE_CAPABILITY_DEVICE_MISMATCH",
        "Device capability result came from the wrong device"
      );
    }
    if (pending.channelId !== input.channelId) {
      throw new DeviceCapabilityRpcError(
        409,
        "DEVICE_CAPABILITY_CHANNEL_MISMATCH",
        "Device capability result came from the wrong channel"
      );
    }
    this.pending.delete(input.body.requestId);
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
        new DeviceCapabilityRpcError(
          503,
          "DEVICE_CAPABILITY_RPC_CLOSED",
          "Device capability RPC broker is closed"
        )
      );
    }
  }

  private rejectPending(
    pending: PendingRequest,
    error: DeviceCapabilityRpcError
  ): void {
    if (this.pending.get(pending.envelope.requestId) !== pending) return;
    this.pending.delete(pending.envelope.requestId);
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}
