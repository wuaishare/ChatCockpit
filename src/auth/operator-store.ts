import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const OPERATOR_SCHEMA_VERSION = 1;
const SENSITIVE_AUDIT_KEY = /(password|secret|token|cookie|authorization|csrf)/i;

export interface OperatorPrincipalRecord {
  id: string;
  username: string;
  role: "owner";
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorSessionRecord {
  id: string;
  principalId: string;
  secretHash: string;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  sourceHash: string | null;
  userAgentHash: string | null;
}

export interface OperatorLoginThrottleRecord {
  sourceHash: string;
  failedCount: number;
  blockedUntil: string | null;
  updatedAt: string;
}

export interface OperatorAuditEventRecord {
  id: string;
  eventType: string;
  principalId: string | null;
  sourceHash: string | null;
  userAgentHash: string | null;
  createdAt: string;
  details: Record<string, unknown>;
}

interface OperatorPrincipalRow {
  id: string;
  username: string;
  role: "owner";
  password_hash: string;
  created_at: string;
  updated_at: string;
}

interface OperatorSessionRow {
  id: string;
  principal_id: string;
  secret_hash: string;
  csrf_token: string;
  created_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  source_hash: string | null;
  user_agent_hash: string | null;
}

interface OperatorLoginThrottleRow {
  source_hash: string;
  failed_count: number;
  blocked_until: string | null;
  updated_at: string;
}

interface OperatorAuditEventRow {
  id: string;
  event_type: string;
  principal_id: string | null;
  source_hash: string | null;
  user_agent_hash: string | null;
  created_at: string;
  details_json: string;
}

export interface OperatorStoreOptions {
  path: string;
}

export interface SetOwnerInput {
  username: string;
  passwordHash: string;
}

export interface CreateOperatorSessionInput {
  id: string;
  principalId: string;
  secretHash: string;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  sourceHash?: string | null;
  userAgentHash?: string | null;
}

export interface SetLoginThrottleInput {
  sourceHash: string;
  failedCount: number;
  blockedUntil: string | null;
  updatedAt: string;
}

export interface RecordOperatorAuditEventInput {
  id?: string;
  eventType: string;
  principalId?: string | null;
  sourceHash?: string | null;
  userAgentHash?: string | null;
  createdAt: string;
  details?: Record<string, unknown>;
}

function mapPrincipal(row: OperatorPrincipalRow): OperatorPrincipalRecord {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSession(row: OperatorSessionRow): OperatorSessionRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    secretHash: row.secret_hash,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
    sourceHash: row.source_hash,
    userAgentHash: row.user_agent_hash
  };
}

function mapThrottle(row: OperatorLoginThrottleRow): OperatorLoginThrottleRecord {
  return {
    sourceHash: row.source_hash,
    failedCount: row.failed_count,
    blockedUntil: row.blocked_until,
    updatedAt: row.updated_at
  };
}

function parseAuditDetails(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Operator audit details must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function mapAuditEvent(row: OperatorAuditEventRow): OperatorAuditEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    principalId: row.principal_id,
    sourceHash: row.source_hash,
    userAgentHash: row.user_agent_hash,
    createdAt: row.created_at,
    details: parseAuditDetails(row.details_json)
  };
}

function assertAuditDetailsSafe(value: unknown, pathParts: string[] = []): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAuditDetailsSafe(entry, [...pathParts, String(index)]));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_AUDIT_KEY.test(key)) {
      const location = [...pathParts, key].join(".");
      throw new Error(`Sensitive audit detail key is not allowed: ${location}`);
    }
    assertAuditDetailsSafe(entry, [...pathParts, key]);
  }
}

export function hashOperatorSessionSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function operatorDatabasePath(runtimeDir: string): string {
  return path.join(runtimeDir, "operator-auth.sqlite");
}

export class OperatorStore {
  readonly sqlite: DatabaseSync;
  readonly path: string;
  private closed = false;
  private transactionDepth = 0;

  constructor(options: OperatorStoreOptions) {
    this.path = options.path;
    if (this.path !== ":memory:") {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }
    this.sqlite = new DatabaseSync(this.path);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    if (this.path !== ":memory:") {
      this.sqlite.exec("PRAGMA journal_mode = WAL");
    }
    this.initializeSchema();
    if (this.path !== ":memory:") {
      fs.chmodSync(this.path, 0o600);
    }
  }

