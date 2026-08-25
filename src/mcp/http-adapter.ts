import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { MCP_TOOL_SURFACE_PACKS, type McpToolSurfacePack } from "./tool-surface.js";

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

export async function handleMcpHttpRequest(
  handler: McpHttpHandler,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const webRequest = toWebStandardRequest(request);
  const response = await handler.fetch(webRequest, {
    parsedBody: request.body
  });
  return sendWebStandardResponse(reply, response);
}

export interface McpHttpSurfaceHandlers {
  core: McpHttpHandler;
  full: McpHttpHandler;
  packs: Record<McpToolSurfacePack, McpHttpHandler>;
}

export function registerMcpHttpRoutes(
  app: FastifyInstance,
  handlers: McpHttpSurfaceHandlers
): void {
  const register = (url: string, handler: McpHttpHandler) => {
    app.route({
      method: ["GET", "POST", "DELETE"],
      url,
      handler: (request: FastifyRequest, reply: FastifyReply) =>
        handleMcpHttpRequest(handler, request, reply)
    });
  };

  register("/mcp", handlers.core);
  register("/mcp/full", handlers.full);
  register("/tokenpilot/mcp", handlers.full);
  for (const pack of MCP_TOOL_SURFACE_PACKS) {
    register(`/mcp/packs/${pack}`, handlers.packs[pack]);
  }

  app.addHook("onClose", async () => {
    await handlers.core.close();
    await handlers.full.close();
    for (const pack of MCP_TOOL_SURFACE_PACKS) {
      await handlers.packs[pack].close();
    }
  });
}
