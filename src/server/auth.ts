import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";

import type { OperatorService } from "../auth/operator-service.js";
import { readIdentityEnv, type EnvLike } from "../core/identity-env.js";
import { ApiError } from "./errors.js";
import {
  OPERATOR_CSRF_HEADER,
  readOperatorSessionCookie,
  type RequestAuthContext
} from "./operator-auth-context.js";

const OAUTH_PUBLIC_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke"
]);

const OPERATOR_PUBLIC_PATHS = new Set([
  "/api/operator/status",
  "/api/operator/login"
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requestPath(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
}

function isPublicPath(url: string): boolean {
  const pathname = requestPath(url);
  return (
    OAUTH_PUBLIC_PATHS.has(pathname) ||
    OPERATOR_PUBLIC_PATHS.has(pathname) ||
    pathname === "/" ||
    pathname === "/favicon.ico" ||
    pathname === "/api/health" ||
    pathname === "/tokenpilot/api/health" ||
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

function csrfHeader(request: FastifyRequest): string | null {
  const value = request.headers[OPERATOR_CSRF_HEADER];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function requireOperatorCsrf(
  request: FastifyRequest,
  context: Extract<RequestAuthContext, { kind: "operator-session" }>
): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  if (!requestPath(request.url).startsWith("/api/")) return;

  const provided = csrfHeader(request);
  if (!provided) {
    throw new ApiError(403, "CSRF_REQUIRED", "Operator session mutation requires a CSRF token");
  }
  if (provided !== context.session.csrfToken) {
    throw new ApiError(403, "CSRF_INVALID", "Operator session CSRF token is invalid");
  }
}

export function isExposedMode(env: EnvLike = process.env): boolean {
  return readEnvFlag(readIdentityEnv("EXPOSED", env));
}

export function isAuthRequired(env: EnvLike = process.env): boolean {
  return isExposedMode(env) || Boolean(readIdentityEnv("API_TOKEN", env));
}

export function validateServerAuthConfig(env: EnvLike = process.env): void {
  if (isExposedMode(env) && !readIdentityEnv("API_TOKEN", env)) {
    throw new Error("Exposed mode requires a configured API token");
  }
}

export interface McpOAuthAccessVerifier {
  protectedResourceMetadataUrl: string;
  scope: string;
  verifyAccessToken(token: string): boolean;
}

export function createTokenPilotAuthPlugin(
  oauth: McpOAuthAccessVerifier | null = null,
  operator: OperatorService | null = null
) {
  return fp(async (app) => {
    if (!app.hasRequestDecorator("chatCockpitAuth")) {
      app.decorateRequest("chatCockpitAuth");
    }

    app.addHook("preHandler", async (request, reply) => {
      request.chatCockpitAuth = { kind: "anonymous" };
      if (isPublicPath(request.url)) {
        return;
      }

      const configured = readIdentityEnv("API_TOKEN");
      if (isExposedMode() && !configured) {
        throw new ApiError(
          503,
          "AUTH_CONFIG_MISSING",
          "Exposed mode is missing the configured API token"
        );
      }

      const provided = readBearerToken(request);
      if (configured && provided === configured) {
        request.chatCockpitAuth = { kind: "machine-bearer" };
        return;
      }

      if (isMcpPath(request.url)) {
        if (provided && oauth && oauth.verifyAccessToken(provided)) {
          request.chatCockpitAuth = { kind: "mcp-oauth" };
          return;
        }

        if (!configured && !isExposedMode()) {
          return;
        }

        if (oauth) {
          reply.header(
            "www-authenticate",
            `Bearer resource_metadata="${oauth.protectedResourceMetadataUrl}", scope="${oauth.scope}"`
          );
        }
        throw new ApiError(401, "UNAUTHORIZED", "Bearer token is missing or invalid");
      }

      const sessionSecret = operator ? readOperatorSessionCookie(request) : null;
      const operatorSession =
        operator && sessionSecret ? operator.authenticate(sessionSecret) : null;
      if (operatorSession) {
        const context: Extract<RequestAuthContext, { kind: "operator-session" }> = {
          kind: "operator-session",
          session: operatorSession
        };
        request.chatCockpitAuth = context;
        requireOperatorCsrf(request, context);
        return;
      }

      const operatorConfigured = operator?.status().configured ?? false;
      if (!configured && !operatorConfigured && !isExposedMode()) {
        return;
      }

      throw new ApiError(401, "UNAUTHORIZED", "Authentication is required");
    });
  });
}

export const tokenPilotAuthPlugin = createTokenPilotAuthPlugin();
