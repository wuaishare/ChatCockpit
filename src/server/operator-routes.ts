import { spawnSync } from "node:child_process";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  OperatorAuthError,
  type OperatorService,
  type OperatorSessionContext
} from "../auth/operator-service.js";
import { readIdentityEnv } from "../core/identity-env.js";
import { sendApiError } from "./errors.js";
import {
  OPERATOR_SESSION_COOKIE,
  operatorSessionFromRequest
} from "./operator-auth-context.js";

let desktopSetupAvailabilityCache: { checkedAt: number; available: boolean } | null = null;
const DESKTOP_SETUP_AVAILABILITY_TTL_MS = 5_000;

interface UnknownRecord {
  [key: string]: unknown;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
  reply.header("pragma", "no-cache");
}

function isPublicHttpsRequest(request: FastifyRequest): boolean {
  if (request.protocol === "https") return true;
  const configured = readIdentityEnv("PUBLIC_BASE_URL");
  if (!configured) return false;
  try {
    const publicUrl = new URL(configured);
    return publicUrl.protocol === "https:" && request.hostname === publicUrl.hostname;
  } catch {
    return false;
  }
}

function sessionCookie(secret: string, secure: boolean): string {
  return [
    `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(secret)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function expiredSessionCookie(secure: boolean): string {
  return [
    `${OPERATOR_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function sourceAddress(request: FastifyRequest): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function isLoopbackSetupRequest(request: FastifyRequest): boolean {
  const hasForwardingHeaders = [
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto"
  ].some((name) => request.headers[name] !== undefined);
  if (hasForwardingHeaders) return false;

  const address = sourceAddress(request).toLowerCase();
  const host = request.hostname.toLowerCase();
  const loopbackAddress =
    address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  const loopbackHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
  return loopbackAddress && loopbackHost;
}

function hasSameLoopbackOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return false;
  try {
    const parsed = new URL(origin);
    const requestHost = request.headers.host?.toLowerCase();
    return (
      parsed.protocol === "http:" &&
      requestHost !== undefined &&
      parsed.host.toLowerCase() === requestHost
    );
  } catch {
    return false;
  }
}

function desktopSetupAvailable(request: FastifyRequest): boolean {
  if (process.platform !== "darwin" || !isLoopbackSetupRequest(request)) return false;
  const now = Date.now();
  if (
    desktopSetupAvailabilityCache &&
    now - desktopSetupAvailabilityCache.checkedAt < DESKTOP_SETUP_AVAILABILITY_TTL_MS
  ) {
    return desktopSetupAvailabilityCache.available;
  }
  const result = spawnSync("/usr/bin/open", ["-Ra", "ChatCockpit"], {
    stdio: "ignore",
    timeout: 1_000
  });
  const available = result.status === 0;
  desktopSetupAvailabilityCache = { checkedAt: now, available };
  return available;
}

function userAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return typeof value === "string" ? value : undefined;
}

function requireSession(request: FastifyRequest): OperatorSessionContext {
  const session = operatorSessionFromRequest(request);
  if (!session) {
    throw new Error("Operator route reached without an authenticated Operator session");
  }
  return session;
}

function sendOperatorError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof OperatorAuthError) {
    if (error.retryAfterSeconds) {
      reply.header("retry-after", String(error.retryAfterSeconds));
    }
    return sendApiError(reply, error.statusCode, error.code, error.message);
  }
  throw error;
}

function sessionProjection(
  session: ReturnType<OperatorService["listActiveSessions"]>[number],
  currentSessionId?: string
) {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt
  };
}

export function registerOperatorRoutes(
  app: FastifyInstance,
  service: OperatorService
): void {
  app.get("/api/operator/status", async (request, reply) => {
    noStore(reply);
    return {
      configured: service.status().configured,
      desktopSetupAvailable: desktopSetupAvailable(request)
    };
  });

  app.post("/api/operator/login", async (request, reply) => {
    noStore(reply);
    const body = record(request.body);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return sendApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Username and password are required"
      );
    }

    try {
      const issued = await service.login({
        username,
        password,
        source: sourceAddress(request),
        userAgent: userAgent(request)
      });
      reply.header(
        "set-cookie",
        sessionCookie(issued.sessionSecret, isPublicHttpsRequest(request))
      );
      return {
        ok: true,
        sessionId: issued.sessionId,
        username: issued.username,
        role: issued.role,
        csrfToken: issued.csrfToken,
        createdAt: issued.createdAt,
        lastSeenAt: issued.createdAt,
        idleExpiresAt: issued.idleExpiresAt,
        absoluteExpiresAt: issued.absoluteExpiresAt
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/local-login", async (request, reply) => {
    noStore(reply);
    if (!isLoopbackSetupRequest(request)) {
      return sendApiError(reply, 404, "NOT_FOUND", "Route not found");
    }
    if (!hasSameLoopbackOrigin(request)) {
      return sendApiError(reply, 403, "ORIGIN_INVALID", "Local login requires the same loopback origin");
    }
    const body = record(request.body);
    const grantSecret = typeof body.grant === "string" ? body.grant : "";
    if (!grantSecret) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Local login grant is required");
    }
    try {
      const issued = service.redeemLocalLoginGrant({
        grantSecret,
        source: sourceAddress(request),
        userAgent: userAgent(request)
      });
      reply.header("set-cookie", sessionCookie(issued.sessionSecret, false));
      return {
        ok: true,
        sessionId: issued.sessionId,
        username: issued.username,
        role: issued.role,
        csrfToken: issued.csrfToken,
        createdAt: issued.createdAt,
        lastSeenAt: issued.createdAt,
        idleExpiresAt: issued.idleExpiresAt,
        absoluteExpiresAt: issued.absoluteExpiresAt
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.get("/api/operator/session", async (request, reply) => {
    noStore(reply);
    const session = requireSession(request);
    return {
      ok: true,
      sessionId: session.sessionId,
      username: session.username,
      role: session.role,
      csrfToken: session.csrfToken,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt
    };
  });

  app.get("/api/operator/sessions", async (request, reply) => {
    noStore(reply);
    const current = requireSession(request);
    return {
      ok: true,
      sessions: service
        .listActiveSessions()
        .map((session) => sessionProjection(session, current.sessionId))
    };
  });

  app.post("/api/operator/sessions/revoke-others", async (request, reply) => {
    noStore(reply);
    const current = requireSession(request);
    try {
      return {
        ok: true,
        revokedSessionCount: service.revokeOtherSessions(current.sessionId)
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/logout", async (request, reply) => {
    noStore(reply);
    const current = requireSession(request);
    service.logout(current.sessionId);
    reply.header(
      "set-cookie",
      expiredSessionCookie(isPublicHttpsRequest(request))
    );
    return { ok: true };
  });
}
