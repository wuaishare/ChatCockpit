export const DEVICE_AGENT_TRANSPORT_MAX_JSON_BYTES = 64 * 1024;
export const DEVICE_AGENT_CHANNEL_MAX_EVENT_BYTES = 16 * 1024;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class DeviceAgentTransportError extends Error {
  constructor(
    readonly statusCode: number | null,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DeviceAgentTransportError";
  }
}

export interface DeviceAgentChannelOpenInput {
  deviceId: string;
  sequence: number;
  channelNonce: string;
  signature: string;
  signal?: AbortSignal;
}

export type DeviceAgentChannelEvent =
  | {
      type: "channel.ready";
      channelId: string;
      deviceId: string;
      acceptedSequence: number;
      protocolVersion: 1;
    }
  | { type: "channel.ping"; at: string }
  | { type: "channel.close"; reason: "superseded" | "revoked" | "server-shutdown" };

export interface DeviceAgentChannelConnection {
  events: AsyncIterable<DeviceAgentChannelEvent>;
  close(): void;
}

export interface DeviceAgentTransport {
  getHubIdentity(origin: string, signal?: AbortSignal): Promise<unknown>;
  proveHubIdentity(origin: string, nonce: string, signal?: AbortSignal): Promise<unknown>;
  createEnrollment(origin: string, body: unknown): Promise<unknown>;
  pollEnrollment(origin: string, enrollmentId: string, body: unknown): Promise<unknown>;
  heartbeat(origin: string, body: unknown): Promise<unknown>;
  openChannel(origin: string, input: DeviceAgentChannelOpenInput): Promise<DeviceAgentChannelConnection>;
}

interface ApiProblemBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

function endpoint(origin: string, pathname: string): URL {
  return new URL(pathname, `${origin}/`);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function apiProblem(statusCode: number, body: unknown): DeviceAgentTransportError {
  const candidate = body && typeof body === "object" ? body as ApiProblemBody : {};
  const code = typeof candidate.error?.code === "string"
    ? candidate.error.code
    : "DEVICE_AGENT_HUB_ERROR";
  const message = typeof candidate.error?.message === "string"
    ? candidate.error.message
    : `Hub device protocol request failed with HTTP ${statusCode}`;
  return new DeviceAgentTransportError(statusCode, code, message);
}

async function parseBoundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > DEVICE_AGENT_TRANSPORT_MAX_JSON_BYTES) {
    throw new DeviceAgentTransportError(
      response.status,
      "DEVICE_AGENT_RESPONSE_TOO_LARGE",
      "Hub device protocol response exceeded the allowed size"
    );
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DeviceAgentTransportError(
      response.status,
      "DEVICE_AGENT_RESPONSE_INVALID",
      "Hub returned a non-JSON device protocol response"
    );
  }
}

function channelProtocolError(message: string): DeviceAgentTransportError {
  return new DeviceAgentTransportError(502, "DEVICE_AGENT_CHANNEL_INVALID", message);
}

function parseChannelEvent(frame: string): DeviceAgentChannelEvent {
  if (Buffer.byteLength(frame, "utf8") > DEVICE_AGENT_CHANNEL_MAX_EVENT_BYTES) {
    throw new DeviceAgentTransportError(
      502,
      "DEVICE_AGENT_CHANNEL_EVENT_TOO_LARGE",
      "Hub device channel event exceeded the allowed size"
    );
  }
  let eventName = "";
  let dataText = "";
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      if (eventName) throw channelProtocolError("Hub device channel event contains duplicate event fields");
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      if (dataText) throw channelProtocolError("Hub device channel event contains duplicate data fields");
      dataText = line.slice("data:".length).trim();
      continue;
    }
    throw channelProtocolError("Hub device channel event contains an unsupported field");
  }
  if (!eventName || !dataText) throw channelProtocolError("Hub device channel event is incomplete");
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(dataText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    data = parsed as Record<string, unknown>;
  } catch {
    throw channelProtocolError("Hub device channel event contains invalid JSON");
  }
  if (eventName === "channel.ready") {
    if (
      typeof data.channelId !== "string" ||
      !/^cc_channel_[A-Za-z0-9_-]{20,80}$/.test(data.channelId) ||
      typeof data.deviceId !== "string" ||
      !/^cc_device_[A-Za-z0-9_-]{20,80}$/.test(data.deviceId) ||
      !Number.isSafeInteger(data.acceptedSequence) ||
      Number(data.acceptedSequence) <= 0 ||
      data.protocolVersion !== 1
    ) {
      throw channelProtocolError("Hub returned an invalid channel.ready event");
    }
    return {
      type: "channel.ready",
      channelId: data.channelId,
      deviceId: data.deviceId,
      acceptedSequence: Number(data.acceptedSequence),
      protocolVersion: 1
    };
  }
  if (eventName === "channel.ping") {
    if (typeof data.at !== "string" || Number.isNaN(Date.parse(data.at))) {
      throw channelProtocolError("Hub returned an invalid channel.ping event");
    }
    return { type: "channel.ping", at: data.at };
  }
  if (eventName === "channel.close") {
    if (data.reason !== "superseded" && data.reason !== "revoked" && data.reason !== "server-shutdown") {
      throw channelProtocolError("Hub returned an invalid channel.close event");
    }
    return { type: "channel.close", reason: data.reason };
  }
  throw channelProtocolError("Hub returned an unsupported device channel event");
}

