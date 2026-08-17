import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

import {
  clearOperatorMfaVault,
  readOperatorMfaVault,
  writeOperatorMfaVault
} from "./operator-mfa-vault.js";
import { OperatorAuthError } from "./operator-service.js";
import {
  OperatorStore,
  hashOperatorMfaLoginSecret,
  hashOperatorRecoveryCode
} from "./operator-store.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW_STEPS = 1;
const TOTP_SECRET_BYTES = 20;
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;
const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const LOGIN_CHALLENGE_MAX_FAILURES = 5;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 10;

export interface OperatorTotpStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
  pendingEnrollment: boolean;
}

export interface OperatorTotpEnrollment {
  enrollmentId: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}

export interface OperatorTotpLoginChallenge {
  challenge: string;
  expiresAt: string;
}

export interface OperatorTotpServiceOptions {
  store: OperatorStore;
  runtimeDir: string;
  now?: () => Date;
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function digestMetadata(value: string): string {
  return createHash("sha256").update(value || "unknown", "utf8").digest("hex");
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(value: string): Uint8Array {
  const normalized = value.trim().replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid Base32 value");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

export function generateTotpCode(
  secretBase32: string,
  timestampMs: number,
  options: { digits?: number; periodSeconds?: number } = {}
): string {
  const digits = options.digits ?? TOTP_DIGITS;
  const periodSeconds = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const counter = Math.floor(timestampMs / 1000 / periodSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(decodeBase32(secretBase32)))
    .update(message)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  const modulus = 10 ** digits;
  return String(binary % modulus).padStart(digits, "0");
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  timestampMs: number,
  windowSteps = TOTP_WINDOW_STEPS
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS);
  const candidate = Buffer.from(code, "utf8");
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) continue;
    const expected = Buffer.from(
      generateTotpCode(secretBase32, step * TOTP_PERIOD_SECONDS * 1000),
      "utf8"
    );
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      return step;
    }
  }
  return null;
}

function normalizeRecoveryCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{16}$/.test(normalized) ? normalized : null;
}

function generateRecoveryCode(): string {
  const compact = encodeBase32(randomBytes(RECOVERY_CODE_BYTES));
  return compact.match(/.{1,4}/g)!.join("-");
}

function hashRecoveryCode(value: string): string {
  const normalized = normalizeRecoveryCode(value);
  if (!normalized) return "";
  return hashOperatorRecoveryCode(normalized);
}

export class OperatorTotpService {
  readonly store: OperatorStore;
  readonly runtimeDir: string;
  private readonly now: () => Date;

  constructor(options: OperatorTotpServiceOptions) {
    this.store = options.store;
    this.runtimeDir = options.runtimeDir;
    this.now = options.now ?? (() => new Date());
  }

  status(principalId: string): OperatorTotpStatus {
    const state = this.store.getMfaState(principalId);
    let pendingEnrollment = false;
    try {
      const vault = readOperatorMfaVault(this.runtimeDir);
      pendingEnrollment = Boolean(
        vault?.pendingTotp &&
          vault.pendingTotp.principalId === principalId &&
          vault.pendingTotp.expiresAt > this.now().toISOString()
      );
    } catch {
      pendingEnrollment = false;
    }
    return {
      enabled: state?.enabled === true,
      recoveryCodesRemaining:
        state?.enabled === true ? this.store.countAvailableRecoveryCodes(principalId) : 0,
      pendingEnrollment
    };
  }

  requiresSecondFactor(principalId: string): boolean {
    return this.store.getMfaState(principalId)?.enabled === true;
  }

  private requireOwner(principalId: string): { id: string; username: string } {
    const owner = this.store.getOwner();
    if (!owner || owner.id !== principalId) {
      throw new OperatorAuthError(
        "OPERATOR_SESSION_INVALID",
        "Console administrator session is no longer valid",
        401
      );
    }
    return owner;
  }

  private activeSecret(principalId: string): string {
    if (!this.requiresSecondFactor(principalId)) {
      throw new OperatorAuthError("TOTP_NOT_ENABLED", "Two-factor authentication is not enabled", 409);
    }
    const vault = readOperatorMfaVault(this.runtimeDir);
    const active = vault?.activeTotp;
    if (!active || active.principalId !== principalId) {
      throw new OperatorAuthError(
        "TOTP_CONFIGURATION_INVALID",
        "Two-factor authentication is enabled but its machine-local secret is unavailable",
        503
      );
    }
    return active.secretBase32;
  }

