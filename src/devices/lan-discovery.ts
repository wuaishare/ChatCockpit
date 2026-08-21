import ipaddr from "ipaddr.js";

export const CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE = "_chatcockpit._tcp.local." as const;
export const CHATCOCKPIT_LAN_DISCOVERY_SCHEMA_VERSION = 1 as const;

const MAX_INSTANCE_NAME_LENGTH = 80;
const MAX_HOST_LENGTH = 253;
const MAX_ADDRESS_COUNT = 8;
const MAX_TXT_ENTRY_LENGTH = 160;
const HUB_ID_PATTERN = /^cc_hub_[A-Za-z0-9_-]{43}$/;
const HOST_PATTERN = /^(?=.{1,253}\.?$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+local\.$/;
const TXT_KEYS = new Set(["v", "role", "hub", "tls"]);

export interface LanDiscoveryServiceRecordInput {
  serviceType: string;
  instanceName: string;
  host: string;
  port: number;
  addresses: readonly string[];
  txt: readonly string[];
}

export interface LanDiscoveryCandidate {
  schemaVersion: typeof CHATCOCKPIT_LAN_DISCOVERY_SCHEMA_VERSION;
  source: "mdns";
  trusted: false;
  verification: "required";
  serviceType: typeof CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE;
  instanceName: string;
  host: string;
  port: number;
  addresses: string[];
  hubIdHint: string;
  wireProtocolVersion?: 2;
  securePort?: number;
}

function normalizeInstanceName(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > MAX_INSTANCE_NAME_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    throw new Error("LAN discovery instance name is invalid");
  }
  return normalized;
}

function normalizeHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 1 ||
    normalized.length > MAX_HOST_LENGTH ||
    !HOST_PATTERN.test(normalized)
  ) {
    throw new Error("LAN discovery host is invalid");
  }
  return normalized;
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("LAN discovery port is invalid");
  }
  return value;
}

function isLanAddress(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  const range = address.range();
  return range === "private" || range === "linkLocal" || range === "uniqueLocal";
}

function normalizeAddresses(values: readonly string[]): string[] {
  if (values.length < 1 || values.length > MAX_ADDRESS_COUNT) {
    throw new Error("LAN discovery addresses are invalid");
  }
  const normalized: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || value.includes("%") || !ipaddr.isValid(value)) {
      throw new Error("LAN discovery address is invalid");
    }
    const parsed = ipaddr.parse(value);
    if (!isLanAddress(parsed)) {
      throw new Error("LAN discovery address is outside local scope");
    }
    const canonical = parsed.toString();
    if (!normalized.includes(canonical)) normalized.push(canonical);
  }
  if (normalized.length < 1) throw new Error("LAN discovery addresses are invalid");
  return normalized;
}

function parseTxt(values: readonly string[]): { hubIdHint: string; securePort?: number } {
  if (values.length !== 3 && values.length !== 4) {
    throw new Error("LAN discovery TXT record is invalid");
  }
  const parsed = new Map<string, string>();
  for (const raw of values) {
    if (
      typeof raw !== "string" ||
      raw.length < 3 ||
      raw.length > MAX_TXT_ENTRY_LENGTH ||
      /[\u0000-\u001F\u007F]/.test(raw)
    ) {
      throw new Error("LAN discovery TXT entry is invalid");
    }
    const separator = raw.indexOf("=");
    if (separator <= 0) throw new Error("LAN discovery TXT entry is invalid");
    const key = raw.slice(0, separator);
    const value = raw.slice(separator + 1);
    if (!TXT_KEYS.has(key) || !value || parsed.has(key)) {
      throw new Error("LAN discovery TXT record is invalid");
    }
    parsed.set(key, value);
  }
  const version = parsed.get("v");
  if ((version !== "1" && version !== "2") || parsed.get("role") !== "hub") {
    throw new Error("LAN discovery TXT protocol is unsupported");
  }
  const hubIdHint = parsed.get("hub");
  if (!hubIdHint || !HUB_ID_PATTERN.test(hubIdHint)) {
    throw new Error("LAN discovery Hub identity hint is invalid");
  }
  const tlsValue = parsed.get("tls");
  if (version === "1") {
    if (values.length !== 3 || tlsValue !== undefined) {
      throw new Error("LAN discovery TXT protocol is unsupported");
    }
    return { hubIdHint };
  }
  if (values.length !== 4 || tlsValue === undefined || !/^[1-9][0-9]{0,4}$/.test(tlsValue)) {
    throw new Error("LAN discovery secure port is invalid");
  }
  const securePort = Number(tlsValue);
  if (!Number.isInteger(securePort) || securePort < 1 || securePort > 65535) {
    throw new Error("LAN discovery secure port is invalid");
  }
  return { hubIdHint, securePort };
}

export function parseLanDiscoveryCandidate(
  input: LanDiscoveryServiceRecordInput
): LanDiscoveryCandidate {
  if (input.serviceType !== CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE) {
    throw new Error("LAN discovery service type is unsupported");
  }
  const txt = parseTxt(input.txt);
  const port = normalizePort(input.port);
  if (txt.securePort === port) {
    throw new Error("LAN discovery secure port must differ from the bootstrap port");
  }
  return {
    schemaVersion: CHATCOCKPIT_LAN_DISCOVERY_SCHEMA_VERSION,
    source: "mdns",
    trusted: false,
    verification: "required",
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: normalizeInstanceName(input.instanceName),
    host: normalizeHost(input.host),
    port,
    addresses: normalizeAddresses(input.addresses),
    hubIdHint: txt.hubIdHint,
    ...(txt.securePort === undefined
      ? {}
      : { wireProtocolVersion: 2 as const, securePort: txt.securePort })
  };
}
