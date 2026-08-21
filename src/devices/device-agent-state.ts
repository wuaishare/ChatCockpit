import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEVICE_AGENT_STATE_SCHEMA_VERSION = 1 as const;
const DEVICE_AGENT_STATE_FILE = "device-agent.json";

export type DeviceAgentConnectionState = "pending" | "connected" | "revoked";

export interface DeviceAgentStateRecord {
  schemaVersion: typeof DEVICE_AGENT_STATE_SCHEMA_VERSION;
  hubOrigin: string;
  displayName: string;
  platform: string;
  architecture: string;
  publicKeySpki: string;
  privateKeyPkcs8: string;
  publicKeyFingerprint: string;
  enrollmentId: string | null;
  deviceId: string | null;
  nextSequence: number;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceAgentStatusProjection {
  configured: true;
  state: DeviceAgentConnectionState;
  hubOrigin: string;
  displayName: string;
  platform: string;
  architecture: string;
  deviceId: string | null;
  publicKeyFingerprint: string;
  nextSequence: number;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
}

const STATE_KEYS = [
  "architecture",
  "connectedAt",
  "createdAt",
  "deviceId",
  "displayName",
  "enrollmentId",
  "hubOrigin",
  "lastHeartbeatAt",
  "nextSequence",
  "platform",
  "privateKeyPkcs8",
  "publicKeyFingerprint",
  "publicKeySpki",
  "revokedAt",
  "schemaVersion",
  "updatedAt"
].sort();

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function optionalTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (!validTimestamp(value)) throw new Error(`Device Agent ${label} is invalid`);
  return value;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error("Device Agent display name must contain 1 to 80 characters");
  }
  return normalized;
}

function normalizeMachineField(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(normalized)) {
    throw new Error(`Device Agent ${label} is invalid`);
  }
  return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function normalizeDeviceHubOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Device Agent Hub URL is invalid");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Device Agent Hub URL must not contain credentials, query, or fragment");
  }
  if (parsed.pathname !== "/") {
    throw new Error("Device Agent Hub URL must be an origin without a path");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))) {
    throw new Error("Device Agent Hub requires HTTPS except for direct loopback development");
  }
  return parsed.origin;
}

