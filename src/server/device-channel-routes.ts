import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  DeviceRegistryError,
  type DeviceRegistryStore
} from "../devices/device-registry.js";
import {
  DeviceChannelHub,
  type DeviceChannelCloseReason,
  type DeviceChannelProtocolVersion
} from "../devices/device-channel.js";
import {
  DEVICE_CAPABILITY_RESULT_MAX_BYTES,
  DeviceCapabilityRpc,
  DeviceCapabilityRpcError,
  type DeviceCapabilityResultBody
} from "../devices/device-capability-rpc.js";
import { sendApiError } from "./errors.js";

export const DEVICE_CHANNEL_DEFAULT_PING_INTERVAL_MS = 30_000;
const DEVICE_CHANNEL_MIN_PING_INTERVAL_MS = 10;
const DEVICE_CHANNEL_MAX_PING_INTERVAL_MS = 5 * 60_000;

function headerValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredHeader(
  request: FastifyRequest,
  name: string,
  code: string,
  message: string,
  maxLength: number
): string {
  const value = headerValue(request, name);
  if (!value || value.length > maxLength) {
    throw new DeviceRegistryError(400, code, message);
  }
  return value;
}

function requiredDeviceId(request: FastifyRequest): string {
  const deviceId = requiredHeader(
    request,
    "x-chatcockpit-device-id",
    "DEVICE_NOT_TRUSTED",
    "Device ID is invalid",
    180
  );
  if (!/^cc_device_[A-Za-z0-9_-]{20,80}$/.test(deviceId)) {
    throw new DeviceRegistryError(400, "DEVICE_NOT_TRUSTED", "Device ID is invalid");
  }
  return deviceId;
}

function requiredSequence(request: FastifyRequest): number {
  const raw = requiredHeader(
    request,
    "x-chatcockpit-channel-sequence",
    "DEVICE_SEQUENCE_INVALID",
    "Device channel sequence is invalid",
    24
  );
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new DeviceRegistryError(400, "DEVICE_SEQUENCE_INVALID", "Device channel sequence is invalid");
  }
  const sequence = Number(raw);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new DeviceRegistryError(400, "DEVICE_SEQUENCE_INVALID", "Device channel sequence is invalid");
  }
  return sequence;
}

function optionalProtocolVersion(request: FastifyRequest): DeviceChannelProtocolVersion {
  const value = headerValue(request, "x-chatcockpit-channel-protocol");
  if (value === null || value === "1") return 1;
  if (value === "2") return 2;
  throw new DeviceRegistryError(
    400,
    "DEVICE_CHANNEL_PROTOCOL_UNSUPPORTED",
    "Device channel protocol version is unsupported"
  );
}

function requiredChannelId(request: FastifyRequest): string {
  const channelId = requiredHeader(
    request,
    "x-chatcockpit-channel-id",
    "DEVICE_CHANNEL_ID_INVALID",
    "Device channel ID is invalid",
    180
  );
  if (!/^cc_channel_[A-Za-z0-9_-]{20,80}$/.test(channelId)) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_CHANNEL_ID_INVALID",
      "Device channel ID is invalid"
    );
  }
  return channelId;
}

function requiredResultBody(value: unknown): DeviceCapabilityResultBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_CAPABILITY_RESULT_INVALID",
      "Device capability result body is invalid"
    );
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.requestId !== "string" ||
    !/^cc_device_request_[A-Za-z0-9_-]{20,80}$/.test(body.requestId)
  ) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_CAPABILITY_REQUEST_ID_INVALID",
      "Device capability request ID is invalid"
    );
  }
  if (body.outcome === "ok") {
    if (
      !("result" in body) ||
      "error" in body ||
      Object.keys(body).some(
        (key) => key !== "requestId" && key !== "outcome" && key !== "result"
      )
    ) {
      throw new DeviceRegistryError(
        400,
        "DEVICE_CAPABILITY_RESULT_INVALID",
        "Successful device capability results must contain result only"
      );
    }
    return {
      requestId: body.requestId,
      outcome: "ok",
      result: body.result
    };
  }
  if (body.outcome === "error") {
    if (
      "result" in body ||
      !body.error ||
      typeof body.error !== "object" ||
      Array.isArray(body.error) ||
      Object.keys(body).some(
        (key) => key !== "requestId" && key !== "outcome" && key !== "error"
      )
    ) {
      throw new DeviceRegistryError(
        400,
        "DEVICE_CAPABILITY_RESULT_INVALID",
        "Failed device capability results must contain a bounded error only"
      );
    }
    const error = body.error as Record<string, unknown>;
    if (
      Object.keys(error).some((key) => key !== "code" && key !== "message") ||
      typeof error.code !== "string" ||
      !/^[A-Z0-9_]{1,120}$/.test(error.code) ||
      typeof error.message !== "string" ||
      !error.message.trim() ||
      error.message.length > 1000
    ) {
      throw new DeviceRegistryError(
        400,
        "DEVICE_CAPABILITY_RESULT_INVALID",
        "Device capability error projection is invalid"
      );
    }
    return {
      requestId: body.requestId,
      outcome: "error",
      error: {
        code: error.code,
        message: error.message
      }
    };
  }
  throw new DeviceRegistryError(
    400,
    "DEVICE_CAPABILITY_RESULT_INVALID",
    "Device capability result outcome is invalid"
  );
}

