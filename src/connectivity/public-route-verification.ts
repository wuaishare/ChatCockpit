import { randomUUID } from "node:crypto";
import { Resolver, lookup as dnsLookup } from "node:dns/promises";
import fs from "node:fs";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import path from "node:path";

import ipaddr from "ipaddr.js";

import {
  PublicRouteCandidateStore,
  type PublicRouteCandidate,
  type PublicRouteCanonicalProjection
} from "./public-route-candidate.js";

export const PUBLIC_ROUTE_VERIFICATION_SCHEMA_VERSION = 1 as const;

const VERIFICATION_FILE_NAME = "connectivity-route-verification.json";
const HEALTH_PATH = "/api/health";
const OAUTH_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_RESOLVED_ADDRESSES = 16;
const PUBLIC_ROUTE_FALLBACK_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"] as const;

export type PublicRouteVerificationStatus = "verified" | "failed";

export type PublicRouteVerificationReason =
  | "not-attempted"
  | "dns-failed"
  | "no-addresses"
  | "too-many-addresses"
  | "non-public-address"
  | "tls-error"
  | "network-error"
  | "timeout"
  | "response-too-large"
  | "unexpected-status"
  | "invalid-json"
  | "unexpected-health-contract"
  | "unexpected-oauth-metadata";

export interface PublicRouteVerificationCheck {
  ok: boolean;
  reason: PublicRouteVerificationReason | null;
  statusCode?: number | null;
  publicAddressCount?: number;
}

export interface PublicRouteVerificationChecks {
  dns: PublicRouteVerificationCheck;
  tls: PublicRouteVerificationCheck;
  reachability: PublicRouteVerificationCheck;
  identity: PublicRouteVerificationCheck;
  oauth: PublicRouteVerificationCheck;
}

export interface PublicRouteVerificationArtifact {
  id: string;
  candidateId: string;
  candidateOrigin: string;
  status: PublicRouteVerificationStatus;
  checkedAt: string;
  checks: PublicRouteVerificationChecks;
}

export interface PublicRouteVerificationSnapshot {
  ok: true;
  schemaVersion: typeof PUBLIC_ROUTE_VERIFICATION_SCHEMA_VERSION;
  canonical: PublicRouteCanonicalProjection;
  candidate: PublicRouteCandidate | null;
  verification: PublicRouteVerificationArtifact | null;
}

export interface PublicRouteVerificationResult extends PublicRouteVerificationSnapshot {
  verification: PublicRouteVerificationArtifact;
}

export type PublicRouteVerificationErrorCode = "candidate-stale" | "verification-state-invalid";

export class PublicRouteVerificationError extends Error {
  constructor(
    readonly code: PublicRouteVerificationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PublicRouteVerificationError";
  }
}

export interface PublicRouteResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PublicRouteResolver {
  resolve(hostname: string): Promise<PublicRouteResolvedAddress[]>;
}

export interface PublicRouteHttpResponse {
  statusCode: number;
  body: string;
}

export interface PublicRouteHttpProbeInput {
  hostname: string;
  address: string;
  family: 4 | 6;
  port: number;
  path: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface PublicRouteHttpProbe {
  get(input: PublicRouteHttpProbeInput): Promise<PublicRouteHttpResponse>;
}

export type PublicRouteHttpProbeErrorKind =
  | "tls-error"
  | "network-error"
  | "timeout"
  | "response-too-large";

export class PublicRouteHttpProbeError extends Error {
  constructor(
    readonly kind: PublicRouteHttpProbeErrorKind,
    message: string
  ) {
    super(message);
    this.name = "PublicRouteHttpProbeError";
  }
}

export function isPublicRouteNetworkAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address.trim());
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

function normalizeVerificationHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function dedupeNetworkDestinations(
  entries: Iterable<PublicRouteResolvedAddress>
): PublicRouteResolvedAddress[] {
  const unique = new Map<string, PublicRouteResolvedAddress>();
  for (const entry of entries) {
    unique.set(`${entry.family}:${entry.address}`, entry);
  }
  return [...unique.values()];
}

class NodeSystemPublicRouteResolver implements PublicRouteResolver {
  async resolve(hostname: string): Promise<PublicRouteResolvedAddress[]> {
    const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
    const addresses: PublicRouteResolvedAddress[] = [];
    for (const entry of resolved) {
      if (entry.family !== 4 && entry.family !== 6) continue;
      addresses.push({ address: entry.address, family: entry.family });
    }
    return dedupeNetworkDestinations(addresses);
  }
}

