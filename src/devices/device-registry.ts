import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEVICE_PRESENCE_WINDOW_MS = 90_000;
export const DEVICE_ENROLLMENT_TTL_MS = 5 * 60_000;
export const DEVICE_ENROLLMENT_POLL_AFTER_SECONDS = 3;
export const DEVICE_ENROLLMENT_MAX_PENDING = 64;

const VERIFICATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type DevicePresence = "online" | "offline" | "revoked";
export type DeviceEnrollmentDecision = "approve" | "deny";
export type DeviceEnrollmentStatus = "pending" | "approved" | "denied" | "expired";

export interface ManagedDeviceRecord {
  id: string;
  displayName: string;
  platform: string;
  architecture: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  lastSequence: number;
  revision: number;
}

export interface ManagedDeviceProjection {
  id: string;
  kind: "device";
  locality: "remote";
  displayName: string;
  platform: string;
  architecture: string;
  publicKeyFingerprint: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revision: number;
  trust: "paired" | "revoked";
  presence: DevicePresence;
  management: {
    heartbeat: true;
    remoteControl: false;
  };
}

export interface DeviceEnrollmentRecord {
  id: string;
  displayName: string;
  platform: string;
  architecture: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  requestNonce: string;
  verificationCode: string;
  createdAt: string;
  expiresAt: string;
  decision: "approved" | "denied" | null;
  decidedAt: string | null;
  deviceId: string | null;
  revision: number;
}

export interface DeviceEnrollmentProjection {
  id: string;
  displayName: string;
  platform: string;
  architecture: string;
  publicKeyFingerprint: string;
  verificationCode: string;
  createdAt: string;
  expiresAt: string;
  status: DeviceEnrollmentStatus;
  decidedAt: string | null;
  deviceId: string | null;
  revision: number;
}

export interface CreateDeviceEnrollmentResult {
  created: boolean;
  enrollment: DeviceEnrollmentRecord;
}

export interface DecideDeviceEnrollmentResult {
  enrollment: DeviceEnrollmentProjection;
  device: ManagedDeviceRecord | null;
}

export class DeviceRegistryError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DeviceRegistryError";
  }
}

interface DeviceRow {
  device_id: string;
  display_name: string;
  platform: string;
  architecture: string;
  public_key_spki: string;
  public_key_fingerprint: string;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  last_sequence: number;
  revision: number;
}

interface EnrollmentRow {
  enrollment_id: string;
  display_name: string;
  platform: string;
  architecture: string;
  public_key_spki: string;
  public_key_fingerprint: string;
  request_nonce: string;
  verification_code: string;
  created_at: string;
  expires_at: string;
  decision: "approved" | "denied" | null;
  decided_at: string | null;
  device_id: string | null;
  revision: number;
}

function mapDevice(row: DeviceRow): ManagedDeviceRecord {
  return {
    id: row.device_id,
    displayName: row.display_name,
    platform: row.platform,
    architecture: row.architecture,
    publicKeySpki: row.public_key_spki,
    publicKeyFingerprint: row.public_key_fingerprint,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    lastSequence: Number(row.last_sequence),
    revision: Number(row.revision)
  };
}

function mapEnrollment(row: EnrollmentRow): DeviceEnrollmentRecord {
  return {
    id: row.enrollment_id,
    displayName: row.display_name,
    platform: row.platform,
    architecture: row.architecture,
    publicKeySpki: row.public_key_spki,
    publicKeyFingerprint: row.public_key_fingerprint,
    requestNonce: row.request_nonce,
    verificationCode: row.verification_code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decision: row.decision,
    decidedAt: row.decided_at,
    deviceId: row.device_id,
    revision: Number(row.revision)
  };
}

function enrollmentStatus(record: DeviceEnrollmentRecord, now: string): DeviceEnrollmentStatus {
  if (record.decision === "approved") return "approved";
  if (record.decision === "denied") return "denied";
  return record.expiresAt <= now ? "expired" : "pending";
}

