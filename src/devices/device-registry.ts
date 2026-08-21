import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEVICE_PRESENCE_WINDOW_MS = 90_000;
export const DEVICE_PAIRING_TTL_MS = 5 * 60_000;

export type DevicePresence = "online" | "offline" | "revoked";

export interface DevicePairingTicket {
  id: string;
  code: string;
  displayName: string;
  createdAt: string;
  expiresAt: string;
}

export interface ManagedDeviceRecord {
  id: string;
  displayName: string;
  platform: string;
  architecture: string;
  publicKeyFingerprint: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  lastSequence: number;
  revision: number;
}

export interface ManagedDeviceProjection extends Omit<ManagedDeviceRecord, "lastSequence"> {
  kind: "device";
  locality: "remote";
  trust: "paired" | "revoked";
  presence: DevicePresence;
  management: {
    heartbeat: true;
    remoteControl: false;
  };
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

interface PairingRow {
  pairing_id: string;
  code_hash: string;
  display_name: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

function hashOpaque(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function mapDevice(row: DeviceRow): ManagedDeviceRecord {
  return {
    id: row.device_id,
    displayName: row.display_name,
    platform: row.platform,
    architecture: row.architecture,
    publicKeyFingerprint: row.public_key_fingerprint,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    lastSequence: Number(row.last_sequence),
    revision: Number(row.revision)
  };
}

function pairingMessage(input: {
  pairingId: string;
  publicKey: string;
  platform: string;
  architecture: string;
}): Buffer {
  return Buffer.from(
    [
      "chatcockpit-device-pair-v1",
      input.pairingId,
      input.publicKey,
      input.platform,
      input.architecture
    ].join("\n"),
    "utf8"
  );
}

function heartbeatMessage(deviceId: string, sequence: number): Buffer {
  return Buffer.from(
    ["chatcockpit-device-heartbeat-v1", deviceId, String(sequence)].join("\n"),
    "utf8"
  );
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
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("unexpected key type");
    }
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

  createPairing(displayName: string, now: string): DevicePairingTicket {
    const normalizedName = displayName.trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new DeviceRegistryError(
        400,
        "DEVICE_DISPLAY_NAME_INVALID",
        "Device display name must contain 1 to 80 characters"
      );
    }
    const pairingId = `cc_pairing_${crypto.randomBytes(18).toString("base64url")}`;
    const code = `cc_pair_${crypto.randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.parse(now) + DEVICE_PAIRING_TTL_MS).toISOString();
    this.sqlite.prepare(`
      INSERT INTO device_pairings (
        pairing_id, code_hash, display_name, created_at, expires_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, NULL)
    `).run(pairingId, hashOpaque(code), normalizedName, now, expiresAt);
    return { id: pairingId, code, displayName: normalizedName, createdAt: now, expiresAt };
  }

  claimPairing(input: {
    pairingId: string;
    code: string;
    publicKey: string;
    platform: string;
    architecture: string;
    signature: string;
  }, now: string): ManagedDeviceRecord {
    const row = this.sqlite.prepare(`
      SELECT * FROM device_pairings WHERE pairing_id = ?
    `).get(input.pairingId) as PairingRow | undefined;
    if (
      !row ||
      row.consumed_at ||
      row.expires_at <= now ||
      !crypto.timingSafeEqual(
        Buffer.from(row.code_hash, "hex"),
        Buffer.from(hashOpaque(input.code), "hex")
      )
    ) {
      throw new DeviceRegistryError(
        401,
        "DEVICE_PAIRING_INVALID",
        "Device pairing code is invalid, expired, or already consumed"
      );
    }

    const platform = input.platform.trim();
    const architecture = input.architecture.trim();
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(platform) || !/^[A-Za-z0-9._-]{1,40}$/.test(architecture)) {
      throw new DeviceRegistryError(
        400,
        "DEVICE_METADATA_INVALID",
        "Device platform or architecture is invalid"
      );
    }
    const publicKey = parseEd25519PublicKey(input.publicKey);
    const signature = decodeSignature(input.signature);
    if (
      !crypto.verify(
        null,
        pairingMessage({
          pairingId: input.pairingId,
          publicKey: input.publicKey,
          platform,
          architecture
        }),
        publicKey,
        signature
      )
    ) {
      throw new DeviceRegistryError(
        401,
        "DEVICE_SIGNATURE_INVALID",
        "Device pairing proof is invalid"
      );
    }

    const fingerprint = crypto
      .createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }) as Buffer)
      .digest("base64url");
    const deviceId = `cc_device_${crypto.randomBytes(18).toString("base64url")}`;

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const consumed = this.sqlite.prepare(`
        UPDATE device_pairings
        SET consumed_at = ?
        WHERE pairing_id = ? AND consumed_at IS NULL AND expires_at > ?
      `).run(now, input.pairingId, now);
      if (Number(consumed.changes) !== 1) {
        throw new DeviceRegistryError(
          409,
          "DEVICE_PAIRING_CONSUMED",
          "Device pairing was already consumed"
        );
      }
      this.sqlite.prepare(`
        INSERT INTO managed_devices (
          device_id, display_name, platform, architecture, public_key_spki,
          public_key_fingerprint, paired_at, last_seen_at, revoked_at,
          last_sequence, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1)
      `).run(
        deviceId,
        row.display_name,
        platform,
        architecture,
        input.publicKey,
        fingerprint,
        now
      );
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    return this.getDevice(deviceId)!;
  }

  recordHeartbeat(input: {
    deviceId: string;
    sequence: number;
    signature: string;
  }, now: string): ManagedDeviceRecord {
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
        presence: record.revokedAt ? "revoked" as const : online ? "online" as const : "offline" as const,
        management: {
          heartbeat: true as const,
          remoteControl: false as const
        }
      };
    });
  }

  private initializeSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS device_pairings (
        pairing_id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
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

      CREATE INDEX IF NOT EXISTS managed_devices_presence_idx
        ON managed_devices(revoked_at, last_seen_at);
    `);
  }
}

export function deviceRegistryDatabasePath(runtimeDir: string): string {
  return path.join(runtimeDir, "devices.sqlite");
}

export function buildDevicePairingProof(input: {
  pairingId: string;
  publicKey: string;
  platform: string;
  architecture: string;
}): Buffer {
  return pairingMessage(input);
}

export function buildDeviceHeartbeatProof(deviceId: string, sequence: number): Buffer {
  return heartbeatMessage(deviceId, sequence);
}