class NodeRecursivePublicDnsResolver implements PublicRouteResolver {
  private readonly resolver: Resolver;

  constructor(servers: readonly string[] = PUBLIC_ROUTE_FALLBACK_DNS_SERVERS) {
    this.resolver = new Resolver();
    this.resolver.setServers([...servers]);
  }

  async resolve(hostname: string): Promise<PublicRouteResolvedAddress[]> {
    const [ipv4, ipv6] = await Promise.allSettled([
      this.resolver.resolve4(hostname),
      this.resolver.resolve6(hostname)
    ]);
    const addresses: PublicRouteResolvedAddress[] = [];
    if (ipv4.status === "fulfilled") {
      addresses.push(...ipv4.value.map((address) => ({ address, family: 4 as const })));
    }
    if (ipv6.status === "fulfilled") {
      addresses.push(...ipv6.value.map((address) => ({ address, family: 6 as const })));
    }
    const deduped = dedupeNetworkDestinations(addresses);
    if (deduped.length > 0) return deduped;
    if (ipv4.status === "rejected") throw ipv4.reason;
    if (ipv6.status === "rejected") throw ipv6.reason;
    return [];
  }
}

export interface NodePublicRouteResolverOptions {
  systemResolver?: PublicRouteResolver;
  publicResolver?: PublicRouteResolver;
}

export class NodePublicRouteResolver implements PublicRouteResolver {
  private readonly systemResolver: PublicRouteResolver;
  private readonly publicResolver: PublicRouteResolver;

  constructor(options: NodePublicRouteResolverOptions = {}) {
    this.systemResolver = options.systemResolver ?? new NodeSystemPublicRouteResolver();
    this.publicResolver = options.publicResolver ?? new NodeRecursivePublicDnsResolver();
  }

  async resolve(hostname: string): Promise<PublicRouteResolvedAddress[]> {
    const normalizedHostname = normalizeVerificationHostname(hostname);
    const literalFamily = isIP(normalizedHostname);
    if (literalFamily === 4 || literalFamily === 6) {
      return [{ address: normalizedHostname, family: literalFamily }];
    }

    let systemAddresses: PublicRouteResolvedAddress[] | null = null;
    let systemError: unknown = null;
    try {
      systemAddresses = await this.systemResolver.resolve(normalizedHostname);
    } catch (error) {
      systemError = error;
    }

    if (
      systemAddresses &&
      systemAddresses.length > 0 &&
      systemAddresses.every((entry) => isPublicRouteNetworkAddress(entry.address))
    ) {
      return systemAddresses;
    }

    try {
      return await this.publicResolver.resolve(normalizedHostname);
    } catch (publicError) {
      if (systemAddresses !== null) return systemAddresses;
      throw systemError ?? publicError;
    }
  }
}

function classifyHttpsError(error: unknown): PublicRouteHttpProbeErrorKind {
  const record = error as NodeJS.ErrnoException & { code?: string };
  const code = String(record?.code ?? "").toUpperCase();
  const message = error instanceof Error ? error.message.toUpperCase() : "";
  if (code === "CHATCOCKPIT_ROUTE_TIMEOUT") return "timeout";
  if (code === "CHATCOCKPIT_ROUTE_RESPONSE_TOO_LARGE") return "response-too-large";
  if (
    code.startsWith("ERR_TLS") ||
    code.includes("CERT") ||
    code.includes("SSL") ||
    message.includes("CERTIFICATE") ||
    message.includes("TLS")
  ) {
    return "tls-error";
  }
  return "network-error";
}

export class NodePublicRouteHttpProbe implements PublicRouteHttpProbe {
  async get(input: PublicRouteHttpProbeInput): Promise<PublicRouteHttpResponse> {
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: input.address, family: input.family }]);
        return;
      }
      callback(null, input.address, input.family);
    };

    return await new Promise<PublicRouteHttpResponse>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        const kind = classifyHttpsError(error);
        reject(new PublicRouteHttpProbeError(kind, `Candidate HTTPS probe failed: ${kind}`));
      };

      const request = https.request(
        {
          protocol: "https:",
          hostname: input.hostname,
          port: input.port,
          method: "GET",
          path: input.path,
          lookup: pinnedLookup,
          agent: false,
          rejectUnauthorized: true,
          ...(isIP(input.hostname) === 0 ? { servername: input.hostname } : {}),
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "identity",
            "User-Agent": "ChatCockpit-Connectivity-Verifier"
          }
        },
        (response) => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          response.on("data", (chunk: Buffer | string) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buffer.length;
            if (totalBytes > input.maxBytes) {
              const error = Object.assign(new Error("Candidate response exceeded the bounded body limit"), {
                code: "CHATCOCKPIT_ROUTE_RESPONSE_TOO_LARGE"
              });
              request.destroy(error);
              return;
            }
            chunks.push(buffer);
          });
          response.on("end", () => {
            if (settled) return;
            settled = true;
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8")
            });
          });
          response.on("error", fail);
        }
      );

      request.setTimeout(input.timeoutMs, () => {
        const error = Object.assign(new Error("Candidate HTTPS probe timed out"), {
          code: "CHATCOCKPIT_ROUTE_TIMEOUT"
        });
        request.destroy(error);
      });
      request.on("error", fail);
      request.end();
    });
  }
}

