import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  hashOperatorPassword,
  verifyOperatorPassword
} from "./operator-password.js";
import {
  OperatorStore,
  hashOperatorSessionSecret,
  type OperatorPrincipalRecord,
  type OperatorSessionRecord
} from "./operator-store.js";

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const LOGIN_FREE_FAILURES = 5;
const LOGIN_BACKOFF_BASE_MS = 5 * 1000;
const LOGIN_BACKOFF_MAX_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH = [
  "v1",
  "scrypt",
  "N=32768,r=8,p=1",
  Buffer.alloc(32).toString("base64url"),
  Buffer.alloc(32).toString("base64url")
].join("$");

export class OperatorAuthError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    options: { retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = "OperatorAuthError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface OperatorSessionIssue {
  sessionId: string;
  sessionSecret: string;
  csrfToken: string;
  principalId: string;
  username: string;
  role: "owner";
  createdAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface OperatorSessionContext {
  sessionId: string;
  principalId: string;
  username: string;
  role: "owner";
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface OperatorServiceOptions {
  store: OperatorStore;
  now?: () => Date;
}

function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(username)) {
    throw new OperatorAuthError(
      "INVALID_USERNAME",
      "Operator username must contain 1-64 letters, numbers, dots, dashes, or underscores",
      400
    );
  }
  return username;
}

