import crypto from "node:crypto";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { Readable } from "node:stream";

export const DEVICE_AGENT_TRANSPORT_MAX_JSON_BYTES = 64 * 1024;
export const DEVICE_AGENT_CHANNEL_MAX_EVENT_BYTES = 72 * 1024;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function pinnedCertificateFingerprint(certificatePem: string): string {
  try {
    return crypto.createHash("sha256")
      .update(new crypto.X509Certificate(certificatePem).raw)
      .digest("base64url");
  } catch {
    throw new Error("Pinned LAN TLS certificate is invalid");
  }
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const name of Object.keys(input)) {
    const value = input[name];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return headers;
}

function requestBody(input: BodyInit | null | undefined): Buffer | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "string") return Buffer.from(input, "utf8");
  if (input instanceof URLSearchParams) return Buffer.from(input.toString(), "utf8");
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("Pinned LAN TLS transport received an unsupported request body");
}

const PINNED_TLS_TRUST_ERROR_CODES = new Set([
  "CHATCOCKPIT_TLS_PIN_MISMATCH",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_SIGNATURE_FAILURE",
  "ERR_TLS_CERT_ALTNAME_INVALID"
]);

function pinnedTlsMismatchError(message: string): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "CHATCOCKPIT_TLS_PIN_MISMATCH";
  return error;
}

function isPinnedTlsTrustError(error: unknown): boolean {
  return error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    PINNED_TLS_TRUST_ERROR_CODES.has((error as NodeJS.ErrnoException).code!);
}

function buildPinnedHttpsFetch(certificatePem: string): FetchLike {
  const expectedFingerprint = pinnedCertificateFingerprint(certificatePem);
  return async (input, init = {}) => {
    const url = input instanceof Request
      ? new URL(input.url)
      : input instanceof URL
        ? new URL(input.href)
        : new URL(input);
    if (url.protocol !== "https:") {
      throw new Error("Pinned LAN TLS transport requires an HTTPS origin");
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [name, value] of new Headers(init.headers).entries()) headers.set(name, value);
    const body = requestBody(init.body);

    return await new Promise<Response>((resolve, reject) => {
      const request = https.request(url, {
        method: init.method ?? (input instanceof Request ? input.method : "GET"),
        headers: Object.fromEntries(headers.entries()),
        ca: certificatePem,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        signal: init.signal ?? undefined,
        checkServerIdentity: (_hostname, certificate) => {
          const raw = certificate.raw;
          if (!raw) return pinnedTlsMismatchError("LAN TLS peer certificate is unavailable");
          const observed = crypto.createHash("sha256").update(raw).digest("base64url");
          return observed === expectedFingerprint
            ? undefined
            : pinnedTlsMismatchError("LAN TLS peer certificate does not match the pinned Hub certificate");
        }
      }, (response) => {
        const bodyStream = Readable.toWeb(response) as ReadableStream<Uint8Array>;
        resolve(new Response(bodyStream, {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage ?? "",
          headers: responseHeaders(response.headers)
        }));
      });
      request.once("error", reject);
      if (body) request.write(body);
      request.end();
    });
  };
}

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
  protocolVersion?: 1 | 2 | 3 | 4;
  signature: string;
  signal?: AbortSignal;
}

export interface DeviceAgentChannelResultInput {
  deviceId: string;
  channelId: string;
  sequence: number;
  body:
    | {
        requestId: string;
        outcome: "ok";
        result: unknown;
      }
    | {
        requestId: string;
        outcome: "error";
        error: { code: string; message: string };
      };
  signature: string;
}

export interface DeviceAgentRuntimeLifecycleResultInput {
  deviceId: string;
  channelId: string;
  sequence: number;
  body:
    | {
        operationId: string;
        outcome: "ok";
        result: unknown;
      }
    | {
        operationId: string;
        outcome: "error";
        error: { code: string; message: string };
      };
  signature: string;
}