interface PersistedVerificationEnvelope {
  schemaVersion: typeof PUBLIC_ROUTE_VERIFICATION_SCHEMA_VERSION;
  verification: PublicRouteVerificationArtifact;
}

function check(value: unknown): PublicRouteVerificationCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRouteVerificationError(
      "verification-state-invalid",
      "Candidate Public Route verification state is invalid"
    );
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean") {
    throw new PublicRouteVerificationError(
      "verification-state-invalid",
      "Candidate Public Route verification check is invalid"
    );
  }
  const reason = record.reason;
  if (!(reason === null || typeof reason === "string")) {
    throw new PublicRouteVerificationError(
      "verification-state-invalid",
      "Candidate Public Route verification reason is invalid"
    );
  }
  return {
    ok: record.ok,
    reason: reason as PublicRouteVerificationReason | null,
    ...(typeof record.statusCode === "number" ? { statusCode: record.statusCode } : {}),
    ...(typeof record.publicAddressCount === "number"
      ? { publicAddressCount: record.publicAddressCount }
      : {})
  };
}

function parseArtifact(value: unknown): PublicRouteVerificationArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRouteVerificationError(
      "verification-state-invalid",
      "Candidate Public Route verification artifact is invalid"
    );
  }
  const record = value as Record<string, unknown>;
  const checks = record.checks as Record<string, unknown> | undefined;
  if (
    typeof record.id !== "string" || !record.id.trim() ||
    typeof record.candidateId !== "string" || !record.candidateId.trim() ||
    typeof record.candidateOrigin !== "string" || !record.candidateOrigin.trim() ||
    (record.status !== "verified" && record.status !== "failed") ||
    typeof record.checkedAt !== "string" || !record.checkedAt.trim() ||
    !checks
  ) {
    throw new PublicRouteVerificationError(
      "verification-state-invalid",
      "Candidate Public Route verification artifact is invalid"
    );
  }
  return {
    id: record.id,
    candidateId: record.candidateId,
    candidateOrigin: record.candidateOrigin,
    status: record.status,
    checkedAt: record.checkedAt,
    checks: {
      dns: check(checks.dns),
      tls: check(checks.tls),
      reachability: check(checks.reachability),
      identity: check(checks.identity),
      oauth: check(checks.oauth)
    }
  };
}

export class PublicRouteVerificationStore {
  private readonly statePath: string;
  private readonly runtimeDir: string;

  constructor(options: { runtimeDir: string }) {
    this.runtimeDir = options.runtimeDir;
    this.statePath = path.join(options.runtimeDir, VERIFICATION_FILE_NAME);
  }