function digestMetadata(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function sessionIsActive(session: OperatorSessionRecord, nowIso: string): boolean {
  return (
    session.revokedAt === null &&
    session.idleExpiresAt > nowIso &&
    session.absoluteExpiresAt > nowIso
  );
}

function buildContext(
  session: OperatorSessionRecord,
  principal: OperatorPrincipalRecord
): OperatorSessionContext {
  return {
    sessionId: session.id,
    principalId: principal.id,
    username: principal.username,
    role: principal.role,
    csrfToken: session.csrfToken,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt
  };
}

export class OperatorService {
  readonly store: OperatorStore;
  private readonly now: () => Date;

  constructor(options: OperatorServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  status(): { configured: boolean; username: string | null } {
    const owner = this.store.getOwner();
    return {
      configured: Boolean(owner),
      username: owner?.username ?? null
    };
  }

  sourceHash(source: string): string {
    return digestMetadata(source || "unknown");
  }

  async setOwnerPassword(input: {
    username: string;
    password: string;
  }): Promise<{ username: string; revokedSessionCount: number }> {
    const username = normalizeUsername(input.username);
    const passwordHash = await hashOperatorPassword(input.password);
    const nowIso = this.now().toISOString();
    const result = this.store.setOwner({ username, passwordHash }, nowIso);
    this.store.recordAuditEvent({
      eventType: "operator.password.updated",
      principalId: result.principal.id,
      createdAt: nowIso,
      details: { revokedSessionCount: result.revokedSessionCount }
    });
    return {
      username: result.principal.username,
      revokedSessionCount: result.revokedSessionCount
    };
  }

  async login(input: {
    username: string;
    password: string;
    source: string;
    userAgent?: string;
  }): Promise<OperatorSessionIssue> {
    const now = this.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const sourceHash = this.sourceHash(input.source);
    const userAgentHash = input.userAgent ? digestMetadata(input.userAgent) : null;
    const throttle = this.store.getLoginThrottle(sourceHash);

    if (throttle?.blockedUntil && throttle.blockedUntil > nowIso) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((Date.parse(throttle.blockedUntil) - nowMs) / 1000)
      );
      this.store.recordAuditEvent({
        eventType: "operator.login.rate_limited",
        sourceHash,
        userAgentHash,
        createdAt: nowIso,
        details: { retryAfterSeconds }
      });
      throw new OperatorAuthError(
        "LOGIN_RATE_LIMITED",
        "Sign-in is temporarily rate limited",
        429,
        { retryAfterSeconds }
      );
    }

    const owner = this.store.getOwner();
    if (!owner) {
      throw new OperatorAuthError(
        "OPERATOR_SETUP_REQUIRED",
        "Web Operator account has not been configured",
        503
      );
    }

    const normalizedInputUsername = input.username.trim().toLowerCase();
    const usernameMatches = normalizedInputUsername === owner.username;
    const passwordMatches = await verifyOperatorPassword(
      input.password,
      usernameMatches ? owner.passwordHash : DUMMY_PASSWORD_HASH
    );

    if (!usernameMatches || !passwordMatches) {
      const failedCount = (throttle?.failedCount ?? 0) + 1;
      const blockDelayMs =
        failedCount > LOGIN_FREE_FAILURES
          ? Math.min(
              LOGIN_BACKOFF_MAX_MS,
              LOGIN_BACKOFF_BASE_MS * 2 ** (failedCount - LOGIN_FREE_FAILURES - 1)
            )
          : 0;
      const blockedUntil = blockDelayMs > 0 ? toIso(nowMs + blockDelayMs) : null;
      this.store.setLoginThrottle({
        sourceHash,
        failedCount,
        blockedUntil,
        updatedAt: nowIso
      });
      this.store.recordAuditEvent({
        eventType: "operator.login.failed",
        principalId: usernameMatches ? owner.id : null,
        sourceHash,
        userAgentHash,
        createdAt: nowIso,
        details: {
          failedCount,
          blocked: Boolean(blockedUntil)
        }
      });
      throw new OperatorAuthError(
        "INVALID_CREDENTIALS",
        "Username or password is incorrect",
        401
      );
    }

    this.store.clearLoginThrottle(sourceHash);
    const sessionSecret = `cc_web_${randomBytes(32).toString("base64url")}`;
    const csrfToken = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();
    const idleExpiresAt = toIso(nowMs + SESSION_IDLE_MS);
    const absoluteExpiresAt = toIso(nowMs + SESSION_ABSOLUTE_MS);
    this.store.createSession({
      id: sessionId,
      principalId: owner.id,
      secretHash: hashOperatorSessionSecret(sessionSecret),
      csrfToken,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      idleExpiresAt,
      absoluteExpiresAt,
      sourceHash,
      userAgentHash
    });
    this.store.recordAuditEvent({
      eventType: "operator.login.succeeded",
      principalId: owner.id,
      sourceHash,
      userAgentHash,
      createdAt: nowIso,
      details: { sessionId }
    });

    return {
      sessionId,
      sessionSecret,
      csrfToken,
      principalId: owner.id,
      username: owner.username,
      role: owner.role,
      createdAt: nowIso,
      idleExpiresAt,
      absoluteExpiresAt
    };
  }

  authenticate(sessionSecret: string): OperatorSessionContext | null {
    if (!sessionSecret) return null;
    const now = this.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const session = this.store.findActiveSessionBySecretHash(
      hashOperatorSessionSecret(sessionSecret),
      nowIso
    );
    if (!session) return null;

    const owner = this.store.getOwner();
    if (!owner || owner.id !== session.principalId) return null;

    const lastSeenMs = Date.parse(session.lastSeenAt);
    let activeSession = session;
    if (
      Number.isFinite(lastSeenMs) &&
      nowMs - lastSeenMs >= SESSION_TOUCH_INTERVAL_MS
    ) {
      const nextIdleMs = Math.min(
        nowMs + SESSION_IDLE_MS,
        Date.parse(session.absoluteExpiresAt)
      );
      const nextIdleExpiresAt = toIso(nextIdleMs);
      if (this.store.touchSession(session.id, nowIso, nextIdleExpiresAt)) {
        activeSession = {
          ...session,
          lastSeenAt: nowIso,
          idleExpiresAt: nextIdleExpiresAt
        };
      }
    }

    return buildContext(activeSession, owner);
  }

  logout(sessionId: string): boolean {
    const nowIso = this.now().toISOString();
    const session = this.store.getSession(sessionId);
    if (!session || !sessionIsActive(session, nowIso)) return false;
    const revoked = this.store.revokeSession(sessionId, nowIso);
    if (revoked) {
      this.store.recordAuditEvent({
        eventType: "operator.logout",
        principalId: session.principalId,
        sourceHash: session.sourceHash,
        userAgentHash: session.userAgentHash,
        createdAt: nowIso,
        details: { sessionId }
      });
    }
    return revoked;
  }

  revokeOtherSessions(actorSessionId: string): number {
    const nowIso = this.now().toISOString();
    const actor = this.store.getSession(actorSessionId);
    if (!actor || !sessionIsActive(actor, nowIso)) {
      throw new OperatorAuthError(
        "OPERATOR_SESSION_INVALID",
        "Operator session is no longer active",
        401
      );
    }
    const revokedSessionCount = this.store.revokeSessionsForPrincipal(
      actor.principalId,
      nowIso,
      actorSessionId
    );
    this.store.recordAuditEvent({
      eventType: "operator.sessions.revoked_others",
      principalId: actor.principalId,
      sourceHash: actor.sourceHash,
      userAgentHash: actor.userAgentHash,
      createdAt: nowIso,
      details: { revokedSessionCount, actorSessionId }
    });
    return revokedSessionCount;
  }

  revokeAllSessions(): number {
    const nowIso = this.now().toISOString();
    const owner = this.store.getOwner();
    if (!owner) return 0;
    const revokedSessionCount = this.store.revokeSessionsForPrincipal(owner.id, nowIso);
    this.store.recordAuditEvent({
      eventType: "operator.sessions.revoked_all",
      principalId: owner.id,
      createdAt: nowIso,
      details: { revokedSessionCount }
    });
    return revokedSessionCount;
  }

  listActiveSessions(): OperatorSessionRecord[] {
    const owner = this.store.getOwner();
    if (!owner) return [];
    return this.store.listActiveSessions(owner.id, this.now().toISOString());
  }
}
