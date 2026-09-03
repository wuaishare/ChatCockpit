import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { MCP_TOOL_SURFACE_PACKS, type McpToolSurfacePack } from "./tool-surface.js";
import { McpConnectionRegistry, type McpConnectionSurface } from "./connection-registry.js";

import {
  MCP_AUTHORIZATION_GRANT_HEADER,
  MCP_CLIENT_REGISTRATION_HEADER
} from "../auth/oauth-request-identity.js";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function buildRequestUrl(request: FastifyRequest): string {
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"])
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"])
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProto || request.protocol || "http";
  const host = forwardedHost || request.headers.host || "127.0.0.1";
  return new URL(request.raw.url || request.url, `${protocol}://${host}`).toString();
}

function buildHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (name === MCP_AUTHORIZATION_GRANT_HEADER || name === MCP_CLIENT_REGISTRATION_HEADER) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }
    headers.set(name, value);
  }
  if (request.chatCockpitAuth.kind === "mcp-oauth") {
    headers.set(
      MCP_AUTHORIZATION_GRANT_HEADER,
      request.chatCockpitAuth.authorizationGrantId
    );
    headers.set(
      MCP_CLIENT_REGISTRATION_HEADER,
      request.chatCockpitAuth.clientRegistrationId
    );
  }
  return headers;
}

function bodyForRequest(request: FastifyRequest): BodyInit | undefined {
  if (BODYLESS_METHODS.has(request.method.toUpperCase()) || request.body === undefined) {
    return undefined;
  }

  if (typeof request.body === "string") {
    return request.body;
  }
  if (Buffer.isBuffer(request.body)) {
    return request.body.toString("utf8");
  }
  if (request.body instanceof Uint8Array) {
    return new TextDecoder().decode(request.body);
  }

  return JSON.stringify(request.body);
}

export function toWebStandardRequest(request: FastifyRequest): Request {
  return new Request(buildRequestUrl(request), {
    method: request.method,
    headers: buildHeaders(request),
    body: bodyForRequest(request)
  });
}

async function sendWebStandardResponse(
  reply: FastifyReply,
  response: Response
): Promise<unknown> {
  reply.code(response.status);
  for (const [name, value] of response.headers.entries()) {
    reply.header(name, value);
  }

  if (!response.body) {
    return reply.send();
  }

  const stream = Readable.fromWeb(
    response.body as unknown as NodeReadableStream
  );
  return reply.send(stream);
}

function mcpRequestMetadata(body: unknown): { method: string | null; toolName: string | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { method: Array.isArray(body) ? "batch" : null, toolName: null };
  }
  const record = body as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method.slice(0, 120) : null;
  const params = record.params && typeof record.params === "object" && !Array.isArray(record.params)
    ? record.params as Record<string, unknown>
    : null;
  const toolName = method === "tools/call" && typeof params?.name === "string"
    ? params.name.slice(0, 120)
    : null;
  return { method, toolName };
}

export async function handleMcpHttpRequest(
  handler: McpHttpHandler,
  request: FastifyRequest,
  reply: FastifyReply,
  observability?: { connections: McpConnectionRegistry; surface: McpConnectionSurface }
): Promise<unknown> {
  const webRequest = toWebStandardRequest(request);
  const metadata = mcpRequestMetadata(request.body);
  const auth = request.chatCockpitAuth;
  const observation = observability && auth.kind === "mcp-oauth"
    ? observability.connections.begin({
        surface: observability.surface,
        authorizationGrantId: auth.authorizationGrantId,
        clientRegistrationId: auth.clientRegistrationId,
        transportSessionId: firstHeaderValue(request.headers["mcp-session-id"]),
        method: metadata.method,
        toolName: metadata.toolName
      })
    : null;
  try {
    const response = await handler.fetch(webRequest, {
      parsedBody: request.body
    });
    observation?.complete({
      transportSessionId: response.headers.get("mcp-session-id")
    });
    return sendWebStandardResponse(reply, response);
  } catch (error) {
    observation?.fail();
    throw error;
  }
}

export interface McpHttpSurfaceHandlers {
  core: McpHttpHandler;
  full: McpHttpHandler;
  packs: Record<McpToolSurfacePack, McpHttpHandler>;
}

export function registerMcpHttpRoutes(
  app: FastifyInstance,
  handlers: McpHttpSurfaceHandlers,
  connections?: McpConnectionRegistry
): void {
  const register = (url: string, handler: McpHttpHandler, surface: McpConnectionSurface) => {
    app.route({
      method: ["GET", "POST", "DELETE"],
      url,
      handler: (request: FastifyRequest, reply: FastifyReply) =>
        handleMcpHttpRequest(
          handler,
          request,
          reply,
          connections ? { connections, surface } : undefined
        )
    });
  };

  register("/mcp", handlers.core, "core");
  register("/mcp/full", handlers.full, "full");
  register("/tokenpilot/mcp", handlers.full, "full");
  for (const pack of MCP_TOOL_SURFACE_PACKS) {
    register(`/mcp/packs/${pack}`, handlers.packs[pack], `pack:${pack}`);
  }

  app.addHook("onClose", async () => {
    await handlers.core.close();
    await handlers.full.close();
    for (const pack of MCP_TOOL_SURFACE_PACKS) {
      await handlers.packs[pack].close();
    }
  });
}