async function* readChannelEvents(
  response: Response,
  controller: AbortController,
  cleanupSignal: () => void
): AsyncGenerator<DeviceAgentChannelEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    cleanupSignal();
    throw channelProtocolError("Hub device channel response did not include a stream body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (error) {
        if (controller.signal.aborted) return;
        throw new DeviceAgentTransportError(
          null,
          "DEVICE_AGENT_CHANNEL_NETWORK_ERROR",
          `Device channel stream failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      while (true) {
        const lfIndex = buffer.indexOf("\n\n");
        const crlfIndex = buffer.indexOf("\r\n\r\n");
        const index = lfIndex >= 0 && crlfIndex >= 0
          ? Math.min(lfIndex, crlfIndex)
          : Math.max(lfIndex, crlfIndex);
        if (index < 0) break;
        const delimiterLength = index === crlfIndex && crlfIndex >= 0 ? 4 : 2;
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + delimiterLength);
        if (frame.trim()) yield parseChannelEvent(frame);
      }
      if (Buffer.byteLength(buffer, "utf8") > DEVICE_AGENT_CHANNEL_MAX_EVENT_BYTES) {
        throw new DeviceAgentTransportError(
          502,
          "DEVICE_AGENT_CHANNEL_EVENT_TOO_LARGE",
          "Hub device channel event exceeded the allowed size"
        );
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw channelProtocolError("Hub device channel closed with an incomplete event");
  } finally {
    cleanupSignal();
    try {
      await reader.cancel();
    } catch {
      // Best-effort stream cleanup.
    }
  }
}

export class HttpDeviceAgentTransport implements DeviceAgentTransport {
  private readonly fetchImpl: FetchLike;

  constructor(options: { fetchImpl?: FetchLike } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getHubIdentity(origin: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(origin, "/api/hub/identity", { method: "GET", signal });
  }

  proveHubIdentity(origin: string, nonce: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(origin, "/api/hub/identity/proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce }),
      signal
    });
  }

  createEnrollment(origin: string, body: unknown): Promise<unknown> {
    return this.request(origin, "/api/devices/enrollment-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  pollEnrollment(origin: string, enrollmentId: string, body: unknown): Promise<unknown> {
    return this.request(
      origin,
      `/api/devices/enrollment-requests/${encodeURIComponent(enrollmentId)}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );
  }

  heartbeat(origin: string, body: unknown): Promise<unknown> {
    return this.request(origin, "/api/devices/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async openChannel(
    origin: string,
    input: DeviceAgentChannelOpenInput
  ): Promise<DeviceAgentChannelConnection> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanupSignal = () => input.signal?.removeEventListener("abort", onAbort);

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint(origin, "/api/devices/channel"), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/event-stream",
          "x-chatcockpit-device-id": input.deviceId,
          "x-chatcockpit-channel-sequence": String(input.sequence),
          "x-chatcockpit-channel-nonce": input.channelNonce,
          "x-chatcockpit-channel-signature": input.signature
        }
      });
    } catch (error) {
      cleanupSignal();
      if (controller.signal.aborted) {
        throw new DeviceAgentTransportError(null, "DEVICE_AGENT_ABORTED", "Device channel connection was cancelled");
      }
      throw new DeviceAgentTransportError(
        null,
        "DEVICE_AGENT_NETWORK_ERROR",
        `Unable to open ChatCockpit device channel: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (isRedirect(response.status)) {
      cleanupSignal();
      controller.abort();
      throw new DeviceAgentTransportError(
        response.status,
        "DEVICE_AGENT_REDIRECT_REJECTED",
        "Device channel redirects are not followed automatically"
      );
    }
    if (!response.ok) {
      const body = await parseBoundedJson(response);
      cleanupSignal();
      controller.abort();
      throw apiProblem(response.status, body);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream")) {
      cleanupSignal();
      controller.abort();
      throw channelProtocolError("Hub device channel response is not an event stream");
    }
    return {
      events: readChannelEvents(response, controller, cleanupSignal),
      close: () => controller.abort()
    };
  }

  private async request(origin: string, pathname: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint(origin, pathname), {
        ...init,
        redirect: "manual",
        headers: {
          accept: "application/json",
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DeviceAgentTransportError(
        null,
        "DEVICE_AGENT_NETWORK_ERROR",
        `Unable to reach ChatCockpit Hub: ${message}`
      );
    }
    if (isRedirect(response.status)) {
      throw new DeviceAgentTransportError(
        response.status,
        "DEVICE_AGENT_REDIRECT_REJECTED",
        "Device protocol redirects are not followed automatically"
      );
    }
    const body = await parseBoundedJson(response);
    if (!response.ok) throw apiProblem(response.status, body);
    return body;
  }
}
