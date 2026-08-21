import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import ipaddr from "ipaddr.js";

export const DEVICE_AGENT_LAN_ROUTE_SCHEMA_VERSION = 1 as const;
const DEVICE_AGENT_LAN_ROUTE_FILE = "device-agent-lan-route.json";
const HUB_ID_PATTERN = /^cc_hub_[A-Za-z0-9_-]{43}$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface DeviceAgentLanRouteRecord {
  schemaVersion: typeof DEVICE_AGENT_LAN_ROUTE_SCHEMA_VERSION;
  hubId: string;
  bootstrapOrigin: string;
  secureOrigin: string;
  address: string;
  bootstrapPort: number;
  securePort: number;
  certificatePem: string;
  certificateFingerprint: string;
  verifiedAt: string;
  lastSuccessfulAt: string | null;
}

export interface DeviceAgentLanRouteProjection {
  configured: true;
  hubId: string;
  bootstrapOrigin: string;
  secureOrigin: string;
  address: string;
  bootstrapPort: number;
  securePort: number;
  certificateFingerprint: string;
  verifiedAt: string;
  lastSuccessfulAt: string | null;
}

const RECORD_KEYS = [
  "address",
  "bootstrapOrigin",
  "bootstrapPort",
  "certificateFingerprint",
  "certificatePem",
  "hubId",
  "lastSuccessfulAt",
  "schemaVersion",
  "secureOrigin",
  "securePort",
  "verifiedAt"
].sort();

function routePath(runtimeDir: string): string {
  return path.join(runtimeDir, DEVICE_AGENT_LAN_ROUTE_FILE);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizePort(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Device Agent LAN ${label} port is invalid`);
  }
  return value;
}

function normalizeLocalAddress(value: unknown): string {
  if (typeof value !== "string" || value.includes("%") || !ipaddr.isValid(value)) {
    throw new Error("Device Agent LAN route address is invalid");
  }
  const parsed = ipaddr.parse(value);
  const range = parsed.range();
  if (range !== "private" && range !== "linkLocal" && range !== "uniqueLocal") {
    throw new Error("Device Agent LAN route address is outside local scope");
  }
  return parsed.toString();
}

function originFor(protocol: "http:" | "https:", address: string, port: number): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `${protocol}//${host}:${port}`;
}

function normalizeCertificate(value: unknown): {
  pem: string;
  fingerprint: string;
} {
  if (typeof value !== "string" || value.length < 200 || value.length > 32_768) {
    throw new Error("Device Agent LAN TLS certificate is invalid");
  }
  let certificate: crypto.X509Certificate;
  try {
    certificate = new crypto.X509Certificate(value);
  } catch {
    throw new Error("Device Agent LAN TLS certificate is invalid");
  }
  const fingerprint = crypto.createHash("sha256").update(certificate.raw).digest("base64url");
  return { pem: value, fingerprint };
}

function normalizeRecord(value: unknown): DeviceAgentLanRouteRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device Agent LAN route must be a JSON object");
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join("\n") !== RECORD_KEYS.join("\n")) {
    throw new Error("Device Agent LAN route contains unsupported fields");
  }
  if (raw.schemaVersion !== DEVICE_AGENT_LAN_ROUTE_SCHEMA_VERSION) {
    throw new Error("Device Agent LAN route schema version is unsupported");
  }
  if (typeof raw.hubId !== "string" || !HUB_ID_PATTERN.test(raw.hubId)) {
    throw new Error("Device Agent LAN route Hub identity is invalid");
  }
  const address = normalizeLocalAddress(raw.address);
  const bootstrapPort = normalizePort(raw.bootstrapPort, "bootstrap");
  const securePort = normalizePort(raw.securePort, "secure");
  if (bootstrapPort === securePort) {
    throw new Error("Device Agent LAN bootstrap and secure ports must differ");
  }
  const bootstrapOrigin = originFor("http:", address, bootstrapPort);
  const secureOrigin = originFor("https:", address, securePort);
  if (raw.bootstrapOrigin !== bootstrapOrigin || raw.secureOrigin !== secureOrigin) {
    throw new Error("Device Agent LAN route origin does not match its address and ports");
  }
  const certificate = normalizeCertificate(raw.certificatePem);
  if (
    typeof raw.certificateFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(raw.certificateFingerprint) ||
    raw.certificateFingerprint !== certificate.fingerprint
  ) {
    throw new Error("Device Agent LAN TLS certificate fingerprint is invalid");
  }
  if (!validTimestamp(raw.verifiedAt)) {
    throw new Error("Device Agent LAN route verification timestamp is invalid");
  }
  if (raw.lastSuccessfulAt !== null && !validTimestamp(raw.lastSuccessfulAt)) {
    throw new Error("Device Agent LAN route last-success timestamp is invalid");
  }
  return {
    schemaVersion: DEVICE_AGENT_LAN_ROUTE_SCHEMA_VERSION,
    hubId: raw.hubId,
    bootstrapOrigin,
    secureOrigin,
    address,
    bootstrapPort,
    securePort,
    certificatePem: certificate.pem,
    certificateFingerprint: certificate.fingerprint,
    verifiedAt: raw.verifiedAt,
    lastSuccessfulAt: raw.lastSuccessfulAt
  };
}