  startEnrollment(principalId: string): OperatorTotpEnrollment {
    const owner = this.requireOwner(principalId);
    const now = this.now();
    const nowIso = now.toISOString();
    const expiresAt = toIso(now.getTime() + ENROLLMENT_TTL_MS);
    const secret = encodeBase32(randomBytes(TOTP_SECRET_BYTES));
    const enrollmentId = randomUUID();
    const previous = readOperatorMfaVault(this.runtimeDir);
    writeOperatorMfaVault(this.runtimeDir, {
      activeTotp: previous?.activeTotp ?? null,
      pendingTotp: {
        id: enrollmentId,
        principalId,
        secretBase32: secret,
        createdAt: nowIso,
        expiresAt
      },
      now: nowIso
    });
    this.store.recordAuditEvent({
      eventType: "operator.mfa.enrollment.started",
      principalId,
      createdAt: nowIso,
      details: { expiresAt }
    });
    const label = `ChatCockpit:${owner.username}`;
    const otpauthUri =
      `otpauth://totp/${encodeURIComponent(label)}` +
      `?secret=${encodeURIComponent(secret)}` +
      `&issuer=${encodeURIComponent("ChatCockpit")}` +
      "&algorithm=SHA1&digits=6&period=30";
    return { enrollmentId, secret, otpauthUri, expiresAt };
  }

