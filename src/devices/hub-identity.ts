import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HUB_IDENTITY_SCHEMA_VERSION = 1 as const;
export const HUB_IDENTITY_ALGORITHM = "Ed25519" as const;
const HUB_IDENTITY_FILE = "hub-identity.json";
const HUB_IDENTITY_PROOF_DOMAIN = "chatcockpit-hub-identity-proof-v1";

export interface HubIdentityRecord {
  schemaVersion: typeof HUB_IDENTITY_SCHEMA_VERSION;
  hubId: string;
  algorithm: typeof HUB_IDENTITY_ALGORITHM;
  publicKeySpki: string;
  privateKeyPkcs8: string;
  publicKeyFingerprint: string;
  createdAt: string;
}

export interface HubIdentityProjection {
  schemaVersion: typeof HUB_IDENTITY_SCHEMA_VERSION;
  hubId: string;
  algorithm: typeof HUB_IDENTITY_ALGORITHM;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  createdAt: string;
}

const RECORD_KEYS = [
  "algorithm",
  "createdAt",
  "hubId",
  "privateKeyPkcs8",
  "publicKeyFingerprint",
  "publicKeySpki",
  "schemaVersion"
].sort();

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function decodeBase64Url(value: unknown, label: string, min: number, max: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Hub identity ${label} is invalid`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < min || decoded.length > max) {
    throw new Error(`Hub identity ${label} is invalid`);
  }
  return decoded;
}

function normalizeNonce(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) {
    throw new Error("Hub identity proof nonce is invalid");
  }
  return normalized;
}

function parsePublicKey(encoded: string): crypto.KeyObject {
  const der = decodeBase64Url(encoded, "public key", 32, 128);
  try {
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("unexpected key type");
    return key;
  } catch {
    throw new Error("Hub identity public key must be an Ed25519 SPKI key");
  }
}

function normalizeRecord(input: unknown): HubIdentityRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Hub identity state must be a JSON object");
  }
  const raw = input as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((key, index) => key !== RECORD_KEYS[index])) {
    throw new Error("Hub identity state schema contains unsupported fields");
  }
  if (raw.schemaVersion !== HUB_IDENTITY_SCHEMA_VERSION) {
    throw new Error(`Unsupported Hub identity schema: ${String(raw.schemaVersion)}`);
  }
  if (raw.algorithm !== HUB_IDENTITY_ALGORITHM) {
    throw new Error("Hub identity algorithm is invalid");
  }
  if (!validTimestamp(raw.createdAt)) {
    throw new Error("Hub identity creation timestamp is invalid");
  }

  const publicDer = decodeBase64Url(raw.publicKeySpki, "public key", 32, 128);
  const privateDer = decodeBase64Url(raw.privateKeyPkcs8, "private key", 32, 256);
  let publicKey: crypto.KeyObject;
  let privateKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({ key: publicDer, format: "der", type: "spki" });
    privateKey = crypto.createPrivateKey({ key: privateDer, format: "der", type: "pkcs8" });
  } catch {
    throw new Error("Hub identity key material is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519" || privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Hub identity must use Ed25519 keys");
  }
  const derivedPublic = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer;
  if (derivedPublic.length !== publicDer.length || !crypto.timingSafeEqual(derivedPublic, publicDer)) {
    throw new Error("Hub identity public/private key pair does not match");
  }

  const fingerprint = crypto.createHash("sha256").update(publicDer).digest("base64url");
  if (typeof raw.publicKeyFingerprint !== "string" || raw.publicKeyFingerprint !== fingerprint) {
    throw new Error("Hub identity public key fingerprint does not match the stored key");
  }
  const hubId = `cc_hub_${fingerprint}`;
  if (raw.hubId !== hubId) {
    throw new Error("Hub identity ID does not match the stored key fingerprint");
  }

  return {
    schemaVersion: HUB_IDENTITY_SCHEMA_VERSION,
    hubId,
    algorithm: HUB_IDENTITY_ALGORITHM,
    publicKeySpki: publicDer.toString("base64url"),
    privateKeyPkcs8: privateDer.toString("base64url"),
    publicKeyFingerprint: fingerprint,
    createdAt: raw.createdAt
  };
}

export function hubIdentityPath(runtimeDir: string): string {
  return path.join(runtimeDir, HUB_IDENTITY_FILE);
}

function atomicPrivateWrite(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function readHubIdentity(runtimeDir: string): HubIdentityRecord | null {
  const filePath = hubIdentityPath(runtimeDir);
  if (!fs.existsSync(filePath)) return null;
  if (process.platform !== "win32") {
    const mode = fs.statSync(filePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error("Hub identity state permissions are too broad");
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Hub identity state is not valid JSON");
  }
  return normalizeRecord(parsed);
}

export function createHubIdentity(runtimeDir: string, now = new Date().toISOString()): HubIdentityRecord {
  if (readHubIdentity(runtimeDir)) {
    throw new Error("Hub identity already exists; explicit rotation is not supported");
  }
  if (!validTimestamp(now)) throw new Error("Hub identity creation timestamp is invalid");

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const fingerprint = crypto.createHash("sha256").update(publicDer).digest("base64url");
  const record = normalizeRecord({
    schemaVersion: HUB_IDENTITY_SCHEMA_VERSION,
    hubId: `cc_hub_${fingerprint}`,
    algorithm: HUB_IDENTITY_ALGORITHM,
    publicKeySpki: publicDer.toString("base64url"),
    privateKeyPkcs8: privateDer.toString("base64url"),
    publicKeyFingerprint: fingerprint,
    createdAt: now
  });
  atomicPrivateWrite(hubIdentityPath(runtimeDir), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function ensureHubIdentity(runtimeDir: string, now?: string): HubIdentityRecord {
  return readHubIdentity(runtimeDir) ?? createHubIdentity(runtimeDir, now);
}

export function projectHubIdentity(record: HubIdentityRecord): HubIdentityProjection {
  const normalized = normalizeRecord(record);
  return {
    schemaVersion: normalized.schemaVersion,
    hubId: normalized.hubId,
    algorithm: normalized.algorithm,
    publicKeySpki: normalized.publicKeySpki,
    publicKeyFingerprint: normalized.publicKeyFingerprint,
    createdAt: normalized.createdAt
  };
}

export function buildHubIdentityProof(nonce: string): Buffer {
  return Buffer.from(`${HUB_IDENTITY_PROOF_DOMAIN}\n${normalizeNonce(nonce)}`, "utf8");
}

export function signHubIdentityProof(record: HubIdentityRecord, nonce: string): string {
  const normalized = normalizeRecord(record);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(normalized.privateKeyPkcs8, "base64url"),
    format: "der",
    type: "pkcs8"
  });
  return crypto.sign(null, buildHubIdentityProof(nonce), privateKey).toString("base64url");
}

export function verifyHubIdentityProof(
  publicKeySpki: string,
  nonce: string,
  signature: string
): boolean {
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    throw new Error("Hub identity proof signature is invalid");
  }
  const publicKey = parsePublicKey(publicKeySpki);
  return crypto.verify(
    null,
    buildHubIdentityProof(nonce),
    publicKey,
    Buffer.from(signature, "base64url")
  );
}
