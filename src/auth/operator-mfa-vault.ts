import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const OPERATOR_MFA_VAULT_SCHEMA_VERSION = 1 as const;

export interface OperatorTotpVaultSecret {
  principalId: string;
  secretBase32: string;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorTotpPendingEnrollment {
  id: string;
  principalId: string;
  secretBase32: string;
  createdAt: string;
  expiresAt: string;
}

export interface OperatorMfaVaultRecord {
  schemaVersion: typeof OPERATOR_MFA_VAULT_SCHEMA_VERSION;
  activeTotp: OperatorTotpVaultSecret | null;
  pendingTotp: OperatorTotpPendingEnrollment | null;
  createdAt: string;
  updatedAt: string;
}

export function operatorMfaVaultPath(runtimeDir: string): string {
  return path.join(runtimeDir, "operator-mfa.json");
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validPrincipalId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160;
}

function validTotpSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z2-7]{32}$/.test(value);
}

function normalizeActiveTotp(value: unknown): OperatorTotpVaultSecret | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Operator MFA active TOTP record is invalid");
  }
  const raw = value as Record<string, unknown>;
  if (
    !validPrincipalId(raw.principalId) ||
    !validTotpSecret(raw.secretBase32) ||
    !validDate(raw.createdAt) ||
    !validDate(raw.updatedAt)
  ) {
    throw new Error("Operator MFA active TOTP record is invalid");
  }
  return {
    principalId: raw.principalId,
    secretBase32: raw.secretBase32,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

function normalizePendingTotp(value: unknown): OperatorTotpPendingEnrollment | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Operator MFA pending TOTP record is invalid");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    raw.id.length < 1 ||
    raw.id.length > 160 ||
    !validPrincipalId(raw.principalId) ||
    !validTotpSecret(raw.secretBase32) ||
    !validDate(raw.createdAt) ||
    !validDate(raw.expiresAt)
  ) {
    throw new Error("Operator MFA pending TOTP record is invalid");
  }
  return {
    id: raw.id,
    principalId: raw.principalId,
    secretBase32: raw.secretBase32,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt
  };
}

function normalizeVaultRecord(value: unknown): OperatorMfaVaultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Operator MFA vault must be a JSON object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== OPERATOR_MFA_VAULT_SCHEMA_VERSION) {
    throw new Error(`Unsupported Operator MFA vault schema: ${String(raw.schemaVersion)}`);
  }
  if (!validDate(raw.createdAt) || !validDate(raw.updatedAt)) {
    throw new Error("Operator MFA vault timestamps are invalid");
  }
  return {
    schemaVersion: OPERATOR_MFA_VAULT_SCHEMA_VERSION,
    activeTotp: normalizeActiveTotp(raw.activeTotp),
    pendingTotp: normalizePendingTotp(raw.pendingTotp),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

export function readOperatorMfaVault(runtimeDir: string): OperatorMfaVaultRecord | null {
  const filePath = operatorMfaVaultPath(runtimeDir);
  if (!fs.existsSync(filePath)) return null;
  const mode = fs.statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("Operator MFA vault permissions are too broad");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Operator MFA vault is not valid JSON");
  }
  return normalizeVaultRecord(parsed);
}

function atomicOwnerWrite(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function writeOperatorMfaVault(
  runtimeDir: string,
  input: {
    activeTotp: OperatorTotpVaultSecret | null;
    pendingTotp: OperatorTotpPendingEnrollment | null;
    now?: string;
  }
): OperatorMfaVaultRecord {
  const previous = readOperatorMfaVault(runtimeDir);
  const now = input.now ?? new Date().toISOString();
  const next = normalizeVaultRecord({
    schemaVersion: OPERATOR_MFA_VAULT_SCHEMA_VERSION,
    activeTotp: input.activeTotp,
    pendingTotp: input.pendingTotp,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  });
  atomicOwnerWrite(operatorMfaVaultPath(runtimeDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function clearOperatorMfaVault(runtimeDir: string): void {
  fs.rmSync(operatorMfaVaultPath(runtimeDir), { force: true });
}
