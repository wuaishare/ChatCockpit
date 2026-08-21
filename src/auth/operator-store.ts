import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const OPERATOR_SCHEMA_VERSION = 5;
const SENSITIVE_AUDIT_KEY = /(password|secret|token|cookie|authorization|csrf|recovery.?code|totp)/i;

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

export interface OperatorLocalLoginGrantRecord {
  id: string;
  principalId: string;
  secretHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OperatorLoginGateRecord {
  id: string;
  principalId: string;
  secretHash: string;
  purpose: "secure-entry";
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OperatorPasskeyRecord {
  id: string;
  principalId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  label: string;
  rpId: string;
  origin: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OperatorWebAuthnChallengeRecord {
  id: string;
  principalId: string;
  kind: "registration" | "authentication";
  challenge: string;
  rpId: string;
  origin: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OperatorMfaStateRecord {
  principalId: string;
  enabled: boolean;
  lastAcceptedTotpStep: number | null;
  updatedAt: string;
}

export interface OperatorMfaLoginChallengeRecord {
  id: string;
  principalId: string;
  challengeHash: string;
  sourceHash: string;
  userAgentHash: string | null;
  createdAt: string;
  expiresAt: string;
  failedCount: number;
  consumedAt: string | null;
}

export interface OperatorRecoveryCodeRecord {
  id: string;
  principalId: string;
  codeHash: string;
  createdAt: string;
  usedAt: string | null;
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

interface OperatorLocalLoginGrantRow {
  id: string;
  principal_id: string;
  secret_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface OperatorLoginGateRow {
  id: string;
  principal_id: string;
  secret_hash: string;
  purpose: "secure-entry";
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface OperatorPasskeyRow {
  id: string;
  principal_id: string;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports_json: string;
  device_type: string;
  backed_up: number;
  label: string;
  rp_id: string;
  origin: string;
  created_at: string;
  last_used_at: string | null;
}

interface OperatorWebAuthnChallengeRow {
  id: string;
  principal_id: string;
  kind: "registration" | "authentication";
  challenge: string;
  rp_id: string;
  origin: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface OperatorMfaStateRow {
  principal_id: string;
  enabled: number;
  last_accepted_totp_step: number | null;
  updated_at: string;
}

interface OperatorMfaLoginChallengeRow {
  id: string;
  principal_id: string;
  challenge_hash: string;
  source_hash: string;
  user_agent_hash: string | null;
  created_at: string;
  expires_at: string;
  failed_count: number;
  consumed_at: string | null;
}

interface OperatorRecoveryCodeRow {
  id: string;
  principal_id: string;
  code_hash: string;
  created_at: string;
  used_at: string | null;
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

function secureOperatorDatabaseFiles(databasePath: string): void {
  if (databasePath === ":memory:") return;
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) {
      fs.chmodSync(candidate, 0o600);
    }
  }
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

export interface CreateOperatorLocalLoginGrantInput {
  id: string;
  principalId: string;
  secretHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateOperatorLoginGateInput {
  id: string;
  principalId: string;
  secretHash: string;
  purpose: "secure-entry";
  createdAt: string;
  expiresAt: string;
}

export interface CreateOperatorPasskeyInput {
  id: string;
  principalId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  label: string;
  rpId: string;
  origin: string;
  createdAt: string;
}

export interface CreateOperatorWebAuthnChallengeInput {
  id: string;
  principalId: string;
  kind: "registration" | "authentication";
  challenge: string;
  rpId: string;
  origin: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateOperatorMfaLoginChallengeInput {
  id: string;
  principalId: string;
  challengeHash: string;
  sourceHash: string;
  userAgentHash?: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreateOperatorRecoveryCodeInput {
  id: string;
  principalId: string;
  codeHash: string;
  createdAt: string;
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

function mapLocalLoginGrant(
  row: OperatorLocalLoginGrantRow
): OperatorLocalLoginGrantRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    secretHash: row.secret_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

function mapLoginGate(row: OperatorLoginGateRow): OperatorLoginGateRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    secretHash: row.secret_hash,
    purpose: row.purpose,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

function parseTransports(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function mapPasskey(row: OperatorPasskeyRow): OperatorPasskeyRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    credentialId: row.credential_id,
    publicKey: new Uint8Array(row.public_key),
    counter: Number(row.counter),
    transports: parseTransports(row.transports_json),
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    label: row.label,
    rpId: row.rp_id,
    origin: row.origin,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  };
}

function mapWebAuthnChallenge(
  row: OperatorWebAuthnChallengeRow
): OperatorWebAuthnChallengeRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    kind: row.kind,
    challenge: row.challenge,
    rpId: row.rp_id,
    origin: row.origin,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

function mapMfaState(row: OperatorMfaStateRow): OperatorMfaStateRecord {
  return {
    principalId: row.principal_id,
    enabled: row.enabled === 1,
    lastAcceptedTotpStep:
      row.last_accepted_totp_step === null ? null : Number(row.last_accepted_totp_step),
    updatedAt: row.updated_at
  };
}

function mapMfaLoginChallenge(
  row: OperatorMfaLoginChallengeRow
): OperatorMfaLoginChallengeRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    challengeHash: row.challenge_hash,
    sourceHash: row.source_hash,
    userAgentHash: row.user_agent_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    failedCount: Number(row.failed_count),
    consumedAt: row.consumed_at
  };
}

function mapRecoveryCode(row: OperatorRecoveryCodeRow): OperatorRecoveryCodeRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    codeHash: row.code_hash,
    createdAt: row.created_at,
    usedAt: row.used_at
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

export function hashOperatorLocalLoginSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashOperatorLoginGateSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashOperatorMfaLoginSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashOperatorRecoveryCode(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function operatorDatabasePath(runtimeDir: string): string {
  return path.join(runtimeDir, "operator-auth.sqlite");
}

export function hasConfiguredOperatorOwner(runtimeDir: string): boolean {
  const databasePath = operatorDatabasePath(runtimeDir);
  if (!fs.existsSync(databasePath)) return false;

  let sqlite: DatabaseSync | null = null;
  try {
    sqlite = new DatabaseSync(databasePath, { readOnly: true });
    const row = sqlite
      .prepare("SELECT 1 AS configured FROM operator_principals WHERE role = 'owner' LIMIT 1")
      .get() as { configured: number } | undefined;
    return row?.configured === 1;
  } catch {
    return false;
  } finally {
    sqlite?.close();
  }
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
      if (!fs.existsSync(this.path)) {
        fs.closeSync(fs.openSync(this.path, "a", 0o600));
      }
      secureOperatorDatabaseFiles(this.path);
    }
    this.sqlite = new DatabaseSync(this.path);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    if (this.path !== ":memory:") {
      this.sqlite.exec("PRAGMA journal_mode = WAL");
    }
    this.initializeSchema();
    secureOperatorDatabaseFiles(this.path);
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
        this.sqlite
          .prepare(`
            UPDATE operator_local_login_grants
            SET consumed_at = ?
            WHERE principal_id = ? AND consumed_at IS NULL
          `)
          .run(updatedAt, existing.id);
        this.sqlite
          .prepare(`
            UPDATE operator_webauthn_challenges
            SET consumed_at = ?
            WHERE principal_id = ? AND consumed_at IS NULL
          `)
          .run(updatedAt, existing.id);
        this.sqlite
          .prepare(`
            UPDATE operator_mfa_login_challenges
            SET consumed_at = ?
            WHERE principal_id = ? AND consumed_at IS NULL
          `)
          .run(updatedAt, existing.id);
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

  createLocalLoginGrant(
    input: CreateOperatorLocalLoginGrantInput
  ): OperatorLocalLoginGrantRecord {
    this.sqlite
      .prepare(`
        DELETE FROM operator_local_login_grants
        WHERE consumed_at IS NOT NULL OR expires_at <= ?
      `)
      .run(input.createdAt);
    this.sqlite
      .prepare(`
        INSERT INTO operator_local_login_grants (
          id, principal_id, secret_hash, created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, NULL)
      `)
      .run(
        input.id,
        input.principalId,
        input.secretHash,
        input.createdAt,
        input.expiresAt
      );
    const row = this.sqlite
      .prepare("SELECT * FROM operator_local_login_grants WHERE id = ?")
      .get(input.id) as OperatorLocalLoginGrantRow | undefined;
    if (!row) throw new Error("Operator local login grant persistence failed");
    return mapLocalLoginGrant(row);
  }

  invalidateLocalLoginGrants(principalId: string, invalidatedAt: string): number {
    return Number(
      this.sqlite
        .prepare(`
          UPDATE operator_local_login_grants
          SET consumed_at = ?
          WHERE principal_id = ? AND consumed_at IS NULL
        `)
        .run(invalidatedAt, principalId).changes
    );
  }

  consumeLocalLoginGrant(
    secretHash: string,
    consumedAt: string
  ): OperatorLocalLoginGrantRecord | null {
    return this.transaction(() => {
      const row = this.sqlite
        .prepare(`
          SELECT * FROM operator_local_login_grants
          WHERE secret_hash = ?
            AND consumed_at IS NULL
            AND expires_at > ?
          LIMIT 1
        `)
        .get(secretHash, consumedAt) as OperatorLocalLoginGrantRow | undefined;
      if (!row) return null;

      const result = this.sqlite
        .prepare(`
          UPDATE operator_local_login_grants
          SET consumed_at = ?
          WHERE id = ? AND consumed_at IS NULL
        `)
        .run(consumedAt, row.id);
      if (result.changes !== 1) return null;
      return mapLocalLoginGrant({ ...row, consumed_at: consumedAt });
    });
  }

  createLoginGate(input: CreateOperatorLoginGateInput): OperatorLoginGateRecord {
    this.sqlite
      .prepare(`
        DELETE FROM operator_login_gates
        WHERE consumed_at IS NOT NULL OR expires_at <= ?
      `)
      .run(input.createdAt);
    this.sqlite
      .prepare(`
        INSERT INTO operator_login_gates (
          id, principal_id, secret_hash, purpose, created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        input.id,
        input.principalId,
        input.secretHash,
        input.purpose,
        input.createdAt,
        input.expiresAt
      );
    const row = this.sqlite
      .prepare("SELECT * FROM operator_login_gates WHERE id = ?")
      .get(input.id) as OperatorLoginGateRow | undefined;
    if (!row) throw new Error("Operator login gate persistence failed");
    return mapLoginGate(row);
  }

  getActiveLoginGate(
    secretHash: string,
    nowIso: string
  ): OperatorLoginGateRecord | null {
    const row = this.sqlite
      .prepare(`
        SELECT * FROM operator_login_gates
        WHERE secret_hash = ?
          AND consumed_at IS NULL
          AND expires_at > ?
        LIMIT 1
      `)
      .get(secretHash, nowIso) as OperatorLoginGateRow | undefined;
    return row ? mapLoginGate(row) : null;
  }

  consumeLoginGate(
    secretHash: string,
    consumedAt: string
  ): OperatorLoginGateRecord | null {
    return this.transaction(() => {
      const row = this.sqlite
        .prepare(`
          SELECT * FROM operator_login_gates
          WHERE secret_hash = ?
            AND consumed_at IS NULL
            AND expires_at > ?
          LIMIT 1
        `)
        .get(secretHash, consumedAt) as OperatorLoginGateRow | undefined;
      if (!row) return null;

      const result = this.sqlite
        .prepare(`
          UPDATE operator_login_gates
          SET consumed_at = ?
          WHERE id = ? AND consumed_at IS NULL
        `)
        .run(consumedAt, row.id);
      if (result.changes !== 1) return null;
      return mapLoginGate({ ...row, consumed_at: consumedAt });
    });
  }

  invalidateLoginGates(principalId: string, invalidatedAt: string): number {
    return Number(
      this.sqlite
        .prepare(`
          UPDATE operator_login_gates
          SET consumed_at = ?
          WHERE principal_id = ? AND consumed_at IS NULL
        `)
        .run(invalidatedAt, principalId).changes
    );
  }

  listPasskeys(principalId: string, rpId?: string): OperatorPasskeyRecord[] {
    const rows = rpId
      ? (this.sqlite
          .prepare(`
            SELECT * FROM operator_passkeys
            WHERE principal_id = ? AND rp_id = ?
            ORDER BY created_at ASC, id ASC
          `)
          .all(principalId, rpId) as unknown as OperatorPasskeyRow[])
      : (this.sqlite
          .prepare(`
            SELECT * FROM operator_passkeys
            WHERE principal_id = ?
            ORDER BY created_at ASC, id ASC
          `)
          .all(principalId) as unknown as OperatorPasskeyRow[]);
    return rows.map(mapPasskey);
  }

  getPasskeyByCredentialId(credentialId: string): OperatorPasskeyRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM operator_passkeys WHERE credential_id = ?")
      .get(credentialId) as OperatorPasskeyRow | undefined;
    return row ? mapPasskey(row) : null;
  }

  createPasskey(input: CreateOperatorPasskeyInput): OperatorPasskeyRecord {
    this.sqlite
      .prepare(`
        INSERT INTO operator_passkeys (
          id, principal_id, credential_id, public_key, counter,
          transports_json, device_type, backed_up, label, rp_id, origin,
          created_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        input.id,
        input.principalId,
        input.credentialId,
        Buffer.from(input.publicKey),
        input.counter,
        JSON.stringify(input.transports),
        input.deviceType,
        input.backedUp ? 1 : 0,
        input.label,
        input.rpId,
        input.origin,
        input.createdAt
      );
    const row = this.sqlite
      .prepare("SELECT * FROM operator_passkeys WHERE id = ?")
      .get(input.id) as OperatorPasskeyRow | undefined;
    if (!row) throw new Error("Operator Passkey persistence failed");
    return mapPasskey(row);
  }

  updatePasskeyUsage(input: {
    id: string;
    counter: number;
    backedUp: boolean;
    lastUsedAt: string;
  }): OperatorPasskeyRecord {
    const result = this.sqlite
      .prepare(`
        UPDATE operator_passkeys
        SET counter = ?, backed_up = ?, last_used_at = ?
        WHERE id = ?
      `)
      .run(input.counter, input.backedUp ? 1 : 0, input.lastUsedAt, input.id);
    if (result.changes !== 1) throw new Error("Operator Passkey update failed");
    const row = this.sqlite
      .prepare("SELECT * FROM operator_passkeys WHERE id = ?")
      .get(input.id) as OperatorPasskeyRow | undefined;
    if (!row) throw new Error("Operator Passkey disappeared after update");
    return mapPasskey(row);
  }

  deletePasskey(id: string, principalId: string): boolean {
    return (
      this.sqlite
        .prepare("DELETE FROM operator_passkeys WHERE id = ? AND principal_id = ?")
        .run(id, principalId).changes === 1
    );
  }

  createWebAuthnChallenge(
    input: CreateOperatorWebAuthnChallengeInput
  ): OperatorWebAuthnChallengeRecord {
    this.sqlite
      .prepare(`
        DELETE FROM operator_webauthn_challenges
        WHERE consumed_at IS NOT NULL OR expires_at <= ?
      `)
      .run(input.createdAt);
    this.sqlite
      .prepare(`
        DELETE FROM operator_webauthn_challenges
        WHERE principal_id = ? AND kind = ? AND rp_id = ? AND origin = ?
      `)
      .run(input.principalId, input.kind, input.rpId, input.origin);
    this.sqlite
      .prepare(`
        INSERT INTO operator_webauthn_challenges (
          id, principal_id, kind, challenge, rp_id, origin,
          created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        input.id,
        input.principalId,
        input.kind,
        input.challenge,
        input.rpId,
        input.origin,
        input.createdAt,
        input.expiresAt
      );
    const row = this.sqlite
      .prepare("SELECT * FROM operator_webauthn_challenges WHERE id = ?")
      .get(input.id) as OperatorWebAuthnChallengeRow | undefined;
    if (!row) throw new Error("Operator WebAuthn challenge persistence failed");
    return mapWebAuthnChallenge(row);
  }

  consumeWebAuthnChallenge(input: {
    challenge: string;
    kind: "registration" | "authentication";
    consumedAt: string;
  }): OperatorWebAuthnChallengeRecord | null {
    return this.transaction(() => {
      const row = this.sqlite
        .prepare(`
          SELECT * FROM operator_webauthn_challenges
          WHERE challenge = ? AND kind = ?
            AND consumed_at IS NULL AND expires_at > ?
          LIMIT 1
        `)
        .get(input.challenge, input.kind, input.consumedAt) as
        | OperatorWebAuthnChallengeRow
        | undefined;
      if (!row) return null;
      const result = this.sqlite
        .prepare(`
          UPDATE operator_webauthn_challenges
          SET consumed_at = ?
          WHERE id = ? AND consumed_at IS NULL
        `)
        .run(input.consumedAt, row.id);
      if (result.changes !== 1) return null;
      return mapWebAuthnChallenge({ ...row, consumed_at: input.consumedAt });
    });
  }

  invalidateWebAuthnChallenges(principalId: string, invalidatedAt: string): number {
    return Number(
      this.sqlite
        .prepare(`
          UPDATE operator_webauthn_challenges
          SET consumed_at = ?
          WHERE principal_id = ? AND consumed_at IS NULL
        `)
        .run(invalidatedAt, principalId).changes
    );
  }

  getMfaState(principalId: string): OperatorMfaStateRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM operator_mfa_state WHERE principal_id = ?")
      .get(principalId) as OperatorMfaStateRow | undefined;
    return row ? mapMfaState(row) : null;
  }

  setMfaEnabled(principalId: string, enabled: boolean, updatedAt: string): OperatorMfaStateRecord {
    this.sqlite
      .prepare(`
        INSERT INTO operator_mfa_state (
          principal_id, enabled, last_accepted_totp_step, updated_at
        ) VALUES (?, ?, NULL, ?)
        ON CONFLICT(principal_id) DO UPDATE SET
          enabled = excluded.enabled,
          last_accepted_totp_step = NULL,
          updated_at = excluded.updated_at
      `)
      .run(principalId, enabled ? 1 : 0, updatedAt);
    const state = this.getMfaState(principalId);
    if (!state) throw new Error("Operator MFA state persistence failed");
    return state;
  }

  acceptTotpStep(principalId: string, step: number, updatedAt: string): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE operator_mfa_state
        SET last_accepted_totp_step = ?, updated_at = ?
        WHERE principal_id = ?
          AND enabled = 1
          AND (last_accepted_totp_step IS NULL OR last_accepted_totp_step < ?)
      `)
      .run(step, updatedAt, principalId, step);
    return result.changes === 1;
  }

  createMfaLoginChallenge(
    input: CreateOperatorMfaLoginChallengeInput
  ): OperatorMfaLoginChallengeRecord {
    this.sqlite
      .prepare(`
        DELETE FROM operator_mfa_login_challenges
        WHERE consumed_at IS NOT NULL OR expires_at <= ?
      `)
      .run(input.createdAt);
    this.sqlite
      .prepare(`
        UPDATE operator_mfa_login_challenges
        SET consumed_at = ?
        WHERE principal_id = ? AND consumed_at IS NULL
      `)
      .run(input.createdAt, input.principalId);
    this.sqlite
      .prepare(`
        INSERT INTO operator_mfa_login_challenges (
          id, principal_id, challenge_hash, source_hash, user_agent_hash,
          created_at, expires_at, failed_count, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
      `)
      .run(
        input.id,
        input.principalId,
        input.challengeHash,
        input.sourceHash,
        input.userAgentHash ?? null,
        input.createdAt,
        input.expiresAt
      );
    const row = this.sqlite
      .prepare("SELECT * FROM operator_mfa_login_challenges WHERE id = ?")
      .get(input.id) as OperatorMfaLoginChallengeRow | undefined;
    if (!row) throw new Error("Operator MFA login challenge persistence failed");
    return mapMfaLoginChallenge(row);
  }

  findActiveMfaLoginChallengeByHash(
    challengeHash: string,
    now: string
  ): OperatorMfaLoginChallengeRecord | null {
    const row = this.sqlite
      .prepare(`
        SELECT * FROM operator_mfa_login_challenges
        WHERE challenge_hash = ?
          AND consumed_at IS NULL
          AND expires_at > ?
        LIMIT 1
      `)
      .get(challengeHash, now) as OperatorMfaLoginChallengeRow | undefined;
    return row ? mapMfaLoginChallenge(row) : null;
  }

  recordMfaLoginChallengeFailure(
    id: string,
    failedAt: string,
    maxAttempts: number
  ): OperatorMfaLoginChallengeRecord | null {
    return this.transaction(() => {
      const row = this.sqlite
        .prepare("SELECT * FROM operator_mfa_login_challenges WHERE id = ?")
        .get(id) as OperatorMfaLoginChallengeRow | undefined;
      if (!row || row.consumed_at !== null || row.expires_at <= failedAt) return null;
      const failedCount = Number(row.failed_count) + 1;
      const consumedAt = failedCount >= maxAttempts ? failedAt : null;
      this.sqlite
        .prepare(`
          UPDATE operator_mfa_login_challenges
          SET failed_count = ?, consumed_at = ?
          WHERE id = ? AND consumed_at IS NULL
        `)
        .run(failedCount, consumedAt, id);
      return mapMfaLoginChallenge({
        ...row,
        failed_count: failedCount,
        consumed_at: consumedAt
      });
    });
  }

  consumeMfaLoginChallenge(id: string, consumedAt: string): boolean {
    return (
      this.sqlite
        .prepare(`
          UPDATE operator_mfa_login_challenges
          SET consumed_at = ?
          WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
        `)
        .run(consumedAt, id, consumedAt).changes === 1
    );
  }

  invalidateMfaLoginChallenges(principalId: string, invalidatedAt: string): number {
    return Number(
      this.sqlite
        .prepare(`
          UPDATE operator_mfa_login_challenges
          SET consumed_at = ?
          WHERE principal_id = ? AND consumed_at IS NULL
        `)
        .run(invalidatedAt, principalId).changes
    );
  }

  replaceRecoveryCodes(
    principalId: string,
    codes: CreateOperatorRecoveryCodeInput[]
  ): void {
    this.transaction(() => {
      this.sqlite
        .prepare("DELETE FROM operator_recovery_codes WHERE principal_id = ?")
        .run(principalId);
      const insert = this.sqlite.prepare(`
        INSERT INTO operator_recovery_codes (
          id, principal_id, code_hash, created_at, used_at
        ) VALUES (?, ?, ?, ?, NULL)
      `);
      for (const code of codes) {
        if (code.principalId !== principalId) {
          throw new Error("Operator recovery code principal mismatch");
        }
        insert.run(code.id, code.principalId, code.codeHash, code.createdAt);
      }
    });
  }

  consumeRecoveryCode(principalId: string, codeHash: string, usedAt: string): boolean {
    return (
      this.sqlite
        .prepare(`
          UPDATE operator_recovery_codes
          SET used_at = ?
          WHERE principal_id = ? AND code_hash = ? AND used_at IS NULL
        `)
        .run(usedAt, principalId, codeHash).changes === 1
    );
  }

  countAvailableRecoveryCodes(principalId: string): number {
    const row = this.sqlite
      .prepare(`
        SELECT COUNT(*) AS count
        FROM operator_recovery_codes
        WHERE principal_id = ? AND used_at IS NULL
      `)
      .get(principalId) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  }

  clearMfaForPrincipal(principalId: string, clearedAt: string): void {
    this.transaction(() => {
      this.sqlite
        .prepare("DELETE FROM operator_recovery_codes WHERE principal_id = ?")
        .run(principalId);
      this.sqlite
        .prepare(`
          UPDATE operator_mfa_login_challenges
          SET consumed_at = ?
          WHERE principal_id = ? AND consumed_at IS NULL
        `)
        .run(clearedAt, principalId);
      this.sqlite
        .prepare("DELETE FROM operator_mfa_state WHERE principal_id = ?")
        .run(principalId);
    });
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
    let currentVersion = this.schemaVersion();
    if (currentVersion > OPERATOR_SCHEMA_VERSION) {
      throw new Error(
        `Operator auth database schema v${currentVersion} is newer than supported v${OPERATOR_SCHEMA_VERSION}`
      );
    }
    if (currentVersion === OPERATOR_SCHEMA_VERSION) return;
    if (currentVersion === 1) {
      this.transaction(() => {
        this.sqlite.exec(`
          CREATE TABLE operator_local_login_grants (
            id TEXT PRIMARY KEY,
            principal_id TEXT NOT NULL,
            secret_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
          );

          CREATE INDEX operator_local_login_grants_expiry_idx
            ON operator_local_login_grants(expires_at, consumed_at);

          PRAGMA user_version = 2;
        `);
      });
      currentVersion = 2;
    }
    if (currentVersion === 2) {
      this.transaction(() => {
        this.sqlite.exec(`
          CREATE TABLE operator_passkeys (
            id TEXT PRIMARY KEY,
            principal_id TEXT NOT NULL,
            credential_id TEXT NOT NULL UNIQUE,
            public_key BLOB NOT NULL,
            counter INTEGER NOT NULL CHECK(counter >= 0),
            transports_json TEXT NOT NULL,
            device_type TEXT NOT NULL,
            backed_up INTEGER NOT NULL CHECK(backed_up IN (0, 1)),
            label TEXT NOT NULL,
            rp_id TEXT NOT NULL,
            origin TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT,
            FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
          );

          CREATE INDEX operator_passkeys_principal_rp_idx
            ON operator_passkeys(principal_id, rp_id, created_at);

          CREATE TABLE operator_webauthn_challenges (
            id TEXT PRIMARY KEY,
            principal_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('registration', 'authentication')),
            challenge TEXT NOT NULL UNIQUE,
            rp_id TEXT NOT NULL,
            origin TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
          );

          CREATE INDEX operator_webauthn_challenges_expiry_idx
            ON operator_webauthn_challenges(expires_at, consumed_at);

          PRAGMA user_version = 3;
        `);
      });
      currentVersion = 3;
    }
    if (currentVersion === 3) {
      this.transaction(() => {
        this.sqlite.exec(`
          CREATE TABLE operator_mfa_state (
            principal_id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
            last_accepted_totp_step INTEGER,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
          );

          CREATE TABLE operator_mfa_login_challenges (
            id TEXT PRIMARY KEY,
            principal_id TEXT NOT NULL,
            challenge_hash TEXT NOT NULL UNIQUE,
            source_hash TEXT NOT NULL,
            user_agent_hash TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            failed_count INTEGER NOT NULL CHECK(failed_count >= 0),
            consumed_at TEXT,
            FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
          );

          CREATE INDEX operator_mfa_login_challenges_expiry_idx
            ON operator_mfa_login_challenges(expires_at, consumed_at);

          CREATE TABLE operator_recovery_codes (
            id TEXT PRIMARY KEY,
            principal_id TEXT NOT NULL,
            code_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            used_at TEXT,
            FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
          );

          CREATE INDEX operator_recovery_codes_principal_idx
            ON operator_recovery_codes(principal_id, used_at, created_at);

          PRAGMA user_version = 4;
        `);
      });
      currentVersion = 4;
    }
    if (currentVersion === 4) {
      this.transaction(() => {
        this.sqlite.exec(`
          CREATE TABLE operator_login_gates (
            id TEXT PRIMARY KEY,
            principal_id TEXT NOT NULL,
            secret_hash TEXT NOT NULL UNIQUE,
            purpose TEXT NOT NULL CHECK(purpose IN ('secure-entry')),
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
          );

          CREATE INDEX operator_login_gates_expiry_idx
            ON operator_login_gates(expires_at, consumed_at);

          PRAGMA user_version = ${OPERATOR_SCHEMA_VERSION};
        `);
      });
      currentVersion = OPERATOR_SCHEMA_VERSION;
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

        CREATE TABLE operator_local_login_grants (
          id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          secret_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_local_login_grants_expiry_idx
          ON operator_local_login_grants(expires_at, consumed_at);

        CREATE TABLE operator_login_gates (
          id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          secret_hash TEXT NOT NULL UNIQUE,
          purpose TEXT NOT NULL CHECK(purpose IN ('secure-entry')),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_login_gates_expiry_idx
          ON operator_login_gates(expires_at, consumed_at);

        CREATE TABLE operator_passkeys (
          id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          credential_id TEXT NOT NULL UNIQUE,
          public_key BLOB NOT NULL,
          counter INTEGER NOT NULL CHECK(counter >= 0),
          transports_json TEXT NOT NULL,
          device_type TEXT NOT NULL,
          backed_up INTEGER NOT NULL CHECK(backed_up IN (0, 1)),
          label TEXT NOT NULL,
          rp_id TEXT NOT NULL,
          origin TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_used_at TEXT,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_passkeys_principal_rp_idx
          ON operator_passkeys(principal_id, rp_id, created_at);

        CREATE TABLE operator_webauthn_challenges (
          id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('registration', 'authentication')),
          challenge TEXT NOT NULL UNIQUE,
          rp_id TEXT NOT NULL,
          origin TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_webauthn_challenges_expiry_idx
          ON operator_webauthn_challenges(expires_at, consumed_at);

        CREATE TABLE operator_mfa_state (
          principal_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
          last_accepted_totp_step INTEGER,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE TABLE operator_mfa_login_challenges (
          id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          challenge_hash TEXT NOT NULL UNIQUE,
          source_hash TEXT NOT NULL,
          user_agent_hash TEXT,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          failed_count INTEGER NOT NULL CHECK(failed_count >= 0),
          consumed_at TEXT,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_mfa_login_challenges_expiry_idx
          ON operator_mfa_login_challenges(expires_at, consumed_at);

        CREATE TABLE operator_recovery_codes (
          id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          code_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          used_at TEXT,
          FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
        );

        CREATE INDEX operator_recovery_codes_principal_idx
          ON operator_recovery_codes(principal_id, used_at, created_at);

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