export type DeviceAgentChannelEvent =
  | {
      type: "channel.ready";
      channelId: string;
      deviceId: string;
      acceptedSequence: number;
      protocolVersion: 1 | 2 | 3 | 4;
    }
  | {
      type: "capability.request";
      protocolVersion: 1;
      requestId: string;
      operation:
        | "capabilities.list"
        | "capabilities.inspect"
        | "capabilities.read.invoke"
        | "workspace.read.invoke";
      issuedAt: string;
      expiresAt: string;
      payload: unknown;
    }
  | {
      type: "runtime.lifecycle.request";
      protocolVersion: 1;
      operationId: string;
      action: "status" | "start" | "stop" | "restart" | "operation.get";
      issuedAt: string;
      expiresAt: string;
      expectedStateRevision?: number;
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
  getLanTlsIdentity(origin: string, signal?: AbortSignal): Promise<unknown>;
  proveLanTlsIdentity(origin: string, nonce: string, signal?: AbortSignal): Promise<unknown>;
  createEnrollment(origin: string, body: unknown): Promise<unknown>;
  pollEnrollment(origin: string, enrollmentId: string, body: unknown): Promise<unknown>;
  heartbeat(origin: string, body: unknown): Promise<unknown>;
  openChannel(origin: string, input: DeviceAgentChannelOpenInput): Promise<DeviceAgentChannelConnection>;
  submitChannelResult?(
    origin: string,
    input: DeviceAgentChannelResultInput
  ): Promise<{ ok: true; acceptedSequence: number }>;
  submitRuntimeLifecycleResult?(
    origin: string,
    input: DeviceAgentRuntimeLifecycleResultInput
  ): Promise<{ ok: true; acceptedSequence: number }>;
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
      (data.protocolVersion !== 1 &&
        data.protocolVersion !== 2 &&
        data.protocolVersion !== 3 &&
        data.protocolVersion !== 4)
    ) {
      throw channelProtocolError("Hub returned an invalid channel.ready event");
    }
    return {
      type: "channel.ready",
      channelId: data.channelId,
      deviceId: data.deviceId,
      acceptedSequence: Number(data.acceptedSequence),
      protocolVersion: data.protocolVersion
    };
  }
  if (eventName === "capability.request") {
    if (
      data.protocolVersion !== 1 ||
      typeof data.requestId !== "string" ||
      !/^cc_device_request_[A-Za-z0-9_-]{20,80}$/.test(data.requestId) ||
      (data.operation !== "capabilities.list" &&
        data.operation !== "capabilities.inspect" &&
        data.operation !== "capabilities.read.invoke" &&
        data.operation !== "workspace.read.invoke") ||
      typeof data.issuedAt !== "string" ||
      Number.isNaN(Date.parse(data.issuedAt)) ||
      typeof data.expiresAt !== "string" ||
      Number.isNaN(Date.parse(data.expiresAt)) ||
      !("payload" in data)
    ) {
      throw channelProtocolError("Hub returned an invalid capability.request event");
    }
    return {
      type: "capability.request",
      protocolVersion: 1,
      requestId: data.requestId,
      operation: data.operation,
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      payload: data.payload
    };
  }
  if (eventName === "runtime.lifecycle.request") {
    const validAction =
      data.action === "status" ||
      data.action === "start" ||
      data.action === "stop" ||
      data.action === "restart" ||
      data.action === "operation.get";
    const validRevision =
      data.expectedStateRevision === undefined ||
      (Number.isSafeInteger(data.expectedStateRevision) && Number(data.expectedStateRevision) >= 0);
    if (
      data.protocolVersion !== 1 ||
      typeof data.operationId !== "string" ||
      !/^cc_device_runtime_op_[A-Za-z0-9_-]{20,120}$/.test(data.operationId) ||
      !validAction ||
      typeof data.issuedAt !== "string" ||
      Number.isNaN(Date.parse(data.issuedAt)) ||
      typeof data.expiresAt !== "string" ||
      Number.isNaN(Date.parse(data.expiresAt)) ||
      !validRevision ||
      Object.keys(data).some((key) =>
        key !== "protocolVersion" &&
        key !== "operationId" &&
        key !== "action" &&
        key !== "issuedAt" &&
        key !== "expiresAt" &&
        key !== "expectedStateRevision"
      )
    ) {
      throw channelProtocolError("Hub returned an invalid runtime.lifecycle.request event");
    }
    return {
      type: "runtime.lifecycle.request",
      protocolVersion: 1,
      operationId: data.operationId,
      action: data.action as "status" | "start" | "stop" | "restart" | "operation.get",
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      ...(data.expectedStateRevision === undefined
        ? {}
        : { expectedStateRevision: Number(data.expectedStateRevision) })
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
  private readonly pinnedTls: boolean;

  constructor(options: { fetchImpl?: FetchLike; pinnedCertificatePem?: string } = {}) {
    if (options.fetchImpl && options.pinnedCertificatePem) {
      throw new Error("Device Agent transport cannot combine a custom fetch implementation with certificate pinning");
    }
    this.pinnedTls = options.pinnedCertificatePem !== undefined;
    this.fetchImpl = options.fetchImpl
      ?? (options.pinnedCertificatePem
        ? buildPinnedHttpsFetch(options.pinnedCertificatePem)
        : fetch);
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

  getLanTlsIdentity(origin: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(origin, "/api/hub/lan-tls", { method: "GET", signal });
  }

  proveLanTlsIdentity(origin: string, nonce: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(origin, "/api/hub/lan-tls/proof", {
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
          ...(input.protocolVersion === undefined
            ? {}
            : { "x-chatcockpit-channel-protocol": String(input.protocolVersion) }),
          "x-chatcockpit-channel-signature": input.signature
        }
      });
    } catch (error) {
      cleanupSignal();
      if (controller.signal.aborted) {
        throw new DeviceAgentTransportError(null, "DEVICE_AGENT_ABORTED", "Device channel connection was cancelled");
      }
      if (this.pinnedTls && isPinnedTlsTrustError(error)) {
        throw new DeviceAgentTransportError(
          null,
          "DEVICE_AGENT_TLS_PIN_MISMATCH",
          "LAN TLS peer certificate does not match the pinned Hub certificate"
        );
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

  async submitChannelResult(
    origin: string,
    input: DeviceAgentChannelResultInput
  ): Promise<{ ok: true; acceptedSequence: number }> {
    const response = await this.request(origin, "/api/devices/channel/results", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chatcockpit-device-id": input.deviceId,
        "x-chatcockpit-channel-id": input.channelId,
        "x-chatcockpit-channel-sequence": String(input.sequence),
        "x-chatcockpit-channel-signature": input.signature
      },
      body: JSON.stringify(input.body)
    });
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      (response as Record<string, unknown>).ok !== true ||
      !Number.isSafeInteger((response as Record<string, unknown>).acceptedSequence) ||
      Number((response as Record<string, unknown>).acceptedSequence) <= 0
    ) {
      throw new DeviceAgentTransportError(
        502,
        "DEVICE_AGENT_RESPONSE_INVALID",
        "Hub returned an invalid device capability result acknowledgement"
      );
    }
    return {
      ok: true,
      acceptedSequence: Number((response as Record<string, unknown>).acceptedSequence)
    };
  }

  async submitRuntimeLifecycleResult(
    origin: string,
    input: DeviceAgentRuntimeLifecycleResultInput
  ): Promise<{ ok: true; acceptedSequence: number }> {
    const response = await this.request(origin, "/api/devices/runtime-lifecycle/results", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chatcockpit-device-id": input.deviceId,
        "x-chatcockpit-channel-id": input.channelId,
        "x-chatcockpit-channel-sequence": String(input.sequence),
        "x-chatcockpit-channel-signature": input.signature
      },
      body: JSON.stringify(input.body)
    });
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      (response as Record<string, unknown>).ok !== true ||
      !Number.isSafeInteger((response as Record<string, unknown>).acceptedSequence) ||
      Number((response as Record<string, unknown>).acceptedSequence) <= 0
    ) {
      throw new DeviceAgentTransportError(
        502,
        "DEVICE_AGENT_RESPONSE_INVALID",
        "Hub returned an invalid Runtime lifecycle result acknowledgement"
      );
    }
    return {
      ok: true,
      acceptedSequence: Number((response as Record<string, unknown>).acceptedSequence)
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
      if (this.pinnedTls && isPinnedTlsTrustError(error)) {
        throw new DeviceAgentTransportError(
          null,
          "DEVICE_AGENT_TLS_PIN_MISMATCH",
          "LAN TLS peer certificate does not match the pinned Hub certificate"
        );
      }
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