  read(): PublicRouteVerificationArtifact | null {
    let text: string;
    try {
      text = fs.readFileSync(this.statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PublicRouteVerificationError(
        "verification-state-invalid",
        "Candidate Public Route verification state is invalid"
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PublicRouteVerificationError(
        "verification-state-invalid",
        "Candidate Public Route verification state is invalid"
      );
    }
    const envelope = parsed as Partial<PersistedVerificationEnvelope>;
    if (envelope.schemaVersion !== PUBLIC_ROUTE_VERIFICATION_SCHEMA_VERSION) {
      throw new PublicRouteVerificationError(
        "verification-state-invalid",
        "Candidate Public Route verification schema is unsupported"
      );
    }
    return parseArtifact(envelope.verification);
  }

  clear(): void {
    try {
      fs.unlinkSync(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  write(verification: PublicRouteVerificationArtifact): void {
    fs.mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    const envelope: PersistedVerificationEnvelope = {
      schemaVersion: PUBLIC_ROUTE_VERIFICATION_SCHEMA_VERSION,
      verification
    };
    fs.writeFileSync(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, this.statePath);
    fs.chmodSync(this.statePath, 0o600);
  }
}

export interface PublicRouteVerifierOptions {
  candidateStore: PublicRouteCandidateStore;
  verificationStore: PublicRouteVerificationStore;
  resolver?: PublicRouteResolver;
  probe?: PublicRouteHttpProbe;
  now?: () => string;
  createId?: () => string;
  timeoutMs?: number;
  maxBytes?: number;
}

function notAttempted(): PublicRouteVerificationCheck {
  return { ok: false, reason: "not-attempted" };
}

function initialChecks(): PublicRouteVerificationChecks {
  return {
    dns: notAttempted(),
    tls: notAttempted(),
    reachability: notAttempted(),
    identity: notAttempted(),
    oauth: notAttempted()
  };
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validHealthContract(
  body: string,
  canonicalOrigin: string | null
): boolean {
  const record = parseJsonObject(body);
  const expectedOpenApiUrl = canonicalOrigin
    ? `${canonicalOrigin.replace(/\/+$/, "")}/openapi.yaml`
    : "/openapi.yaml";
  return Boolean(
    record &&
    record.ok === true &&
    record.mode === "phase2-dual-mode" &&
    typeof record.authRequired === "boolean" &&
    typeof record.exposed === "boolean" &&
    record.publicBaseUrl === canonicalOrigin &&
    record.openapiUrl === expectedOpenApiUrl
  );
}

function validOAuthMetadata(
  body: string,
  canonicalOrigin: string | null
): boolean {
  if (!canonicalOrigin) return false;
  const record = parseJsonObject(body);
  const authorizationServers = record?.authorization_servers;
  const scopes = record?.scopes_supported;
  const normalizedCanonical = canonicalOrigin.replace(/\/+$/, "");
  return Boolean(
    record &&
    record.resource === `${normalizedCanonical}/mcp` &&
    Array.isArray(authorizationServers) &&
    authorizationServers.length === 1 &&
    authorizationServers[0] === normalizedCanonical &&
    Array.isArray(scopes) &&
    scopes.includes("chatcockpit:mcp")
  );
}

function publicSafeProbeReason(error: unknown): PublicRouteVerificationReason {
  if (error instanceof PublicRouteHttpProbeError) return error.kind;
  return "network-error";
}

export class PublicRouteVerifier {
  private readonly candidateStore: PublicRouteCandidateStore;
  private readonly verificationStore: PublicRouteVerificationStore;
  private readonly resolver: PublicRouteResolver;
  private readonly probe: PublicRouteHttpProbe;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: PublicRouteVerifierOptions) {
    this.candidateStore = options.candidateStore;
    this.verificationStore = options.verificationStore;
    this.resolver = options.resolver ?? new NodePublicRouteResolver();
    this.probe = options.probe ?? new NodePublicRouteHttpProbe();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  snapshot(): PublicRouteVerificationSnapshot {
    const route = this.candidateStore.snapshot();
    const stored = this.verificationStore.read();
    return {
      ok: true,
      schemaVersion: PUBLIC_ROUTE_VERIFICATION_SCHEMA_VERSION,
      canonical: route.canonical,
      candidate: route.candidate,
      verification: route.candidate && stored?.candidateId === route.candidate.id
        ? stored
        : null
    };
  }

  async verify(candidateId: string): Promise<PublicRouteVerificationResult> {
    const route = this.candidateStore.snapshot();
    const candidate = route.candidate;
    if (!candidate || candidate.id !== candidateId) {
      throw new PublicRouteVerificationError(
        "candidate-stale",
        "Candidate Public Route identity no longer matches the staged candidate"
      );
    }

    const url = new URL(candidate.origin);
    const hostname = normalizeVerificationHostname(url.hostname);
    const port = url.port ? Number(url.port) : 443;
    const checks = initialChecks();
    let addresses: PublicRouteResolvedAddress[];

    try {
      addresses = await this.resolver.resolve(hostname);
    } catch {
      checks.dns = { ok: false, reason: "dns-failed" };
      return this.persist(candidate, checks, "failed");
    }

    if (addresses.length === 0) {
      checks.dns = { ok: false, reason: "no-addresses" };
      return this.persist(candidate, checks, "failed");
    }
    if (addresses.length > MAX_RESOLVED_ADDRESSES) {
      checks.dns = { ok: false, reason: "too-many-addresses" };
      return this.persist(candidate, checks, "failed");
    }
    if (addresses.some((entry) => !isPublicRouteNetworkAddress(entry.address))) {
      checks.dns = { ok: false, reason: "non-public-address" };
      return this.persist(candidate, checks, "failed");
    }
    checks.dns = {
      ok: true,
      reason: null,
      publicAddressCount: addresses.length
    };

    let health: PublicRouteHttpResponse;
    try {
      health = await this.probePinned(hostname, port, HEALTH_PATH, addresses);
      checks.tls = { ok: true, reason: null };
    } catch (error) {
      const reason = publicSafeProbeReason(error);
      checks.tls = {
        ok: false,
        reason: reason === "tls-error" ? "tls-error" : "not-attempted"
      };
      checks.reachability = { ok: false, reason };
      return this.persist(candidate, checks, "failed");
    }

    if (health.statusCode !== 200) {
      checks.reachability = {
        ok: false,
        reason: "unexpected-status",
        statusCode: health.statusCode
      };
      return this.persist(candidate, checks, "failed");
    }
    checks.reachability = { ok: true, reason: null, statusCode: health.statusCode };

    const healthObject = parseJsonObject(health.body);
    if (!healthObject) {
      checks.identity = { ok: false, reason: "invalid-json" };
      return this.persist(candidate, checks, "failed");
    }
    if (!validHealthContract(health.body, route.canonical.origin)) {
      checks.identity = { ok: false, reason: "unexpected-health-contract" };
      return this.persist(candidate, checks, "failed");
    }
    checks.identity = { ok: true, reason: null };

    let oauth: PublicRouteHttpResponse;
    try {
      oauth = await this.probePinned(hostname, port, OAUTH_METADATA_PATH, addresses);
    } catch (error) {
      checks.oauth = { ok: false, reason: publicSafeProbeReason(error) };
      return this.persist(candidate, checks, "failed");
    }
    if (oauth.statusCode !== 200) {
      checks.oauth = {
        ok: false,
        reason: "unexpected-status",
        statusCode: oauth.statusCode
      };
      return this.persist(candidate, checks, "failed");
    }
    const oauthObject = parseJsonObject(oauth.body);
    if (!oauthObject) {
      checks.oauth = { ok: false, reason: "invalid-json", statusCode: oauth.statusCode };
      return this.persist(candidate, checks, "failed");
    }
    if (!validOAuthMetadata(oauth.body, route.canonical.origin)) {
      checks.oauth = {
        ok: false,
        reason: "unexpected-oauth-metadata",
        statusCode: oauth.statusCode
      };
      return this.persist(candidate, checks, "failed");
    }
    checks.oauth = { ok: true, reason: null, statusCode: oauth.statusCode };

    return this.persist(candidate, checks, "verified");
  }

  private async probePinned(
    hostname: string,
    port: number,
    requestPath: string,
    addresses: PublicRouteResolvedAddress[]
  ): Promise<PublicRouteHttpResponse> {
    let lastError: unknown = null;
    for (const address of addresses) {
      try {
        return await this.probe.get({
          hostname,
          address: address.address,
          family: address.family,
          port,
          path: requestPath,
          timeoutMs: this.timeoutMs,
          maxBytes: this.maxBytes
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new PublicRouteHttpProbeError("network-error", "Candidate HTTPS probe failed");
  }

  private persist(
    candidate: PublicRouteCandidate,
    checks: PublicRouteVerificationChecks,
    status: PublicRouteVerificationStatus
  ): PublicRouteVerificationResult {
    const current = this.candidateStore.snapshot();
    if (!current.candidate || current.candidate.id !== candidate.id) {
      throw new PublicRouteVerificationError(
        "candidate-stale",
        "Candidate Public Route changed while verification was running"
      );
    }
    const verification: PublicRouteVerificationArtifact = {
      id: this.createId(),
      candidateId: candidate.id,
      candidateOrigin: candidate.origin,
      status,
      checkedAt: this.now(),
      checks
    };
    this.verificationStore.write(verification);
    const completesPendingCutover =
      status === "verified" && current.canonical.origin === candidate.origin;
    if (completesPendingCutover) {
      this.candidateStore.clear();
    }
    return {
      ok: true,
      schemaVersion: PUBLIC_ROUTE_VERIFICATION_SCHEMA_VERSION,
      canonical: current.canonical,
      candidate: completesPendingCutover ? null : current.candidate,
      verification
    };
  }
}