  confirmEnrollment(input: {
    principalId: string;
    enrollmentId: string;
    code: string;
  }): { recoveryCodes: string[]; recoveryCodesRemaining: number } {
    this.requireOwner(input.principalId);
    const now = this.now();
    const nowIso = now.toISOString();
    const vault = readOperatorMfaVault(this.runtimeDir);
    const pending = vault?.pendingTotp;
    if (
      !pending ||
      pending.id !== input.enrollmentId ||
      pending.principalId !== input.principalId ||
      pending.expiresAt <= nowIso
    ) {
      throw new OperatorAuthError(
        "TOTP_ENROLLMENT_INVALID",
        "TOTP enrollment is invalid or expired",
        400
      );
    }
    if (verifyTotpCode(pending.secretBase32, input.code.trim(), now.getTime()) === null) {
      throw new OperatorAuthError("TOTP_CODE_INVALID", "Verification code is invalid", 400);
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    this.store.transaction(() => {
      this.store.setMfaEnabled(input.principalId, true, nowIso);
      this.store.replaceRecoveryCodes(
        input.principalId,
        recoveryCodes.map((code) => ({
          id: randomUUID(),
          principalId: input.principalId,
          codeHash: hashRecoveryCode(code),
          createdAt: nowIso
        }))
      );
      this.store.invalidateMfaLoginChallenges(input.principalId, nowIso);
    });
    writeOperatorMfaVault(this.runtimeDir, {
      activeTotp: {
        principalId: input.principalId,
        secretBase32: pending.secretBase32,
        createdAt: vault?.activeTotp?.createdAt ?? nowIso,
        updatedAt: nowIso
      },
      pendingTotp: null,
      now: nowIso
    });
    this.store.recordAuditEvent({
      eventType: "operator.mfa.enabled",
      principalId: input.principalId,
      createdAt: nowIso,
      details: { backupCount: recoveryCodes.length }
    });
    return {
      recoveryCodes,
      recoveryCodesRemaining: recoveryCodes.length
    };
  }

  beginLoginChallenge(input: {
    principalId: string;
    source: string;
    userAgent?: string;
  }): OperatorTotpLoginChallenge {
    this.requireOwner(input.principalId);
    this.activeSecret(input.principalId);
    const now = this.now();
    const nowIso = now.toISOString();
    const expiresAt = toIso(now.getTime() + LOGIN_CHALLENGE_TTL_MS);
    const challenge = `cc_mfa_${randomBytes(32).toString("base64url")}`;
    this.store.createMfaLoginChallenge({
      id: randomUUID(),
      principalId: input.principalId,
      challengeHash: hashOperatorMfaLoginSecret(challenge),
      sourceHash: digestMetadata(input.source),
      userAgentHash: input.userAgent ? digestMetadata(input.userAgent) : null,
      createdAt: nowIso,
      expiresAt
    });
    this.store.recordAuditEvent({
      eventType: "operator.mfa.login.challenge_created",
      principalId: input.principalId,
      sourceHash: digestMetadata(input.source),
      userAgentHash: input.userAgent ? digestMetadata(input.userAgent) : null,
      createdAt: nowIso,
      details: { expiresAt }
    });
    return { challenge, expiresAt };
  }

  private verifyFactor(principalId: string, value: string): "totp" | "recovery" {
    const now = this.now();
    const nowIso = now.toISOString();
    const totpStep = verifyTotpCode(this.activeSecret(principalId), value.trim(), now.getTime());
    if (totpStep !== null) {
      if (!this.store.acceptTotpStep(principalId, totpStep, nowIso)) {
        throw new OperatorAuthError(
          "TOTP_CODE_REPLAYED",
          "This verification code has already been used",
          400
        );
      }
      return "totp";
    }

    const recoveryHash = hashRecoveryCode(value);
    if (recoveryHash && this.store.consumeRecoveryCode(principalId, recoveryHash, nowIso)) {
      return "recovery";
    }
    throw new OperatorAuthError("SECOND_FACTOR_INVALID", "Verification code is invalid", 401);
  }

  activeLoginChallengePrincipal(challenge: string): string | null {
    const record = this.store.findActiveMfaLoginChallengeByHash(
      hashOperatorMfaLoginSecret(challenge),
      this.now().toISOString()
    );
    return record?.principalId ?? null;
  }

  verifyLoginChallenge(input: {
    challenge: string;
    verification: string;
    source: string;
    userAgent?: string;
  }): { principalId: string; factor: "totp" | "recovery" } {
    const nowIso = this.now().toISOString();
    const record = this.store.findActiveMfaLoginChallengeByHash(
      hashOperatorMfaLoginSecret(input.challenge),
      nowIso
    );
    if (!record) {
      throw new OperatorAuthError(
        "MFA_CHALLENGE_INVALID",
        "Second-factor challenge is invalid or expired",
        401
      );
    }
    const sourceHash = digestMetadata(input.source);
    const userAgentHash = input.userAgent ? digestMetadata(input.userAgent) : null;
    if (record.sourceHash !== sourceHash || record.userAgentHash !== userAgentHash) {
      this.store.consumeMfaLoginChallenge(record.id, nowIso);
      throw new OperatorAuthError(
        "MFA_CHALLENGE_CONTEXT_CHANGED",
        "Second-factor challenge cannot be used from a different client context",
        401
      );
    }

    let factor: "totp" | "recovery";
    try {
      factor = this.verifyFactor(record.principalId, input.verification);
    } catch (error) {
      const failed = this.store.recordMfaLoginChallengeFailure(
        record.id,
        nowIso,
        LOGIN_CHALLENGE_MAX_FAILURES
      );
      this.store.recordAuditEvent({
        eventType: "operator.mfa.login.failed",
        principalId: record.principalId,
        sourceHash,
        userAgentHash,
        createdAt: nowIso,
        details: {
          failedCount: failed?.failedCount ?? record.failedCount + 1,
          blocked: failed?.consumedAt !== null
        }
      });
      throw error;
    }

    if (!this.store.consumeMfaLoginChallenge(record.id, nowIso)) {
      throw new OperatorAuthError(
        "MFA_CHALLENGE_INVALID",
        "Second-factor challenge has already been used",
        401
      );
    }
    this.store.recordAuditEvent({
      eventType: "operator.mfa.login.verified",
      principalId: record.principalId,
      sourceHash,
      userAgentHash,
      createdAt: nowIso,
      details: { factor }
    });
    return { principalId: record.principalId, factor };
  }

  regenerateRecoveryCodes(input: {
    principalId: string;
    verification: string;
  }): { recoveryCodes: string[] } {
    this.requireOwner(input.principalId);
    const factor = this.verifyFactor(input.principalId, input.verification);
    const nowIso = this.now().toISOString();
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    this.store.replaceRecoveryCodes(
      input.principalId,
      recoveryCodes.map((code) => ({
        id: randomUUID(),
        principalId: input.principalId,
        codeHash: hashRecoveryCode(code),
        createdAt: nowIso
      }))
    );
    this.store.invalidateMfaLoginChallenges(input.principalId, nowIso);
    this.store.recordAuditEvent({
      eventType: "operator.mfa.backups.regenerated",
      principalId: input.principalId,
      createdAt: nowIso,
      details: { factor, backupCount: recoveryCodes.length }
    });
    return { recoveryCodes };
  }

  disable(input: { principalId: string; verification: string }): void {
    this.requireOwner(input.principalId);
    const factor = this.verifyFactor(input.principalId, input.verification);
    const nowIso = this.now().toISOString();
    this.store.clearMfaForPrincipal(input.principalId, nowIso);
    clearOperatorMfaVault(this.runtimeDir);
    this.store.recordAuditEvent({
      eventType: "operator.mfa.disabled",
      principalId: input.principalId,
      createdAt: nowIso,
      details: { factor }
    });
  }
}