function projectEnrollment(record: DeviceEnrollmentRecord, now: string): DeviceEnrollmentProjection {
  return {
    id: record.id,
    displayName: record.displayName,
    platform: record.platform,
    architecture: record.architecture,
    publicKeyFingerprint: record.publicKeyFingerprint,
    verificationCode: record.verificationCode,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    status: enrollmentStatus(record, now),
    decidedAt: record.decidedAt,
    deviceId: record.deviceId,
    revision: record.revision
  };
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_DISPLAY_NAME_INVALID",
      "Device display name must contain 1 to 80 characters"
    );
  }
  return normalized;
}

function normalizeMachineField(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(normalized)) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_METADATA_INVALID",
      `Device ${label} is invalid`
    );
  }
  return normalized;
}

function normalizeRequestNonce(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_ENROLLMENT_NONCE_INVALID",
      "Device enrollment nonce is invalid"
    );
  }
  return normalized;
}

function parseEd25519PublicKey(encoded: string): crypto.KeyObject {
  let der: Buffer;
  try {
    der = Buffer.from(encoded, "base64url");
  } catch {
    throw new DeviceRegistryError(400, "DEVICE_PUBLIC_KEY_INVALID", "Device public key is invalid");
  }
  if (der.length < 32 || der.length > 128) {
    throw new DeviceRegistryError(400, "DEVICE_PUBLIC_KEY_INVALID", "Device public key is invalid");
  }
  try {
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("unexpected key type");
    return key;
  } catch {
    throw new DeviceRegistryError(
      400,
      "DEVICE_PUBLIC_KEY_INVALID",
      "Device public key must be an Ed25519 SPKI key"
    );
  }
}

function decodeSignature(encoded: string): Buffer {
  try {
    const signature = Buffer.from(encoded, "base64url");
    if (signature.length !== 64) throw new Error("invalid signature length");
    return signature;
  } catch {
    throw new DeviceRegistryError(401, "DEVICE_SIGNATURE_INVALID", "Device signature is invalid");
  }
}

function fingerprintForKey(publicKey: crypto.KeyObject): string {
  return crypto
    .createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }) as Buffer)
    .digest("base64url");
}

function verificationCode(): string {
  const bytes = crypto.randomBytes(8);
  let value = "";
  for (let index = 0; index < bytes.length; index += 1) {
    value += VERIFICATION_CODE_ALPHABET[bytes[index]! % VERIFICATION_CODE_ALPHABET.length];
  }
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function enrollmentMessage(input: {
  publicKey: string;
  displayName: string;
  platform: string;
  architecture: string;
  requestNonce: string;
}): Buffer {
  return Buffer.from(
    [
      "chatcockpit-device-enrollment-v1",
      input.publicKey,
      input.displayName,
      input.platform,
      input.architecture,
      input.requestNonce
    ].join("\n"),
    "utf8"
  );
}

function enrollmentStatusMessage(enrollmentId: string): Buffer {
  return Buffer.from(
    ["chatcockpit-device-enrollment-status-v1", enrollmentId].join("\n"),
    "utf8"
  );
}

function heartbeatMessage(deviceId: string, sequence: number): Buffer {
  return Buffer.from(
    ["chatcockpit-device-heartbeat-v1", deviceId, String(sequence)].join("\n"),
    "utf8"
  );
}

function channelOpenMessage(deviceId: string, sequence: number, channelNonce: string): Buffer {
  return Buffer.from(
    ["chatcockpit-device-channel-open-v1", deviceId, String(sequence), channelNonce].join("\n"),
    "utf8"
  );
}

function normalizeChannelNonce(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) {
    throw new DeviceRegistryError(
      400,
      "DEVICE_CHANNEL_NONCE_INVALID",
      "Device channel nonce is invalid"
    );
  }
  return normalized;
}

export class DeviceRegistryStore {
  readonly sqlite: DatabaseSync;
  readonly path: string;
  private closed = false;

  constructor(options: { path: string }) {
    this.path = options.path;
    if (this.path !== ":memory:") fs.mkdirSync(path.dirname(this.path), { recursive: true });
    this.sqlite = new DatabaseSync(this.path);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    if (this.path !== ":memory:") this.sqlite.exec("PRAGMA journal_mode = WAL");
    this.initializeSchema();
  }

  close(): void {
    if (this.closed) return;
    this.sqlite.close();
    this.closed = true;
  }

