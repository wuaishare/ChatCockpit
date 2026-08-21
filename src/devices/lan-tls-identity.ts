import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import selfsigned from "selfsigned";

import type { HubIdentityRecord } from "./hub-identity.js";

export const LAN_TLS_IDENTITY_SCHEMA_VERSION = 1 as const;
export const LAN_TLS_KEY_ALGORITHM = "P-256" as const;
const LAN_TLS_IDENTITY_FILE = "lan-tls-identity.json";
const LAN_TLS_PROOF_DOMAIN = "chatcockpit-hub-lan-tls-proof-v1";
const LAN_TLS_VALIDITY_DAYS = 365 * 5;

export interface LanTlsIdentityRecord {
  schemaVersion: typeof LAN_TLS_IDENTITY_SCHEMA_VERSION;
  algorithm: typeof LAN_TLS_KEY_ALGORITHM;
  privateKeyPem: string;
  certificatePem: string;
  certificateFingerprint: string;
  createdAt: string;
  notAfter: string;
}

export interface LanTlsIdentityProjection {
  schemaVersion: typeof LAN_TLS_IDENTITY_SCHEMA_VERSION;
  algorithm: typeof LAN_TLS_KEY_ALGORITHM;
  certificateFingerprint: string;
  createdAt: string;
  notAfter: string;
}

const RECORD_KEYS = [
  "algorithm",
  "certificateFingerprint",
  "certificatePem",
  "createdAt",
  "notAfter",
  "privateKeyPem",
  "schemaVersion"
].sort();

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizePrivateKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 100 || value.length > 8_192) {
    throw new Error("LAN TLS private key is invalid");
  }
  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey(value);
  } catch {
    throw new Error("LAN TLS private key is invalid");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("LAN TLS private key must use P-256");
  }
  return value;
}

function normalizeCertificate(value: unknown): crypto.X509Certificate {
  if (typeof value !== "string" || value.length < 200 || value.length > 32_768) {
    throw new Error("LAN TLS certificate is invalid");
  }
  let certificate: crypto.X509Certificate;
  try {
    certificate = new crypto.X509Certificate(value);
  } catch {
    throw new Error("LAN TLS certificate is invalid");
  }
  if (
    certificate.publicKey.asymmetricKeyType !== "ec" ||
    certificate.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error("LAN TLS certificate must use P-256");
  }
  if (!certificate.verify(certificate.publicKey)) {
    throw new Error("LAN TLS certificate must be self-signed");
  }
  return certificate;
}

function certificateFingerprint(certificate: crypto.X509Certificate): string {
  return crypto.createHash("sha256").update(certificate.raw).digest("base64url");
}

function normalizeRecord(input: unknown): LanTlsIdentityRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("LAN TLS identity must be a JSON object");
  }
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).sort().join("\n") !== RECORD_KEYS.join("\n")) {
    throw new Error("LAN TLS identity contains unsupported fields");
  }
  if (raw.schemaVersion !== LAN_TLS_IDENTITY_SCHEMA_VERSION) {
    throw new Error(`Unsupported LAN TLS identity schema: ${String(raw.schemaVersion)}`);
  }
  if (raw.algorithm !== LAN_TLS_KEY_ALGORITHM) {
    throw new Error("LAN TLS identity algorithm is unsupported");
  }
  if (!validTimestamp(raw.createdAt) || !validTimestamp(raw.notAfter)) {
    throw new Error("LAN TLS identity timestamps are invalid");
  }
  if (Date.parse(raw.notAfter) <= Date.parse(raw.createdAt)) {
    throw new Error("LAN TLS identity validity window is invalid");
  }
  const privateKeyPem = normalizePrivateKey(raw.privateKeyPem);
  const certificate = normalizeCertificate(raw.certificatePem);
  const privatePublicDer = crypto.createPublicKey(privateKeyPem).export({
    format: "der",
    type: "spki"
  }) as Buffer;
  const certificatePublicDer = certificate.publicKey.export({
    format: "der",
    type: "spki"
  }) as Buffer;
  if (!crypto.timingSafeEqual(privatePublicDer, certificatePublicDer)) {
    throw new Error("LAN TLS certificate does not match its private key");
  }
  const fingerprint = certificateFingerprint(certificate);
  if (
    typeof raw.certificateFingerprint !== "string" ||
    raw.certificateFingerprint !== fingerprint
  ) {
    throw new Error("LAN TLS certificate fingerprint is invalid");
  }
  if (typeof raw.certificatePem !== "string") {
    throw new Error("LAN TLS certificate is invalid");
  }
  const certificateNotAfter = new Date(certificate.validTo).toISOString();
  if (certificateNotAfter !== raw.notAfter) {
    throw new Error("LAN TLS certificate expiry does not match persisted metadata");
  }
  return {
    schemaVersion: LAN_TLS_IDENTITY_SCHEMA_VERSION,
    algorithm: LAN_TLS_KEY_ALGORITHM,
    privateKeyPem,
    certificatePem: raw.certificatePem,
    certificateFingerprint: fingerprint,
    createdAt: raw.createdAt,
    notAfter: raw.notAfter
  };
}

