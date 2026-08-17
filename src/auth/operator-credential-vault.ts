import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { TokenPilotPaths } from "../types.js";

export const OPERATOR_CREDENTIAL_VAULT_SCHEMA_VERSION = 1 as const;

export interface OperatorCredentialVaultRecord {
  schemaVersion: typeof OPERATOR_CREDENTIAL_VAULT_SCHEMA_VERSION;
  username: string;
  password: string;
  ownerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function operatorCredentialVaultPath(paths: Pick<TokenPilotPaths, "runtimeDir">): string {
  return path.join(paths.runtimeDir, "operator-credentials.json");
}

export function generateOperatorUsername(): string {
  return `cc_owner_${crypto.randomBytes(6).toString("hex")}`;
}

export function generateOperatorPassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function normalizeVaultRecord(input: unknown): OperatorCredentialVaultRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Operator credential vault must be a JSON object");
  }
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion !== OPERATOR_CREDENTIAL_VAULT_SCHEMA_VERSION) {
    throw new Error(`Unsupported operator credential vault schema: ${String(raw.schemaVersion)}`);
  }
  if (typeof raw.username !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw.username)) {
    throw new Error("Operator credential vault username is invalid");
  }
  if (typeof raw.password !== "string" || raw.password.length < 12 || raw.password.length > 1024) {
    throw new Error("Operator credential vault password is invalid");
  }
  if (
    raw.ownerUpdatedAt !== null &&
    (typeof raw.ownerUpdatedAt !== "string" || Number.isNaN(Date.parse(raw.ownerUpdatedAt)))
  ) {
    throw new Error("Operator credential vault ownerUpdatedAt is invalid");
  }
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) {
    throw new Error("Operator credential vault createdAt is invalid");
  }
  if (typeof raw.updatedAt !== "string" || Number.isNaN(Date.parse(raw.updatedAt))) {
    throw new Error("Operator credential vault updatedAt is invalid");
  }
  return {
    schemaVersion: OPERATOR_CREDENTIAL_VAULT_SCHEMA_VERSION,
    username: raw.username,
    password: raw.password,
    ownerUpdatedAt: raw.ownerUpdatedAt as string | null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

export function readOperatorCredentialVault(
  paths: Pick<TokenPilotPaths, "runtimeDir">
): OperatorCredentialVaultRecord | null {
  const filePath = operatorCredentialVaultPath(paths);
  if (!fs.existsSync(filePath)) return null;
  const mode = fs.statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("Operator credential vault permissions are too broad");
  }
  const source = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Operator credential vault is not valid JSON");
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

export function writeOperatorCredentialVault(
  paths: Pick<TokenPilotPaths, "runtimeDir">,
  input: {
    username: string;
    password: string;
    ownerUpdatedAt: string | null;
    now?: string;
  }
): OperatorCredentialVaultRecord {
  const previous = readOperatorCredentialVault(paths);
  const now = input.now ?? new Date().toISOString();
  const next = normalizeVaultRecord({
    schemaVersion: OPERATOR_CREDENTIAL_VAULT_SCHEMA_VERSION,
    username: input.username.trim().toLowerCase(),
    password: input.password,
    ownerUpdatedAt: input.ownerUpdatedAt,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  });
  atomicOwnerWrite(operatorCredentialVaultPath(paths), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function operatorCredentialVaultMatchesOwner(
  paths: Pick<TokenPilotPaths, "runtimeDir">,
  owner: { username: string; updatedAt: string } | null | undefined
): boolean {
  if (!owner) return false;
  try {
    const credential = readOperatorCredentialVault(paths);
    return (
      credential?.username === owner.username &&
      credential.ownerUpdatedAt === owner.updatedAt
    );
  } catch {
    return false;
  }
}