function decodeBase64Url(value: unknown, label: string, min: number, max: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Device Agent ${label} is invalid`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < min || decoded.length > max) {
    throw new Error(`Device Agent ${label} is invalid`);
  }
  return decoded;
}

function keyMaterial(input: {
  publicKeySpki: unknown;
  privateKeyPkcs8: unknown;
  publicKeyFingerprint: unknown;
}): { publicKeySpki: string; privateKeyPkcs8: string; publicKeyFingerprint: string } {
  const publicDer = decodeBase64Url(input.publicKeySpki, "public key", 32, 128);
  const privateDer = decodeBase64Url(input.privateKeyPkcs8, "private key", 32, 256);
  if (
    typeof input.publicKeyFingerprint !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.publicKeyFingerprint)
  ) {
    throw new Error("Device Agent public key fingerprint is invalid");
  }
  let publicKey: crypto.KeyObject;
  let privateKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({ key: publicDer, format: "der", type: "spki" });
    privateKey = crypto.createPrivateKey({ key: privateDer, format: "der", type: "pkcs8" });
  } catch {
    throw new Error("Device Agent key material is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519" || privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Device Agent identity must use Ed25519 keys");
  }
  const derivedPublic = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer;
  if (!crypto.timingSafeEqual(publicDer, derivedPublic)) {
    throw new Error("Device Agent public/private key pair does not match");
  }
  const fingerprint = crypto.createHash("sha256").update(publicDer).digest("base64url");
  if (fingerprint !== input.publicKeyFingerprint) {
    throw new Error("Device Agent public key fingerprint does not match the stored key");
  }
  return {
    publicKeySpki: publicDer.toString("base64url"),
    privateKeyPkcs8: privateDer.toString("base64url"),
    publicKeyFingerprint: fingerprint
  };
}

function optionalEnrollmentId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^cc_enroll_[A-Za-z0-9_-]{20,80}$/.test(value)) {
    throw new Error("Device Agent enrollment ID is invalid");
  }
  return value;
}

function optionalDeviceId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^cc_device_[A-Za-z0-9_-]{20,80}$/.test(value)) {
    throw new Error("Device Agent device ID is invalid");
  }
  return value;
}

function normalizeRecord(input: unknown): DeviceAgentStateRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Device Agent state must be a JSON object");
  }
  const raw = input as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  if (keys.length !== STATE_KEYS.length || keys.some((key, index) => key !== STATE_KEYS[index])) {
    throw new Error("Device Agent state schema contains unsupported fields");
  }
  if (raw.schemaVersion !== DEVICE_AGENT_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Device Agent state schema: ${String(raw.schemaVersion)}`);
  }
  if (typeof raw.hubOrigin !== "string") throw new Error("Device Agent Hub URL is invalid");
  const hubOrigin = normalizeDeviceHubOrigin(raw.hubOrigin);
  if (typeof raw.displayName !== "string") throw new Error("Device Agent display name is invalid");
  if (typeof raw.platform !== "string" || typeof raw.architecture !== "string") {
    throw new Error("Device Agent machine metadata is invalid");
  }
  const keysRecord = keyMaterial({
    publicKeySpki: raw.publicKeySpki,
    privateKeyPkcs8: raw.privateKeyPkcs8,
    publicKeyFingerprint: raw.publicKeyFingerprint
  });
  const enrollmentId = optionalEnrollmentId(raw.enrollmentId);
  const deviceId = optionalDeviceId(raw.deviceId);
  if (!Number.isSafeInteger(raw.nextSequence) || Number(raw.nextSequence) < 1) {
    throw new Error("Device Agent next heartbeat sequence is invalid");
  }
  if (!validTimestamp(raw.createdAt) || !validTimestamp(raw.updatedAt)) {
    throw new Error("Device Agent state timestamps are invalid");
  }
  const connectedAt = optionalTimestamp(raw.connectedAt, "connectedAt");
  const lastHeartbeatAt = optionalTimestamp(raw.lastHeartbeatAt, "lastHeartbeatAt");
  const revokedAt = optionalTimestamp(raw.revokedAt, "revokedAt");
  if (deviceId && enrollmentId) {
    throw new Error("Device Agent state cannot be both pending and connected");
  }
  if (connectedAt && !deviceId) {
    throw new Error("Device Agent connectedAt requires a device ID");
  }
  if (lastHeartbeatAt && !deviceId) {
    throw new Error("Device Agent heartbeat timestamp requires a device ID");
  }
  return {
    schemaVersion: DEVICE_AGENT_STATE_SCHEMA_VERSION,
    hubOrigin,
    displayName: normalizeDisplayName(raw.displayName),
    platform: normalizeMachineField(raw.platform, "platform"),
    architecture: normalizeMachineField(raw.architecture, "architecture"),
    ...keysRecord,
    enrollmentId,
    deviceId,
    nextSequence: Number(raw.nextSequence),
    connectedAt,
    lastHeartbeatAt,
    revokedAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

export function deviceAgentStatePath(runtimeDir: string): string {
  return path.join(runtimeDir, DEVICE_AGENT_STATE_FILE);
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

function persistDeviceAgentState(runtimeDir: string, record: DeviceAgentStateRecord): DeviceAgentStateRecord {
  const normalized = normalizeRecord(record);
  atomicPrivateWrite(deviceAgentStatePath(runtimeDir), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function readDeviceAgentState(runtimeDir: string): DeviceAgentStateRecord | null {
  const filePath = deviceAgentStatePath(runtimeDir);
  if (!fs.existsSync(filePath)) return null;
  if (process.platform !== "win32") {
    const mode = fs.statSync(filePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error("Device Agent state permissions are too broad");
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Device Agent state is not valid JSON");
  }
  return normalizeRecord(parsed);
}

export function createDeviceAgentState(input: {
  runtimeDir: string;
  hubOrigin: string;
  displayName: string;
  platform?: string;
  architecture?: string;
  now?: string;
}): DeviceAgentStateRecord {
  const hubOrigin = normalizeDeviceHubOrigin(input.hubOrigin);
  const existing = readDeviceAgentState(input.runtimeDir);
  if (existing) {
    if (existing.hubOrigin !== hubOrigin) {
      throw new Error(
        `Device Agent is already configured for a different Hub (${existing.hubOrigin}); explicit reset is required`
      );
    }
    return existing;
  }
  const now = input.now ?? new Date().toISOString();
  if (!validTimestamp(now)) throw new Error("Device Agent creation timestamp is invalid");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  return persistDeviceAgentState(input.runtimeDir, {
    schemaVersion: DEVICE_AGENT_STATE_SCHEMA_VERSION,
    hubOrigin,
    displayName: normalizeDisplayName(input.displayName),
    platform: normalizeMachineField(input.platform ?? process.platform, "platform"),
    architecture: normalizeMachineField(input.architecture ?? process.arch, "architecture"),
    publicKeySpki: publicDer.toString("base64url"),
    privateKeyPkcs8: privateDer.toString("base64url"),
    publicKeyFingerprint: crypto.createHash("sha256").update(publicDer).digest("base64url"),
    enrollmentId: null,
    deviceId: null,
    nextSequence: 1,
    connectedAt: null,
    lastHeartbeatAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now
  });
}

function requireState(runtimeDir: string): DeviceAgentStateRecord {
  const state = readDeviceAgentState(runtimeDir);
  if (!state) throw new Error("Device Agent is not configured");
  return state;
}

function withUpdate(
  runtimeDir: string,
  now: string | undefined,
  mutate: (state: DeviceAgentStateRecord, timestamp: string) => DeviceAgentStateRecord
): DeviceAgentStateRecord {
  const state = requireState(runtimeDir);
  const timestamp = now ?? new Date().toISOString();
  if (!validTimestamp(timestamp)) throw new Error("Device Agent update timestamp is invalid");
  return persistDeviceAgentState(runtimeDir, mutate(state, timestamp));
}

export function setDeviceAgentPendingEnrollment(
  runtimeDir: string,
  enrollmentId: string,
  now?: string
): DeviceAgentStateRecord {
  optionalEnrollmentId(enrollmentId);
  return withUpdate(runtimeDir, now, (state, timestamp) => {
    if (state.revokedAt) throw new Error("Device Agent identity is revoked");
    if (state.deviceId) throw new Error("Device Agent is already connected");
    return { ...state, enrollmentId, updatedAt: timestamp };
  });
}

export function clearDeviceAgentPendingEnrollment(runtimeDir: string, now?: string): DeviceAgentStateRecord {
  return withUpdate(runtimeDir, now, (state, timestamp) => ({
    ...state,
    enrollmentId: null,
    updatedAt: timestamp
  }));
}

export function completeDeviceAgentEnrollment(
  runtimeDir: string,
  deviceId: string,
  now?: string
): DeviceAgentStateRecord {
  optionalDeviceId(deviceId);
  return withUpdate(runtimeDir, now, (state, timestamp) => {
    if (state.revokedAt) throw new Error("Device Agent identity is revoked");
    if (state.deviceId && state.deviceId !== deviceId) {
      throw new Error("Device Agent is already connected with a different device ID");
    }
    return {
      ...state,
      enrollmentId: null,
      deviceId,
      nextSequence: state.deviceId ? state.nextSequence : 1,
      connectedAt: state.connectedAt ?? timestamp,
      updatedAt: timestamp
    };
  });
}

export function reserveDeviceHeartbeatSequence(
  runtimeDir: string,
  now?: string
): { sequence: number; state: DeviceAgentStateRecord } {
  const current = requireState(runtimeDir);
  if (current.revokedAt) throw new Error("Device Agent identity is revoked");
  if (!current.deviceId) throw new Error("Device Agent is not connected");
  if (!Number.isSafeInteger(current.nextSequence) || current.nextSequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Device Agent heartbeat sequence is exhausted or invalid");
  }
  const sequence = current.nextSequence;
  const state = withUpdate(runtimeDir, now, (record, timestamp) => ({
    ...record,
    nextSequence: sequence + 1,
    updatedAt: timestamp
  }));
  return { sequence, state };
}

export function markDeviceAgentHeartbeatAccepted(
  runtimeDir: string,
  now?: string
): DeviceAgentStateRecord {
  return withUpdate(runtimeDir, now, (state, timestamp) => {
    if (!state.deviceId) throw new Error("Device Agent is not connected");
    if (state.revokedAt) throw new Error("Device Agent identity is revoked");
    return { ...state, lastHeartbeatAt: timestamp, updatedAt: timestamp };
  });
}

export function markDeviceAgentRevoked(runtimeDir: string, now?: string): DeviceAgentStateRecord {
  return withUpdate(runtimeDir, now, (state, timestamp) => ({
    ...state,
    revokedAt: state.revokedAt ?? timestamp,
    updatedAt: timestamp
  }));
}

export function projectDeviceAgentStatus(state: DeviceAgentStateRecord): DeviceAgentStatusProjection {
  return {
    configured: true,
    state: state.revokedAt ? "revoked" : state.deviceId ? "connected" : "pending",
    hubOrigin: state.hubOrigin,
    displayName: state.displayName,
    platform: state.platform,
    architecture: state.architecture,
    deviceId: state.deviceId,
    publicKeyFingerprint: state.publicKeyFingerprint,
    nextSequence: state.nextSequence,
    connectedAt: state.connectedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    revokedAt: state.revokedAt
  };
}
