export const DEVICE_AGENT_TRANSPORT_MAX_JSON_BYTES = 64 * 1024;

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

export interface DeviceAgentTransport {
  getHubIdentity(origin: string): Promise<unknown>;
  proveHubIdentity(origin: string, nonce: string): Promise<unknown>;
  createEnrollment(origin: string, body: unknown): Promise<unknown>;
  pollEnrollment(origin: string, enrollmentId: string, body: unknown): Promise<unknown>;
  heartbeat(origin: string, body: unknown): Promise<unknown>;
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

export class HttpDeviceAgentTransport implements DeviceAgentTransport {
  private readonly fetchImpl: FetchLike;

  constructor(options: { fetchImpl?: FetchLike } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getHubIdentity(origin: string): Promise<unknown> {
    return this.request(origin, "/api/hub/identity", { method: "GET" });
  }

  proveHubIdentity(origin: string, nonce: string): Promise<unknown> {
    return this.request(origin, "/api/hub/identity/proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce })
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
