import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";

import { ApiError } from "./errors.js";

type EnvLike = Record<string, string | undefined>;

const OAUTH_PUBLIC_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke"
]);

function requestPath(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
}

function isPublicPath(url: string): boolean {
  const pathname = requestPath(url);
  return (
    OAUTH_PUBLIC_PATHS.has(pathname) ||
    pathname === "/" ||
    pathname === "/favicon.ico" ||
    pathname === "/api/health" ||
    pathname === "/tokenpilot/api/health" ||
    pathname === "/api/setup/status" ||
    pathname === "/tokenpilot/api/setup/status" ||
    pathname === "/openapi.yaml" ||
    pathname === "/privacy-policy" ||
    pathname === "/ui" ||
    pathname === "/ui/" ||
    pathname.startsWith("/ui/")
  );
}

function isMcpPath(url: string): boolean {
  const pathname = requestPath(url);
  return pathname === "/mcp" || pathname === "/tokenpilot/mcp";
}

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function readEnvFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

export function isExposedMode(env: EnvLike = process.env): boolean {
  return readEnvFlag(env.TOKENPILOT_EXPOSED);
}

export function isAuthRequired(env: EnvLike = process.env): boolean {
  return isExposedMode(env) || Boolean(env.TOKENPILOT_API_TOKEN?.trim());
}

export function validateServerAuthConfig(env: EnvLike = process.env): void {
  if (isExposedMode(env) && !env.TOKENPILOT_API_TOKEN?.trim()) {
    throw new Error("TOKENPILOT_EXPOSED=true requires TOKENPILOT_API_TOKEN");
  }
}

export interface McpOAuthAccessVerifier {
  protectedResourceMetadataUrl: string;
  scope: string;
  verifyAccessToken(token: string): boolean;
}

export function createTokenPilotAuthPlugin(
  oauth: McpOAuthAccessVerifier | null = null
) {
  return fp(async (app) => {
    app.addHook("preHandler", async (request, reply) => {
      if (isPublicPath(request.url)) {
        return;
      }

      if (isExposedMode() && !process.env.TOKENPILOT_API_TOKEN?.trim()) {
        throw new ApiError(
          503,
          "AUTH_CONFIG_MISSING",
          "Exposed mode is missing TOKENPILOT_API_TOKEN"
        );
      }

      const configured = process.env.TOKENPILOT_API_TOKEN?.trim();
      if (!configured) {
        return;
      }

      const provided = readBearerToken(request);
      if (provided === configured) {
        return;
      }

      if (provided && oauth && isMcpPath(request.url) && oauth.verifyAccessToken(provided)) {
        return;
      }

      if (oauth && isMcpPath(request.url)) {
        reply.header(
          "www-authenticate",
          `Bearer resource_metadata="${oauth.protectedResourceMetadataUrl}", scope="${oauth.scope}"`
        );
      }
      throw new ApiError(401, "UNAUTHORIZED", "Bearer token is missing or invalid");
    });
  });
}

export const tokenPilotAuthPlugin = createTokenPilotAuthPlugin();