function deviceError(reply: FastifyReply, error: unknown) {
  if (error instanceof DeviceRegistryError || error instanceof DeviceCapabilityRpcError) {
    return sendApiError(reply, error.statusCode, error.code, error.message);
  }
  throw error;
}

function writeSse(
  reply: FastifyReply,
  event: "channel.ready" | "channel.ping" | "channel.close" | "capability.request",
  data: Record<string, unknown>
): boolean {
  if (reply.raw.destroyed || reply.raw.writableEnded) return false;
  return reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerDeviceChannelRoutes(
  app: FastifyInstance,
  store: DeviceRegistryStore,
  channelHub: DeviceChannelHub,
  capabilityRpc: DeviceCapabilityRpc,
  options: {
    now?: () => string;
    pingIntervalMs?: number;
  } = {}
): void {
  const now = options.now ?? (() => new Date().toISOString());
  const pingIntervalMs = options.pingIntervalMs ?? DEVICE_CHANNEL_DEFAULT_PING_INTERVAL_MS;
  if (
    !Number.isInteger(pingIntervalMs) ||
    pingIntervalMs < DEVICE_CHANNEL_MIN_PING_INTERVAL_MS ||
    pingIntervalMs > DEVICE_CHANNEL_MAX_PING_INTERVAL_MS
  ) {
    throw new Error("Device channel ping interval is outside the supported range");
  }

  app.get("/api/devices/channel", async (request, reply) => {
    try {
      const deviceId = requiredDeviceId(request);
      const sequence = requiredSequence(request);
      const protocolVersion = optionalProtocolVersion(request);
      const channelNonce = requiredHeader(
        request,
        "x-chatcockpit-channel-nonce",
        "DEVICE_CHANNEL_NONCE_INVALID",
        "Device channel nonce is invalid",
        160
      );
      const signature = requiredHeader(
        request,
        "x-chatcockpit-channel-signature",
        "DEVICE_SIGNATURE_INVALID",
        "Device channel signature is invalid",
        256
      );
      store.recordChannelOpen(
        { deviceId, sequence, channelNonce, protocolVersion, signature },
        now()
      );

      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("cache-control", "no-store, no-cache, must-revalidate");
      reply.raw.setHeader("connection", "keep-alive");
      reply.raw.setHeader("x-content-type-options", "nosniff");
      reply.raw.setHeader("x-accel-buffering", "no");
      reply.raw.flushHeaders?.();

      let closed = false;
      let registration: ReturnType<DeviceChannelHub["register"]> | null = null;
      let pingTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pingTimer) clearInterval(pingTimer);
        registration?.dispose();
      };

      const close = (reason: DeviceChannelCloseReason) => {
        if (closed) return;
        writeSse(reply, "channel.close", { reason });
        cleanup();
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
      };

      registration = channelHub.register(deviceId, close, {
        protocolVersion,
        ...(protocolVersion === 2
          ? {
              send: (_event, data) =>
                writeSse(
                  reply,
                  "capability.request",
                  data as Record<string, unknown>
                )
            }
          : {})
      });
      reply.raw.once("close", cleanup);
      writeSse(reply, "channel.ready", {
        channelId: registration.channelId,
        deviceId,
        acceptedSequence: sequence,
        protocolVersion
      });
      pingTimer = setInterval(() => {
        if (!writeSse(reply, "channel.ping", { at: now() })) cleanup();
      }, pingIntervalMs);
      pingTimer.unref?.();
      return;
    } catch (error) {
      return deviceError(reply, error);
    }
  });

  app.post(
    "/api/devices/channel/results",
    { bodyLimit: DEVICE_CAPABILITY_RESULT_MAX_BYTES + 32 * 1024 },
    async (request, reply) => {
      try {
        const deviceId = requiredDeviceId(request);
        const channelId = requiredChannelId(request);
        const sequence = requiredSequence(request);
        const signature = requiredHeader(
          request,
          "x-chatcockpit-channel-signature",
          "DEVICE_SIGNATURE_INVALID",
          "Device channel signature is invalid",
          256
        );
        const body = requiredResultBody(request.body);

        capabilityRpc.assertExpectedResult({ deviceId, channelId, body });
        store.recordChannelResult(
          { deviceId, channelId, sequence, body, signature },
          now()
        );
        capabilityRpc.completeExpectedResult({ deviceId, channelId, body });
        return { ok: true, acceptedSequence: sequence };
      } catch (error) {
        return deviceError(reply, error);
      }
    }
  );
}