  getHubIdentityFingerprint(): string | null {
    const row = this.sqlite.prepare(`
      SELECT value FROM device_registry_metadata WHERE key = 'hub_identity_fingerprint'
    `).get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  bindHubIdentityFingerprint(fingerprint: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) {
      throw new Error("Device Registry Hub identity fingerprint is invalid");
    }
    this.sqlite.prepare(`
      INSERT OR IGNORE INTO device_registry_metadata (key, value)
      VALUES ('hub_identity_fingerprint', ?)
    `).run(fingerprint);
    const bound = this.getHubIdentityFingerprint();
    if (bound !== fingerprint) {
      throw new Error("Device Registry Hub identity fingerprint does not match the persisted Hub identity");
    }
    return bound;
  }

  createEnrollmentRequest(
    input: {
      displayName: string;
      platform: string;
      architecture: string;
      publicKey: string;
      requestNonce: string;
      signature: string;
    },
    now: string
  ): CreateDeviceEnrollmentResult {
    const displayName = normalizeDisplayName(input.displayName);
    const platform = normalizeMachineField(input.platform, "platform");
    const architecture = normalizeMachineField(input.architecture, "architecture");
    const requestNonce = normalizeRequestNonce(input.requestNonce);
    const publicKeyObject = parseEd25519PublicKey(input.publicKey);
    if (
      !crypto.verify(
        null,
        enrollmentMessage({
          publicKey: input.publicKey,
          displayName,
          platform,
          architecture,
          requestNonce
        }),
        publicKeyObject,
        decodeSignature(input.signature)
      )
    ) {
      throw new DeviceRegistryError(
        401,
        "DEVICE_SIGNATURE_INVALID",
        "Device enrollment proof is invalid"
      );
    }
    const fingerprint = fingerprintForKey(publicKeyObject);

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const existingDevice = this.sqlite.prepare(`
        SELECT * FROM managed_devices WHERE public_key_fingerprint = ?
      `).get(fingerprint) as DeviceRow | undefined;
      if (existingDevice) {
        throw new DeviceRegistryError(
          409,
          existingDevice.revoked_at ? "DEVICE_IDENTITY_REVOKED" : "DEVICE_ALREADY_ENROLLED",
          existingDevice.revoked_at
            ? "Revoked device identity cannot be re-enrolled"
            : "Device identity is already enrolled"
        );
      }

      const existingPending = this.sqlite.prepare(`
        SELECT * FROM device_enrollment_requests
        WHERE public_key_fingerprint = ?
          AND decision IS NULL
          AND expires_at > ?
        ORDER BY created_at DESC, enrollment_id DESC
        LIMIT 1
      `).get(fingerprint, now) as EnrollmentRow | undefined;
      if (existingPending) {
        this.sqlite.exec("COMMIT");
        return { created: false, enrollment: mapEnrollment(existingPending) };
      }

      const pendingCount = this.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM device_enrollment_requests
        WHERE decision IS NULL AND expires_at > ?
      `).get(now) as { count: number };
      if (Number(pendingCount.count) >= DEVICE_ENROLLMENT_MAX_PENDING) {
        throw new DeviceRegistryError(
          429,
          "DEVICE_ENROLLMENT_CAPACITY_REACHED",
          "Too many device enrollment requests are currently pending"
        );
      }

      const id = `cc_enroll_${crypto.randomBytes(18).toString("base64url")}`;
      const expiresAt = new Date(Date.parse(now) + DEVICE_ENROLLMENT_TTL_MS).toISOString();
      const code = verificationCode();
      this.sqlite.prepare(`
        INSERT INTO device_enrollment_requests (
          enrollment_id, display_name, platform, architecture, public_key_spki,
          public_key_fingerprint, request_nonce, verification_code, created_at,
          expires_at, decision, decided_at, device_id, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1)
      `).run(
        id,
        displayName,
        platform,
        architecture,
        input.publicKey,
        fingerprint,
        requestNonce,
        code,
        now,
        expiresAt
      );
      const created = this.getEnrollmentRequest(id);
      this.sqlite.exec("COMMIT");
      if (!created) throw new Error("Device enrollment request was not persisted");
      return { created: true, enrollment: created };
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Transaction may already be committed for an idempotent existing request.
      }
      throw error;
    }
  }

  verifyEnrollmentStatus(
    input: { enrollmentId: string; signature: string },
    now: string
  ): DeviceEnrollmentProjection {
    const record = this.getEnrollmentRequest(input.enrollmentId);
    if (!record) {
      throw new DeviceRegistryError(404, "DEVICE_ENROLLMENT_NOT_FOUND", "Device enrollment request was not found");
    }
    const publicKey = parseEd25519PublicKey(record.publicKeySpki);
    if (
      !crypto.verify(
        null,
        enrollmentStatusMessage(record.id),
        publicKey,
        decodeSignature(input.signature)
      )
    ) {
      throw new DeviceRegistryError(401, "DEVICE_SIGNATURE_INVALID", "Device enrollment status proof is invalid");
    }
    return projectEnrollment(record, now);
  }

  listPendingEnrollmentRequests(now: string): DeviceEnrollmentProjection[] {
    return (this.sqlite.prepare(`
      SELECT * FROM device_enrollment_requests
      WHERE decision IS NULL AND expires_at > ?
      ORDER BY created_at ASC, enrollment_id ASC
    `).all(now) as unknown as EnrollmentRow[]).map((row) => projectEnrollment(mapEnrollment(row), now));
  }

  decideEnrollmentRequest(
    enrollmentId: string,
    decision: DeviceEnrollmentDecision,
    now: string
  ): DecideDeviceEnrollmentResult {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const row = this.sqlite.prepare(`
        SELECT * FROM device_enrollment_requests WHERE enrollment_id = ?
      `).get(enrollmentId) as EnrollmentRow | undefined;
      if (!row) {
        throw new DeviceRegistryError(404, "DEVICE_ENROLLMENT_NOT_FOUND", "Device enrollment request was not found");
      }
      const record = mapEnrollment(row);
      if (record.decision !== null) {
        throw new DeviceRegistryError(409, "DEVICE_ENROLLMENT_DECIDED", "Device enrollment request was already decided");
      }
      if (record.expiresAt <= now) {
        throw new DeviceRegistryError(409, "DEVICE_ENROLLMENT_EXPIRED", "Device enrollment request has expired");
      }

      if (decision === "deny") {
        const updated = this.sqlite.prepare(`
          UPDATE device_enrollment_requests
          SET decision = 'denied', decided_at = ?, revision = revision + 1
          WHERE enrollment_id = ? AND decision IS NULL AND expires_at > ?
        `).run(now, enrollmentId, now);
        if (Number(updated.changes) !== 1) {
          throw new DeviceRegistryError(409, "DEVICE_ENROLLMENT_DECIDED", "Device enrollment request could not be denied");
        }
        const denied = this.getEnrollmentRequest(enrollmentId)!;
        this.sqlite.exec("COMMIT");
        return { enrollment: projectEnrollment(denied, now), device: null };
      }

      const existingDevice = this.sqlite.prepare(`
        SELECT * FROM managed_devices WHERE public_key_fingerprint = ?
      `).get(record.publicKeyFingerprint) as DeviceRow | undefined;
      if (existingDevice) {
        throw new DeviceRegistryError(
          409,
          existingDevice.revoked_at ? "DEVICE_IDENTITY_REVOKED" : "DEVICE_ALREADY_ENROLLED",
          "Device identity is already registered"
        );
      }

      const deviceId = `cc_device_${crypto.randomBytes(18).toString("base64url")}`;
      this.sqlite.prepare(`
        INSERT INTO managed_devices (
          device_id, display_name, platform, architecture, public_key_spki,
          public_key_fingerprint, paired_at, last_seen_at, revoked_at,
          last_sequence, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1)
      `).run(
        deviceId,
        record.displayName,
        record.platform,
        record.architecture,
        record.publicKeySpki,
        record.publicKeyFingerprint,
        now
      );
      const updated = this.sqlite.prepare(`
        UPDATE device_enrollment_requests
        SET decision = 'approved', decided_at = ?, device_id = ?, revision = revision + 1
        WHERE enrollment_id = ? AND decision IS NULL AND expires_at > ?
      `).run(now, deviceId, enrollmentId, now);
      if (Number(updated.changes) !== 1) {
        throw new DeviceRegistryError(409, "DEVICE_ENROLLMENT_DECIDED", "Device enrollment request could not be approved");
      }
      const approved = this.getEnrollmentRequest(enrollmentId)!;
      const device = this.getDevice(deviceId)!;
      this.sqlite.exec("COMMIT");
      return { enrollment: projectEnrollment(approved, now), device };
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Ignore rollback failure if transaction was already closed.
      }
      throw error;
    }
  }

  recordChannelOpen(
    input: { deviceId: string; sequence: number; channelNonce: string; signature: string },
    now: string
  ): ManagedDeviceRecord {
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
      throw new DeviceRegistryError(
        400,
        "DEVICE_SEQUENCE_INVALID",
        "Device channel sequence must be a positive integer"
      );
    }
    const channelNonce = normalizeChannelNonce(input.channelNonce);
    const row = this.sqlite.prepare(`
      SELECT * FROM managed_devices WHERE device_id = ?
    `).get(input.deviceId) as DeviceRow | undefined;
    if (!row || row.revoked_at) {
      throw new DeviceRegistryError(401, "DEVICE_NOT_TRUSTED", "Device is unknown or revoked");
    }
    if (input.sequence <= Number(row.last_sequence)) {
      throw new DeviceRegistryError(
        409,
        "DEVICE_CHANNEL_REPLAYED",
        "Device channel sequence was already consumed"
      );
    }
    const publicKey = parseEd25519PublicKey(row.public_key_spki);
    if (
      !crypto.verify(
        null,
        channelOpenMessage(input.deviceId, input.sequence, channelNonce),
        publicKey,
        decodeSignature(input.signature)
      )
    ) {
      throw new DeviceRegistryError(401, "DEVICE_SIGNATURE_INVALID", "Device channel proof is invalid");
    }
    const updated = this.sqlite.prepare(`
      UPDATE managed_devices
      SET last_seen_at = ?, last_sequence = ?, revision = revision + 1
      WHERE device_id = ? AND revoked_at IS NULL AND last_sequence < ?
    `).run(now, input.sequence, input.deviceId, input.sequence);
    if (Number(updated.changes) !== 1) {
      throw new DeviceRegistryError(
        409,
        "DEVICE_CHANNEL_REPLAYED",
        "Device channel sequence was already consumed"
      );
    }
    return this.getDevice(input.deviceId)!;
  }

  recordHeartbeat(
    input: { deviceId: string; sequence: number; signature: string },
    now: string
  ): ManagedDeviceRecord {
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
      throw new DeviceRegistryError(
        400,
        "DEVICE_SEQUENCE_INVALID",
        "Device heartbeat sequence must be a positive integer"
      );
    }
    const row = this.sqlite.prepare(`
      SELECT * FROM managed_devices WHERE device_id = ?
    `).get(input.deviceId) as DeviceRow | undefined;
    if (!row || row.revoked_at) {
      throw new DeviceRegistryError(401, "DEVICE_NOT_TRUSTED", "Device is unknown or revoked");
    }
    if (input.sequence <= Number(row.last_sequence)) {
      throw new DeviceRegistryError(
        409,
        "DEVICE_HEARTBEAT_REPLAYED",
        "Device heartbeat sequence was already consumed"
      );
    }
    const publicKey = parseEd25519PublicKey(row.public_key_spki);
    if (
      !crypto.verify(
        null,
        heartbeatMessage(input.deviceId, input.sequence),
        publicKey,
        decodeSignature(input.signature)
      )
    ) {
      throw new DeviceRegistryError(401, "DEVICE_SIGNATURE_INVALID", "Device heartbeat proof is invalid");
    }
    const updated = this.sqlite.prepare(`
      UPDATE managed_devices
      SET last_seen_at = ?, last_sequence = ?, revision = revision + 1
      WHERE device_id = ? AND revoked_at IS NULL AND last_sequence < ?
    `).run(now, input.sequence, input.deviceId, input.sequence);
    if (Number(updated.changes) !== 1) {
      throw new DeviceRegistryError(
        409,
        "DEVICE_HEARTBEAT_REPLAYED",
        "Device heartbeat sequence was already consumed"
      );
    }
    return this.getDevice(input.deviceId)!;
  }

  revokeDevice(deviceId: string, now: string): ManagedDeviceRecord | null {
    const updated = this.sqlite.prepare(`
      UPDATE managed_devices
      SET revoked_at = ?, revision = revision + 1
      WHERE device_id = ? AND revoked_at IS NULL
    `).run(now, deviceId);
    return Number(updated.changes) === 1 ? this.getDevice(deviceId) : null;
  }

  getDevice(deviceId: string): ManagedDeviceRecord | null {
    const row = this.sqlite.prepare(`
      SELECT * FROM managed_devices WHERE device_id = ?
    `).get(deviceId) as DeviceRow | undefined;
    return row ? mapDevice(row) : null;
  }

  getEnrollmentRequest(enrollmentId: string): DeviceEnrollmentRecord | null {
    const row = this.sqlite.prepare(`
      SELECT * FROM device_enrollment_requests WHERE enrollment_id = ?
    `).get(enrollmentId) as EnrollmentRow | undefined;
    return row ? mapEnrollment(row) : null;
  }

  listDevices(now: string, presenceWindowMs = DEVICE_PRESENCE_WINDOW_MS): ManagedDeviceProjection[] {
    const nowMs = Date.parse(now);
    return (this.sqlite.prepare(`
      SELECT * FROM managed_devices ORDER BY paired_at ASC, device_id ASC
    `).all() as unknown as DeviceRow[]).map((row) => {
      const record = mapDevice(row);
      const online = Boolean(
        record.lastSeenAt &&
        Number.isFinite(nowMs) &&
        nowMs - Date.parse(record.lastSeenAt) <= presenceWindowMs
      );
      return {
        id: record.id,
        kind: "device" as const,
        locality: "remote" as const,
        displayName: record.displayName,
        platform: record.platform,
        architecture: record.architecture,
        publicKeyFingerprint: record.publicKeyFingerprint,
        pairedAt: record.pairedAt,
        lastSeenAt: record.lastSeenAt,
        revokedAt: record.revokedAt,
        revision: record.revision,
        trust: record.revokedAt ? "revoked" as const : "paired" as const,
        presence: record.revokedAt
          ? "revoked" as const
          : online
            ? "online" as const
            : "offline" as const,
        management: {
          heartbeat: true as const,
          remoteControl: false as const
        }
      };
    });
  }

  private initializeSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS device_registry_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS managed_devices (
        device_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        architecture TEXT NOT NULL,
        public_key_spki TEXT NOT NULL UNIQUE,
        public_key_fingerprint TEXT NOT NULL UNIQUE,
        paired_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT,
        last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS device_enrollment_requests (
        enrollment_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        architecture TEXT NOT NULL,
        public_key_spki TEXT NOT NULL,
        public_key_fingerprint TEXT NOT NULL,
        request_nonce TEXT NOT NULL,
        verification_code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decision TEXT CHECK (decision IN ('approved', 'denied')),
        decided_at TEXT,
        device_id TEXT REFERENCES managed_devices(device_id),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS managed_devices_presence_idx
        ON managed_devices(revoked_at, last_seen_at);
      CREATE INDEX IF NOT EXISTS device_enrollment_pending_idx
        ON device_enrollment_requests(public_key_fingerprint, decision, expires_at);
      CREATE INDEX IF NOT EXISTS device_enrollment_created_idx
        ON device_enrollment_requests(created_at, enrollment_id);
    `);
  }
}

export function deviceRegistryDatabasePath(runtimeDir: string): string {
  return path.join(runtimeDir, "devices.sqlite");
}

export function buildDeviceEnrollmentProof(input: {
  publicKey: string;
  displayName: string;
  platform: string;
  architecture: string;
  requestNonce: string;
}): Buffer {
  return enrollmentMessage(input);
}

export function buildDeviceEnrollmentStatusProof(enrollmentId: string): Buffer {
  return enrollmentStatusMessage(enrollmentId);
}

export function buildDeviceHeartbeatProof(deviceId: string, sequence: number): Buffer {
  return heartbeatMessage(deviceId, sequence);
}

export function buildDeviceChannelOpenProof(
  deviceId: string,
  sequence: number,
  channelNonce: string
): Buffer {
  return channelOpenMessage(deviceId, sequence, normalizeChannelNonce(channelNonce));
}
