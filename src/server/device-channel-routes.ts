import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  DeviceRegistryError,
  type DeviceRegistryStore
} from "../devices/device-registry.js";
import {
  DeviceChannelHub,
  type DeviceChannelCloseReason
} from "../devices/device-channel.js";
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

function deviceError(reply: FastifyReply, error: unknown) {
  if (error instanceof DeviceRegistryError) {
    return sendApiError(reply, error.statusCode, error.code, error.message);
  }
  throw error;
}

function writeSse(
  reply: FastifyReply,
  event: "channel.ready" | "channel.ping" | "channel.close",
  data: Record<string, unknown>
): boolean {
  if (reply.raw.destroyed || reply.raw.writableEnded) return false;
  return reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerDeviceChannelRoutes(
  app: FastifyInstance,
  store: DeviceRegistryStore,
  channelHub: DeviceChannelHub,
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
      store.recordChannelOpen({ deviceId, sequence, channelNonce, signature }, now());

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

      registration = channelHub.register(deviceId, close);
      reply.raw.once("close", cleanup);
      writeSse(reply, "channel.ready", {
        channelId: registration.channelId,
        deviceId,
        acceptedSequence: sequence,
        protocolVersion: 1
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
}
