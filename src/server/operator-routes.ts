import { isIP } from "node:net";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/server";

import {
  type OperatorPasskeyContext,
  type OperatorPasskeyService
} from "../auth/operator-passkey-service.js";
import {
  OperatorAuthError,
  type OperatorService,
  type OperatorSessionContext
} from "../auth/operator-service.js";
import type { OperatorTotpService } from "../auth/operator-totp-service.js";
import { readIdentityEnv } from "../core/identity-env.js";
import { sendApiError } from "./errors.js";
import {
  OPERATOR_SESSION_COOKIE,
  operatorSessionFromRequest
} from "./operator-auth-context.js";

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

function validWebAuthnDomainHost(hostname: string): boolean {
  return hostname === "localhost" || (hostname.length > 0 && isIP(hostname) === 0);
}

function passkeyContextForRequest(request: FastifyRequest): OperatorPasskeyContext {
  const configuredPublicBase = readIdentityEnv("PUBLIC_BASE_URL");
  if (configuredPublicBase) {
    try {
      const publicUrl = new URL(configuredPublicBase);
      if (
        publicUrl.protocol === "https:" &&
        validWebAuthnDomainHost(publicUrl.hostname) &&
        request.protocol === "https" &&
        request.hostname.toLowerCase() === publicUrl.hostname.toLowerCase()
      ) {
        return { rpId: publicUrl.hostname, origin: publicUrl.origin };
      }
    } catch {
      // Invalid public configuration is handled by the normal readiness paths.
    }
  }

  if (isLoopbackSetupRequest(request)) {
    const host = request.headers.host;
    if (typeof host === "string") {
      try {
        const localUrl = new URL(`${request.protocol}://${host}`);
        if (
          localUrl.hostname === "localhost" &&
          ["http:", "https:"].includes(localUrl.protocol)
        ) {
          return { rpId: "localhost", origin: localUrl.origin };
        }
      } catch {
        // Fall through to the bounded unsupported-origin error.
      }
    }
  }

  throw new OperatorAuthError(
    "PASSKEY_ORIGIN_UNSUPPORTED",
    "Passkeys require the configured public HTTPS origin or a direct loopback origin",
    400
  );
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
  // The custom URL handler is the capability boundary. LaunchServices app-name
  // discovery is not reliable for unsigned/source builds, so do not hide the
  // App handoff merely because LaunchServices cannot find a registered bundle.
  return process.platform === "darwin" && isLoopbackSetupRequest(request);
}

function userAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return typeof value === "string" ? value : undefined;
}