  close(): void {
    if (this.closed) return;
    this.sqlite.close();
    this.closed = true;
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();
    this.sqlite.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  schemaVersion(): number {
    const row = this.sqlite.prepare("PRAGMA user_version").get() as
      | { user_version: number }
      | undefined;
    return row?.user_version ?? 0;
  }

  getOwner(): OperatorPrincipalRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM operator_principals WHERE role = 'owner' LIMIT 1")
      .get() as OperatorPrincipalRow | undefined;
    return row ? mapPrincipal(row) : null;
  }

  setOwner(
    input: SetOwnerInput,
    updatedAt: string
  ): { principal: OperatorPrincipalRecord; revokedSessionCount: number } {
    return this.transaction(() => {
      const existing = this.getOwner();
      let principalId: string;
      let revokedSessionCount = 0;
      if (existing) {
        principalId = existing.id;
        this.sqlite
          .prepare(`
            UPDATE operator_principals
            SET username = ?, password_hash = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(input.username, input.passwordHash, updatedAt, existing.id);
        revokedSessionCount = Number(
          this.sqlite
            .prepare(`
              UPDATE operator_sessions
              SET revoked_at = ?
              WHERE principal_id = ? AND revoked_at IS NULL
            `)
            .run(updatedAt, existing.id).changes
        );
      } else {
        principalId = randomUUID();
        this.sqlite
          .prepare(`
            INSERT INTO operator_principals (
              id, username, role, password_hash, created_at, updated_at
            ) VALUES (?, ?, 'owner', ?, ?, ?)
          `)
          .run(principalId, input.username, input.passwordHash, updatedAt, updatedAt);
      }
      const principal = this.getOwner();
      if (!principal || principal.id !== principalId) {
        throw new Error("Operator owner persistence failed");
      }
      return { principal, revokedSessionCount };
    });
  }

  createSession(input: CreateOperatorSessionInput): OperatorSessionRecord {
    this.sqlite
      .prepare(`
        INSERT INTO operator_sessions (
          id, principal_id, secret_hash, csrf_token, created_at, last_seen_at,
          idle_expires_at, absolute_expires_at, revoked_at, source_hash, user_agent_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `)
      .run(
        input.id,
        input.principalId,
        input.secretHash,
        input.csrfToken,
        input.createdAt,
        input.lastSeenAt,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.sourceHash ?? null,
        input.userAgentHash ?? null
      );
    const session = this.getSession(input.id);
    if (!session) throw new Error("Operator session persistence failed");
    return session;
  }

  getSession(id: string): OperatorSessionRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM operator_sessions WHERE id = ?")
      .get(id) as OperatorSessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  findActiveSessionBySecretHash(
    secretHash: string,
    now: string
  ): OperatorSessionRecord | null {
    const row = this.sqlite
      .prepare(`
        SELECT * FROM operator_sessions
        WHERE secret_hash = ?
          AND revoked_at IS NULL
          AND idle_expires_at > ?
          AND absolute_expires_at > ?
        LIMIT 1
      `)
      .get(secretHash, now, now) as OperatorSessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  touchSession(id: string, lastSeenAt: string, idleExpiresAt: string): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE operator_sessions
        SET last_seen_at = ?, idle_expires_at = ?
        WHERE id = ? AND revoked_at IS NULL
      `)
      .run(lastSeenAt, idleExpiresAt, id);
    return result.changes === 1;
  }

  revokeSession(id: string, revokedAt: string): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE operator_sessions
        SET revoked_at = ?
        WHERE id = ? AND revoked_at IS NULL
      `)
      .run(revokedAt, id);
    return result.changes === 1;
  }

  revokeSessionsForPrincipal(
    principalId: string,
    revokedAt: string,
    exceptSessionId?: string
  ): number {
    const result = exceptSessionId
      ? this.sqlite
          .prepare(`
            UPDATE operator_sessions
            SET revoked_at = ?
            WHERE principal_id = ? AND revoked_at IS NULL AND id <> ?
          `)
          .run(revokedAt, principalId, exceptSessionId)
      : this.sqlite
          .prepare(`
            UPDATE operator_sessions
            SET revoked_at = ?
            WHERE principal_id = ? AND revoked_at IS NULL
          `)
          .run(revokedAt, principalId);
    return Number(result.changes);
  }

  listActiveSessions(principalId: string, now: string): OperatorSessionRecord[] {
    const rows = this.sqlite
      .prepare(`
        SELECT * FROM operator_sessions
        WHERE principal_id = ?
          AND revoked_at IS NULL
          AND idle_expires_at > ?
          AND absolute_expires_at > ?
        ORDER BY created_at DESC, id DESC
      `)
      .all(principalId, now, now) as unknown as OperatorSessionRow[];
    return rows.map(mapSession);
  }

  getLoginThrottle(sourceHash: string): OperatorLoginThrottleRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM operator_login_throttle WHERE source_hash = ?")
      .get(sourceHash) as OperatorLoginThrottleRow | undefined;
    return row ? mapThrottle(row) : null;
  }

  setLoginThrottle(input: SetLoginThrottleInput): OperatorLoginThrottleRecord {
    this.sqlite
      .prepare(`
        INSERT INTO operator_login_throttle (
          source_hash, failed_count, blocked_until, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(source_hash) DO UPDATE SET
          failed_count = excluded.failed_count,
          blocked_until = excluded.blocked_until,
          updated_at = excluded.updated_at
      `)
      .run(input.sourceHash, input.failedCount, input.blockedUntil, input.updatedAt);
    const throttle = this.getLoginThrottle(input.sourceHash);
    if (!throttle) throw new Error("Operator login throttle persistence failed");
    return throttle;
  }

  clearLoginThrottle(sourceHash: string): void {
    this.sqlite
      .prepare("DELETE FROM operator_login_throttle WHERE source_hash = ?")
      .run(sourceHash);
  }

  recordAuditEvent(input: RecordOperatorAuditEventInput): OperatorAuditEventRecord {
    const details = input.details ?? {};
    assertAuditDetailsSafe(details);
    const id = input.id ?? randomUUID();
    this.sqlite
      .prepare(`
        INSERT INTO operator_audit_events (
          id, event_type, principal_id, source_hash, user_agent_hash, created_at, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.eventType,
        input.principalId ?? null,
        input.sourceHash ?? null,
        input.userAgentHash ?? null,
        input.createdAt,
        JSON.stringify(details)
      );
    const row = this.sqlite
      .prepare("SELECT * FROM operator_audit_events WHERE id = ?")
      .get(id) as OperatorAuditEventRow | undefined;
    if (!row) throw new Error("Operator audit event persistence failed");
    return mapAuditEvent(row);
  }

  listAuditEvents(limit = 100): OperatorAuditEventRecord[] {
    const normalizedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = this.sqlite
      .prepare(`
        SELECT * FROM operator_audit_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(normalizedLimit) as unknown as OperatorAuditEventRow[];
    return rows.map(mapAuditEvent);
  }

  private initializeSchema(): void {
    const currentVersion = this.schemaVersion();
    if (currentVersion > OPERATOR_SCHEMA_VERSION) {
      throw new Error(
        `Operator auth database schema v${currentVersion} is newer than supported v${OPERATOR_SCHEMA_VERSION}`
      );
    }
    if (currentVersion === OPERATOR_SCHEMA_VERSION) return;
    if (currentVersion !== 0) {
      throw new Error(`Unsupported Operator auth database schema v${currentVersion}`);
    }

    this.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE operator_principals (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK(role = 'owner'),
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE operator_sessions (
          id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          secret_hash TEXT NOT NULL UNIQUE,
          csrf_token TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          idle_expires_at TEXT NOT NULL,
          absolute_expires_at TEXT NOT NULL,
          revoked_at TEXT,
          source_hash TEXT,
          user_agent_hash TEXT,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_sessions_principal_idx
          ON operator_sessions(principal_id, revoked_at, absolute_expires_at);

        CREATE TABLE operator_login_throttle (
          source_hash TEXT PRIMARY KEY,
          failed_count INTEGER NOT NULL CHECK(failed_count >= 0),
          blocked_until TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE operator_audit_events (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          principal_id TEXT,
          source_hash TEXT,
          user_agent_hash TEXT,
          created_at TEXT NOT NULL,
          details_json TEXT NOT NULL,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_audit_events_created_idx
          ON operator_audit_events(created_at DESC);

        PRAGMA user_version = ${OPERATOR_SCHEMA_VERSION};
      `);
    });
  }
}
