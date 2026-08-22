import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";

import type { OperatorService } from "../auth/operator-service.js";
import { readIdentityEnv, type EnvLike } from "../core/identity-env.js";
import { ApiError } from "./errors.js";
import { isMachineLocalRequest } from "./machine-local-authority.js";
import {
  OPERATOR_CSRF_HEADER,
  readOperatorLoginGate,
  readOperatorOAuthRequestId,
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
  "/api/operator/login",
  "/api/operator/totp/login",
  "/api/operator/local-login",
  "/api/operator/passkeys/authentication/options",
  "/api/operator/passkeys/authentication/verify"
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requestPath(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
}

function isOperatorPublicPath(url: string): boolean {
  return OPERATOR_PUBLIC_PATHS.has(requestPath(url));
}

function isDeviceProtocolPath(url: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const pathname = requestPath(url);
  if (normalizedMethod === "GET" && pathname === "/api/devices/channel") {
    return true;
  }
  if (normalizedMethod !== "POST") return false;
  if (
    pathname === "/api/devices/enrollment-requests" ||
    pathname === "/api/devices/heartbeat" ||
    pathname === "/api/devices/channel/results"
  ) {
    return true;
  }
  return /^\/api\/devices\/enrollment-requests\/cc_enroll_[A-Za-z0-9_-]{20,80}\/status$/.test(
    pathname
  );
}

function isPublicPath(url: string, secureEntryPath: string): boolean {
  const pathname = requestPath(url);
  const isBootstrapProofPath = pathname.startsWith("/.well-known/chatcockpit-bootstrap-proof/");
  const isStableUiAsset = pathname.startsWith("/ui/assets/");
  const isSecureEntry =
    secureEntryPath !== "/ui" &&
    (pathname === secureEntryPath || pathname === `${secureEntryPath}/login`);
  return (
    OAUTH_PUBLIC_PATHS.has(pathname) ||
    isBootstrapProofPath ||
    isStableUiAsset ||
    isSecureEntry ||
    pathname === "/" ||
    pathname === "/favicon.ico" ||
    pathname === "/api/health" ||
    pathname === "/api/hub/identity" ||
    pathname === "/api/hub/identity/proof" ||
    pathname === "/api/hub/lan-tls" ||
    pathname === "/api/hub/lan-tls/proof" ||
    pathname === "/tokenpilot/api/health" ||
    pathname === "/openapi.yaml" ||
    pathname === "/privacy-policy"
  );
}

function isStableUiPath(url: string): boolean {
  const pathname = requestPath(url);
  return pathname === "/ui" || pathname === "/ui/" || pathname.startsWith("/ui/");
}

function isStableUiLoginPath(url: string): boolean {
  return requestPath(url) === "/ui/login";
}

function loginGateFromUiUrl(url: string): string | null {
  if (!isStableUiLoginPath(url)) return null;
  try {
    const parsed = new URL(url, "http://chatcockpit.local");
    const gate = parsed.searchParams.get("gate")?.trim() ?? "";
    return gate || null;
  } catch {
    return null;
  }
}

function oauthRequestIdFromUiUrl(url: string): string | null {
  if (!isStableUiLoginPath(url)) return null;
  try {
    const parsed = new URL(url, "http://chatcockpit.local");
    const requestId = parsed.searchParams.get("oauth_request_id")?.trim() ?? "";
    return requestId || null;
  } catch {
    return null;
  }
}

function isConcealedSecureEntrySubpath(url: string, secureEntryPath: string): boolean {
  if (secureEntryPath === "/ui") return false;
  const pathname = requestPath(url);
  return (
    pathname.startsWith(`${secureEntryPath}/`) &&
    pathname !== `${secureEntryPath}/login`
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

export function validateServerAuthConfig(_env: EnvLike = process.env): void {
  // Exposed mode no longer requires a machine API token. Human Web access is
  // authorized by the Operator session, while Remote MCP uses scoped OAuth.
  // CHATCOCKPIT_API_TOKEN remains an optional machine-to-machine credential.
}

export interface McpOAuthAccessIdentity {
  authorizationGrantId: string;
  clientRegistrationId: string;
}

export interface McpOAuthAccessVerifier {
  protectedResourceMetadataUrl: string;
  scope: string;
  verifyAccessToken(token: string): McpOAuthAccessIdentity | null;
  isAuthorizationRequestPending(requestId: string): boolean;
}

export function createTokenPilotAuthPlugin(
  oauth: McpOAuthAccessVerifier | null = null,
  operator: OperatorService | null = null,
  consolePathPrefix = "/ui"
) {
  return fp(async (app) => {
    if (!app.hasRequestDecorator("chatCockpitAuth")) {
      app.decorateRequest("chatCockpitAuth");
    }

    app.addHook("preHandler", async (request, reply) => {
      request.chatCockpitAuth = { kind: "anonymous" };

      const sessionSecret = operator ? readOperatorSessionCookie(request) : null;
      const operatorSession =
        operator && sessionSecret ? operator.authenticate(sessionSecret) : null;
      if (operatorSession) {
        request.chatCockpitAuth = {
          kind: "operator-session",
          session: operatorSession
        };
      }

      if (isConcealedSecureEntrySubpath(request.url, consolePathPrefix)) {
        reply.code(404).type("text/plain; charset=utf-8");
        return reply.send("Not Found");
      }

      if (isStableUiPath(request.url)) {
        const pathname = requestPath(request.url);
        if (pathname.startsWith("/ui/assets/")) {
          return;
        }
        if (pathname === "/ui/local-login" && isMachineLocalRequest(request)) {
          return;
        }
        if (request.chatCockpitAuth.kind === "operator-session") {
          return;
        }
        if (consolePathPrefix === "/ui") {
          return;
        }
        const loginGate = loginGateFromUiUrl(request.url);
        if (
          loginGate &&
          operator?.inspectSecureLoginGate(loginGate)
        ) {
          return;
        }
        const oauthRequestId = oauthRequestIdFromUiUrl(request.url);
        if (
          oauthRequestId &&
          oauth?.isAuthorizationRequestPending(oauthRequestId)
        ) {
          return;
        }
        reply.code(404).type("text/plain; charset=utf-8");
        return reply.send("Not Found");
      }

      if (isDeviceProtocolPath(request.url, request.method)) {
        return;
      }

      if (isOperatorPublicPath(request.url)) {
        if (request.chatCockpitAuth.kind === "operator-session") {
          return;
        }
        if (requestPath(request.url) === "/api/operator/local-login") {
          return;
        }
        if (consolePathPrefix === "/ui") {
          return;
        }
        const loginGate = readOperatorLoginGate(request);
        if (loginGate && operator?.inspectSecureLoginGate(loginGate)) {
          return;
        }
        const oauthRequestId = readOperatorOAuthRequestId(request);
        if (oauthRequestId && oauth?.isAuthorizationRequestPending(oauthRequestId)) {
          return;
        }
        reply.code(404).type("text/plain; charset=utf-8");
        return reply.send("Not Found");
      }

      if (isPublicPath(request.url, consolePathPrefix)) {
        return;
      }

      const configured = readIdentityEnv("API_TOKEN");
      const provided = readBearerToken(request);
      if (configured && provided === configured) {
        request.chatCockpitAuth = { kind: "machine-bearer" };
        return;
      }

      if (isMcpPath(request.url)) {
        const oauthIdentity = provided && oauth ? oauth.verifyAccessToken(provided) : null;
        if (oauthIdentity) {
          request.chatCockpitAuth = {
            kind: "mcp-oauth",
            authorizationGrantId: oauthIdentity.authorizationGrantId,
            clientRegistrationId: oauthIdentity.clientRegistrationId
          };
          return;
        }

        if (!configured && !isExposedMode() && isMachineLocalRequest(request)) {
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

      if (request.chatCockpitAuth.kind === "operator-session") {
        requireOperatorCsrf(request, request.chatCockpitAuth);
        return;
      }

      const operatorConfigured = operator?.status().configured ?? false;
      if (
        !configured &&
        !operatorConfigured &&
        !isExposedMode() &&
        isMachineLocalRequest(request)
      ) {
        return;
      }

      throw new ApiError(401, "UNAUTHORIZED", "Authentication is required");
    });
  });
}

export const tokenPilotAuthPlugin = createTokenPilotAuthPlugin();