function persist(runtimeDir: string, record: DeviceAgentLanRouteRecord): DeviceAgentLanRouteRecord {
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(runtimeDir, 0o700);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
  const target = routePath(runtimeDir);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const normalized = normalizeRecord(record);
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(temporary, 0o600);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
  fs.renameSync(temporary, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
  return normalized;
}

export function readDeviceAgentLanRoute(runtimeDir: string): DeviceAgentLanRouteRecord | null {
  const target = routePath(runtimeDir);
  if (!fs.existsSync(target)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    throw new Error("Device Agent LAN route file is invalid JSON");
  }
  return normalizeRecord(parsed);
}

export function writeVerifiedDeviceAgentLanRoute(input: {
  runtimeDir: string;
  hubId: string;
  address: string;
  bootstrapPort: number;
  securePort: number;
  certificatePem: string;
  certificateFingerprint: string;
  verifiedAt: string;
}): DeviceAgentLanRouteRecord {
  const address = normalizeLocalAddress(input.address);
  const bootstrapPort = normalizePort(input.bootstrapPort, "bootstrap");
  const securePort = normalizePort(input.securePort, "secure");
  return persist(input.runtimeDir, {
    schemaVersion: DEVICE_AGENT_LAN_ROUTE_SCHEMA_VERSION,
    hubId: input.hubId,
    bootstrapOrigin: originFor("http:", address, bootstrapPort),
    secureOrigin: originFor("https:", address, securePort),
    address,
    bootstrapPort,
    securePort,
    certificatePem: input.certificatePem,
    certificateFingerprint: input.certificateFingerprint,
    verifiedAt: input.verifiedAt,
    lastSuccessfulAt: null
  });
}

export function markDeviceAgentLanRouteSuccessful(
  runtimeDir: string,
  now = new Date().toISOString()
): DeviceAgentLanRouteRecord {
  const current = readDeviceAgentLanRoute(runtimeDir);
  if (!current) throw new Error("Device Agent LAN route is not configured");
  if (!validTimestamp(now)) throw new Error("Device Agent LAN route timestamp is invalid");
  return persist(runtimeDir, { ...current, lastSuccessfulAt: now });
}

export function clearDeviceAgentLanRoute(runtimeDir: string): void {
  fs.rmSync(routePath(runtimeDir), { force: true });
}

export function projectDeviceAgentLanRoute(
  record: DeviceAgentLanRouteRecord
): DeviceAgentLanRouteProjection {
  const normalized = normalizeRecord(record);
  return {
    configured: true,
    hubId: normalized.hubId,
    bootstrapOrigin: normalized.bootstrapOrigin,
    secureOrigin: normalized.secureOrigin,
    address: normalized.address,
    bootstrapPort: normalized.bootstrapPort,
    securePort: normalized.securePort,
    certificateFingerprint: normalized.certificateFingerprint,
    verifiedAt: normalized.verifiedAt,
    lastSuccessfulAt: normalized.lastSuccessfulAt
  };
}