function requireSession(request: FastifyRequest): OperatorSessionContext {
  const session = operatorSessionFromRequest(request);
  if (!session) {
    throw new OperatorAuthError(
      "OPERATOR_SESSION_REQUIRED",
      "An authenticated console administrator session is required",
      401
    );
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
  service: OperatorService,
  passkeys: OperatorPasskeyService,
  totp: OperatorTotpService
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
      const source = sourceAddress(request);
      const agent = userAgent(request);
      const verified = await service.verifyPasswordCredentials({
        username,
        password,
        source,
        userAgent: agent
      });
      if (totp.requiresSecondFactor(verified.principalId)) {
        const challenge = totp.beginLoginChallenge({
          principalId: verified.principalId,
          source,
          userAgent: agent
        });
        return {
          ok: true,
          requiresSecondFactor: true,
          challenge: challenge.challenge,
          expiresAt: challenge.expiresAt,
          username: verified.username,
          role: verified.role
        };
      }
      const issued = service.issuePasswordSession({
        principalId: verified.principalId,
        source,
        userAgent: agent
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

  app.post("/api/operator/totp/login", async (request, reply) => {
    noStore(reply);
    const body = record(request.body);
    const challenge = typeof body.challenge === "string" ? body.challenge : "";
    const verification = typeof body.verification === "string" ? body.verification : "";
    if (!challenge || !verification) {
      return sendApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Second-factor challenge and verification are required"
      );
    }
    const source = sourceAddress(request);
    const agent = userAgent(request);
    const principalId = totp.activeLoginChallengePrincipal(challenge);
    try {
      const verified = totp.verifyLoginChallenge({
        challenge,
        verification,
        source,
        userAgent: agent
      });
      const issued = service.issueTotpSession({
        principalId: verified.principalId,
        source,
        userAgent: agent
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
      if (principalId) {
        service.recordSecondFactorFailure({
          principalId,
          source,
          userAgent: agent
        });
      }
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

  app.post("/api/operator/passkeys/authentication/options", async (request, reply) => {
    noStore(reply);
    try {
      return await passkeys.createAuthenticationOptions(passkeyContextForRequest(request));
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/passkeys/authentication/verify", async (request, reply) => {
    noStore(reply);
    const body = record(request.body);
    const challenge = typeof body.challenge === "string" ? body.challenge : "";
    const response = body.response;
    if (!challenge || !response || typeof response !== "object" || Array.isArray(response)) {
      return sendApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Passkey challenge and authentication response are required"
      );
    }
    try {
      const verified = await passkeys.verifyAuthentication({
        context: passkeyContextForRequest(request),
        challenge,
        response: response as AuthenticationResponseJSON
      });
      const issued = service.issuePasskeySession({
        principalId: verified.principalId,
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

  app.get("/api/operator/passkeys", async (request, reply) => {
    noStore(reply);
    requireSession(request);
    try {
      return {
        ok: true,
        passkeys: passkeys.list(passkeyContextForRequest(request))
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/passkeys/registration/options", async (request, reply) => {
    noStore(reply);
    requireSession(request);
    try {
      return await passkeys.createRegistrationOptions(passkeyContextForRequest(request));
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/passkeys/registration/verify", async (request, reply) => {
    noStore(reply);
    requireSession(request);
    const body = record(request.body);
    const challenge = typeof body.challenge === "string" ? body.challenge : "";
    const label = typeof body.label === "string" ? body.label : undefined;
    const response = body.response;
    if (!challenge || !response || typeof response !== "object" || Array.isArray(response)) {
      return sendApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Passkey challenge and registration response are required"
      );
    }
    try {
      return {
        ok: true,
        passkey: await passkeys.verifyRegistration({
          context: passkeyContextForRequest(request),
          challenge,
          response: response as RegistrationResponseJSON,
          label
        })
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.delete("/api/operator/passkeys/:id", async (request, reply) => {
    noStore(reply);
    requireSession(request);
    const params = record(request.params);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Passkey id is required");
    }
    try {
      const deleted = passkeys.delete(id, passkeyContextForRequest(request));
      if (!deleted) {
        return sendApiError(reply, 404, "PASSKEY_NOT_FOUND", "Passkey not found");
      }
      return { ok: true };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.get("/api/operator/totp", async (request, reply) => {
    noStore(reply);
    const session = requireSession(request);
    return {
      ok: true,
      ...totp.status(session.principalId)
    };
  });

  app.post("/api/operator/totp/enrollment", async (request, reply) => {
    noStore(reply);
    const session = requireSession(request);
    try {
      return {
        ok: true,
        ...totp.startEnrollment(session.principalId)
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/totp/enrollment/verify", async (request, reply) => {
    noStore(reply);
    const session = requireSession(request);
    const body = record(request.body);
    const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId : "";
    const code = typeof body.code === "string" ? body.code : "";
    if (!enrollmentId || !code) {
      return sendApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Enrollment id and verification code are required"
      );
    }
    try {
      const result = totp.confirmEnrollment({
        principalId: session.principalId,
        enrollmentId,
        code
      });
      const revokedSessionCount = service.revokeOtherSessions(session.sessionId);
      return {
        ok: true,
        ...result,
        revokedSessionCount
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/totp/recovery-codes/regenerate", async (request, reply) => {
    noStore(reply);
    const session = requireSession(request);
    const body = record(request.body);
    const verification = typeof body.verification === "string" ? body.verification : "";
    if (!verification) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Verification is required");
    }
    try {
      const result = totp.regenerateRecoveryCodes({
        principalId: session.principalId,
        verification
      });
      const revokedSessionCount = service.revokeOtherSessions(session.sessionId);
      return {
        ok: true,
        ...result,
        recoveryCodesRemaining: result.recoveryCodes.length,
        revokedSessionCount
      };
    } catch (error) {
      return sendOperatorError(reply, error);
    }
  });

  app.post("/api/operator/totp/disable", async (request, reply) => {
    noStore(reply);
    const session = requireSession(request);
    const body = record(request.body);
    const verification = typeof body.verification === "string" ? body.verification : "";
    if (!verification) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "Verification is required");
    }
    try {
      totp.disable({ principalId: session.principalId, verification });
      const revokedSessionCount = service.revokeOtherSessions(session.sessionId);
      return {
        ok: true,
        revokedSessionCount
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