function atomicPrivateWrite(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // POSIX permissions are best-effort on non-POSIX filesystems.
  }
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(temporaryPath, 0o600);
    } catch {
      // Best-effort on non-POSIX filesystems.
    }
    fs.renameSync(temporaryPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best-effort on non-POSIX filesystems.
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function lanTlsIdentityPath(runtimeDir: string): string {
  return path.join(runtimeDir, LAN_TLS_IDENTITY_FILE);
}

export function readLanTlsIdentity(runtimeDir: string): LanTlsIdentityRecord | null {
  const filePath = lanTlsIdentityPath(runtimeDir);
  if (!fs.existsSync(filePath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("LAN TLS identity is not valid JSON");
  }
  return normalizeRecord(parsed);
}

export async function createLanTlsIdentity(
  runtimeDir: string,
  now = new Date().toISOString()
): Promise<LanTlsIdentityRecord> {
  if (readLanTlsIdentity(runtimeDir)) {
    throw new Error("LAN TLS identity already exists");
  }
  if (!validTimestamp(now)) throw new Error("LAN TLS identity creation timestamp is invalid");
  const createdAt = new Date(now);
  const notBefore = new Date(createdAt.getTime() - 60_000);
  const requestedNotAfter = new Date(createdAt.getTime() + LAN_TLS_VALIDITY_DAYS * 24 * 60 * 60 * 1_000);
  const generated = await selfsigned.generate(
    [{ name: "commonName", value: "ChatCockpit LAN" }],
    {
      keyType: "ec",
      curve: "P-256",
      algorithm: "sha256",
      notBeforeDate: notBefore,
      notAfterDate: requestedNotAfter,
      extensions: [
        { name: "basicConstraints", cA: false, critical: true },
        { name: "keyUsage", digitalSignature: true, keyAgreement: true, critical: true },
        { name: "extKeyUsage", serverAuth: true },
        {
          name: "subjectAltName",
          altNames: [{ type: 2, value: "chatcockpit.local" }]
        }
      ]
    }
  );
  const certificate = normalizeCertificate(generated.cert);
  const record: LanTlsIdentityRecord = {
    schemaVersion: LAN_TLS_IDENTITY_SCHEMA_VERSION,
    algorithm: LAN_TLS_KEY_ALGORITHM,
    privateKeyPem: generated.private,
    certificatePem: generated.cert,
    certificateFingerprint: certificateFingerprint(certificate),
    createdAt: createdAt.toISOString(),
    notAfter: new Date(certificate.validTo).toISOString()
  };
  const normalized = normalizeRecord(record);
  atomicPrivateWrite(lanTlsIdentityPath(runtimeDir), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function ensureLanTlsIdentity(
  runtimeDir: string,
  now?: string
): Promise<LanTlsIdentityRecord> {
  return readLanTlsIdentity(runtimeDir) ?? createLanTlsIdentity(runtimeDir, now);
}

export function projectLanTlsIdentity(record: LanTlsIdentityRecord): LanTlsIdentityProjection {
  const normalized = normalizeRecord(record);
  return {
    schemaVersion: normalized.schemaVersion,
    algorithm: normalized.algorithm,
    certificateFingerprint: normalized.certificateFingerprint,
    createdAt: normalized.createdAt,
    notAfter: normalized.notAfter
  };
}

function normalizeProofNonce(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) {
    throw new Error("LAN TLS proof nonce is invalid");
  }
  return normalized;
}

function normalizeCertificateFingerprint(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw new Error("LAN TLS certificate fingerprint is invalid");
  }
  return normalized;
}

export function buildLanTlsCertificateProof(
  nonce: string,
  certificateFingerprintValue: string
): Buffer {
  return Buffer.from(
    [
      LAN_TLS_PROOF_DOMAIN,
      normalizeProofNonce(nonce),
      normalizeCertificateFingerprint(certificateFingerprintValue)
    ].join("\n"),
    "utf8"
  );
}

export function signLanTlsCertificateProof(
  hubIdentity: HubIdentityRecord,
  nonce: string,
  certificateFingerprintValue: string
): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(hubIdentity.privateKeyPkcs8, "base64url"),
    format: "der",
    type: "pkcs8"
  });
  return crypto.sign(
    null,
    buildLanTlsCertificateProof(nonce, certificateFingerprintValue),
    privateKey
  ).toString("base64url");
}

export function verifyLanTlsCertificateProof(
  hubPublicKeySpki: string,
  nonce: string,
  certificateFingerprintValue: string,
  signature: string
): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(hubPublicKeySpki, "base64url"),
      format: "der",
      type: "spki"
    });
    return crypto.verify(
      null,
      buildLanTlsCertificateProof(nonce, certificateFingerprintValue),
      publicKey,
      Buffer.from(signature, "base64url")
    );
  } catch {
    return false;
  }
}
