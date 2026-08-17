import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import ipaddr from "ipaddr.js";

import type { TokenPilotPaths } from "../types.js";

export const ACCESS_POLICY_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CONSOLE_PATH_PREFIX = "/ui";

export function generateRandomConsolePathPrefix(): string {
  return `/cc-${crypto.randomBytes(18).toString("base64url")}`;
}

const RESERVED_CONSOLE_ROOTS = new Set([
  "api",
  "favicon.ico",
  "mcp",
  "oauth",
  "openapi.yaml",
  "privacy-policy",
  "tokenpilot",
  "ui",
  ".well-known"
]);

export interface TrustedLanAccessPolicy {
  enabled: boolean;
  cidrs: string[];
}

export interface AccessPolicy {
  schemaVersion: typeof ACCESS_POLICY_SCHEMA_VERSION;
  consolePathPrefix: string;
  trustedLan: TrustedLanAccessPolicy;
}

export interface AccessPolicyUpdateInput {
  consolePathPrefix?: string;
  trustedLan?: {
    enabled: boolean;
    cidrs: string[];
  };
}

export function defaultAccessPolicy(): AccessPolicy {
  return {
    schemaVersion: ACCESS_POLICY_SCHEMA_VERSION,
    consolePathPrefix: DEFAULT_CONSOLE_PATH_PREFIX,
    trustedLan: {
      enabled: false,
      cidrs: []
    }
  };
}

export function accessPolicyPath(paths: TokenPilotPaths): string {
  return path.join(paths.runtimeDir, "access-policy.json");
}

export function normalizeConsolePathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_CONSOLE_PATH_PREFIX;
  if (trimmed.length > 96) {
    throw new Error("Console path prefix must be 96 characters or fewer");
  }
  if (!trimmed.startsWith("/") || trimmed.includes("?") || trimmed.includes("#")) {
    throw new Error("Console path prefix must be an absolute path without query or fragment data");
  }
  const normalized = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
  if (normalized === "/") {
    throw new Error("Console path prefix cannot be the site root");
  }
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._~-]*){0,2}$/.test(normalized)) {
    throw new Error(
      "Console path prefix may contain one to three URL-safe path segments"
    );
  }
  const firstSegment = normalized.slice(1).split("/", 1)[0]!.toLowerCase();
  if (normalized !== DEFAULT_CONSOLE_PATH_PREFIX && RESERVED_CONSOLE_ROOTS.has(firstSegment)) {
    throw new Error("Console path prefix conflicts with a reserved ChatCockpit endpoint");
  }
  return normalized;
}

export function normalizeTrustedLanCidrs(values: string[]): string[] {
  const normalized = values.map((value) => {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Trusted LAN CIDR entries cannot be empty");
    let parsed: ReturnType<typeof ipaddr.parseCIDR>;
    try {
      parsed = ipaddr.parseCIDR(trimmed);
    } catch {
      throw new Error(`Invalid trusted LAN CIDR: ${trimmed}`);
    }
    const [address, prefix] = parsed;
    const processed = ipaddr.process(address.toString());
    const maxPrefix = processed.kind() === "ipv4" ? 32 : 128;
    if (prefix < 0 || prefix > maxPrefix) {
      throw new Error(`Invalid trusted LAN CIDR prefix: ${trimmed}`);
    }
    return `${processed.toString()}/${prefix}`;
  });
  return [...new Set(normalized)].sort();
}

function normalizePolicy(input: unknown): AccessPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Access policy must be a JSON object");
  }
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion !== ACCESS_POLICY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported access policy schema: ${String(raw.schemaVersion)}`
    );
  }
  if (typeof raw.consolePathPrefix !== "string") {
    throw new Error("Access policy consolePathPrefix must be a string");
  }
  if (!raw.trustedLan || typeof raw.trustedLan !== "object" || Array.isArray(raw.trustedLan)) {
    throw new Error("Access policy trustedLan must be an object");
  }
  const trustedLan = raw.trustedLan as Record<string, unknown>;
  if (typeof trustedLan.enabled !== "boolean" || !Array.isArray(trustedLan.cidrs)) {
    throw new Error("Access policy trustedLan requires enabled and cidrs");
  }
  if (!trustedLan.cidrs.every((value) => typeof value === "string")) {
    throw new Error("Access policy trustedLan cidrs must be strings");
  }
  const cidrs = normalizeTrustedLanCidrs(trustedLan.cidrs as string[]);
  if (trustedLan.enabled && cidrs.length === 0) {
    throw new Error("Trusted LAN access cannot be enabled without at least one CIDR");
  }
  return {
    schemaVersion: ACCESS_POLICY_SCHEMA_VERSION,
    consolePathPrefix: normalizeConsolePathPrefix(raw.consolePathPrefix),
    trustedLan: {
      enabled: trustedLan.enabled,
      cidrs
    }
  };
}

export function loadAccessPolicy(paths: TokenPilotPaths): AccessPolicy {
  const filePath = accessPolicyPath(paths);
  if (!fs.existsSync(filePath)) return defaultAccessPolicy();
  const source = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Access policy is not valid JSON");
  }
  return normalizePolicy(parsed);
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

export function updateAccessPolicy(
  paths: TokenPilotPaths,
  input: AccessPolicyUpdateInput
): AccessPolicy {
  const current = loadAccessPolicy(paths);
  const next = normalizePolicy({
    schemaVersion: ACCESS_POLICY_SCHEMA_VERSION,
    consolePathPrefix:
      input.consolePathPrefix === undefined
        ? current.consolePathPrefix
        : input.consolePathPrefix,
    trustedLan:
      input.trustedLan === undefined
        ? current.trustedLan
        : {
            enabled: input.trustedLan.enabled,
            cidrs: input.trustedLan.cidrs
          }
  });
  atomicOwnerWrite(accessPolicyPath(paths), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function isTrustedLanAddress(
  address: string,
  policy: AccessPolicy
): boolean {
  if (!policy.trustedLan.enabled) return false;
  let candidate: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    candidate = ipaddr.process(address.trim());
  } catch {
    return false;
  }
  return policy.trustedLan.cidrs.some((cidr) => {
    const [range, prefix] = ipaddr.parseCIDR(cidr);
    const processedRange = ipaddr.process(range.toString());
    return candidate.kind() === processedRange.kind() && candidate.match(processedRange, prefix);
  });
}
