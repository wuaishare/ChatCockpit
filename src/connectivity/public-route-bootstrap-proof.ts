import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  PublicRouteCandidateStore,
  type PublicRouteCandidate,
  type PublicRouteCanonicalProjection
} from "./public-route-candidate.js";
import {
  NodePublicRouteHttpProbe,
  NodePublicRouteResolver,
  PublicRouteHttpProbeError,
  isPublicRouteNetworkAddress,
  type PublicRouteHttpProbe,
  type PublicRouteHttpResponse,
  type PublicRouteResolvedAddress,
  type PublicRouteResolver
} from "./public-route-verification.js";

export const PUBLIC_ROUTE_BOOTSTRAP_PROOF_SCHEMA_VERSION = 1 as const;

const BOOTSTRAP_PROOF_FILE_NAME = "connectivity-route-bootstrap-proof.json";
const PREPARED_TTL_MS = 5 * 60 * 1000;
const VERIFIED_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 4 * 1024;
const MAX_RESOLVED_ADDRESSES = 16;
const BOOTSTRAP_PROOF_PATH_PREFIX = "/.well-known/chatcockpit-bootstrap-proof/";

export type PublicRouteBootstrapProofStatus = "prepared" | "verified";
export type PublicRouteBootstrapVerificationStatus = "verified" | "failed";
export type PublicRouteBootstrapVerificationReason =
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
  | "proof-mismatch";

const BOOTSTRAP_VERIFICATION_REASONS = new Set<PublicRouteBootstrapVerificationReason>([
  "not-attempted",
  "dns-failed",
  "no-addresses",
  "too-many-addresses",
  "non-public-address",
  "tls-error",
  "network-error",
  "timeout",
  "response-too-large",
  "unexpected-status",
  "proof-mismatch"
]);

export interface PublicRouteBootstrapVerificationCheck {
  ok: boolean;
  reason: PublicRouteBootstrapVerificationReason | null;
  statusCode?: number | null;
  publicAddressCount?: number;
}

export interface PublicRouteBootstrapVerificationChecks {
  dns: PublicRouteBootstrapVerificationCheck;
  tls: PublicRouteBootstrapVerificationCheck;
  reachability: PublicRouteBootstrapVerificationCheck;
  identity: PublicRouteBootstrapVerificationCheck;
}

export interface PublicRouteBootstrapVerificationArtifact {
  id: string;
  status: PublicRouteBootstrapVerificationStatus;
  checkedAt: string;
  checks: PublicRouteBootstrapVerificationChecks;
}

export interface PublicRouteBootstrapProof {
  id: string;
  candidateId: string;
  candidateOrigin: string;
  status: PublicRouteBootstrapProofStatus;
  preparedAt: string;
  expiresAt: string;
  verifiedAt: string | null;
  verification: PublicRouteBootstrapVerificationArtifact | null;
}

export interface PublicRouteBootstrapProofSnapshot {
  ok: true;
  schemaVersion: typeof PUBLIC_ROUTE_BOOTSTRAP_PROOF_SCHEMA_VERSION;
  canonical: PublicRouteCanonicalProjection;
  candidate: PublicRouteCandidate | null;
  proof: PublicRouteBootstrapProof | null;
}

interface PersistedBootstrapProof extends PublicRouteBootstrapProof {
  challenge: string | null;
}

interface PersistedBootstrapProofEnvelope {
  schemaVersion: typeof PUBLIC_ROUTE_BOOTSTRAP_PROOF_SCHEMA_VERSION;
  proof: PersistedBootstrapProof;
}

export type PublicRouteBootstrapProofErrorCode =
  | "canonical-already-configured"
  | "candidate-stale"
  | "proof-stale"
  | "proof-not-verified"
  | "proof-state-invalid";

export class PublicRouteBootstrapProofError extends Error {
  constructor(
    readonly code: PublicRouteBootstrapProofErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PublicRouteBootstrapProofError";
  }
}

export type PublicRouteBootstrapResolvedAddress = PublicRouteResolvedAddress;
export type PublicRouteBootstrapProofResolver = PublicRouteResolver;
export type PublicRouteBootstrapProofHttpProbe = PublicRouteHttpProbe;
export type PublicRouteBootstrapProofHttpResponse = PublicRouteHttpResponse;

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      `Public Route Bootstrap Proof ${field} is invalid`
    );
  }
  return parsed;
}

function privateAtomicWrite(filePath: string, value: PersistedBootstrapProofEnvelope): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function verificationCheck(value: unknown): PublicRouteBootstrapVerificationCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Public Route Bootstrap Proof verification check is invalid"
    );
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean") {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Public Route Bootstrap Proof verification check is invalid"
    );
  }
  if (
    record.reason !== null &&
    (typeof record.reason !== "string" ||
      !BOOTSTRAP_VERIFICATION_REASONS.has(record.reason as PublicRouteBootstrapVerificationReason))
  ) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Public Route Bootstrap Proof verification reason is invalid"
    );
  }
  return {
    ok: record.ok,
    reason: record.reason as PublicRouteBootstrapVerificationReason | null,
    ...(typeof record.statusCode === "number" ? { statusCode: record.statusCode } : {}),
    ...(typeof record.publicAddressCount === "number"
      ? { publicAddressCount: record.publicAddressCount }
      : {})
  };
}

function parseVerification(value: unknown): PublicRouteBootstrapVerificationArtifact | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Public Route Bootstrap Proof verification artifact is invalid"
    );
  }
  const record = value as Record<string, unknown>;
  const checks = record.checks as Record<string, unknown> | undefined;
  if (
    typeof record.id !== "string" || !record.id.trim() ||
    (record.status !== "verified" && record.status !== "failed") ||
    typeof record.checkedAt !== "string" || !record.checkedAt.trim() ||
    !checks
  ) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Public Route Bootstrap Proof verification artifact is invalid"
    );
  }
  return {
    id: record.id,
    status: record.status,
    checkedAt: record.checkedAt,
    checks: {
      dns: verificationCheck(checks.dns),
      tls: verificationCheck(checks.tls),
      reachability: verificationCheck(checks.reachability),
      identity: verificationCheck(checks.identity)
    }
  };
}

function parsePersistedProof(value: unknown): PersistedBootstrapProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Public Route Bootstrap Proof state is invalid"
    );
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" || !record.id.trim() ||
    typeof record.candidateId !== "string" || !record.candidateId.trim() ||
    typeof record.candidateOrigin !== "string" || !record.candidateOrigin.trim() ||
    (record.status !== "prepared" && record.status !== "verified") ||
    typeof record.preparedAt !== "string" || !record.preparedAt.trim() ||
    typeof record.expiresAt !== "string" || !record.expiresAt.trim() ||
    !(record.verifiedAt === null || typeof record.verifiedAt === "string") ||
    !(record.challenge === null || typeof record.challenge === "string")
  ) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Public Route Bootstrap Proof state is invalid"
    );
  }
  parseTimestamp(record.preparedAt, "preparedAt");
  parseTimestamp(record.expiresAt, "expiresAt");
  if (typeof record.verifiedAt === "string") parseTimestamp(record.verifiedAt, "verifiedAt");
  const verification = parseVerification(record.verification);
  if (record.status === "prepared" && !(typeof record.challenge === "string" && record.challenge.length >= 32)) {
    throw new PublicRouteBootstrapProofError(
      "proof-state-invalid",
      "Prepared Public Route Bootstrap Proof has no valid challenge"
    );
  }
  if (record.status === "verified") {
    if (record.challenge !== null || record.verifiedAt === null || verification?.status !== "verified") {
      throw new PublicRouteBootstrapProofError(
        "proof-state-invalid",
        "Verified Public Route Bootstrap Proof state is inconsistent"
      );
    }
  }
  return {
    id: record.id,
    candidateId: record.candidateId,
    candidateOrigin: record.candidateOrigin,
    status: record.status,
    preparedAt: record.preparedAt,
    expiresAt: record.expiresAt,
    verifiedAt: record.verifiedAt,
    verification,
    challenge: record.challenge
  };
}

function bootstrapVerificationFullyPassed(
  verification: PublicRouteBootstrapVerificationArtifact | null
): verification is PublicRouteBootstrapVerificationArtifact {
  return Boolean(
    verification &&
    verification.status === "verified" &&
    verification.checks.dns.ok &&
    verification.checks.tls.ok &&
    verification.checks.reachability.ok &&
    verification.checks.identity.ok
  );
}

function publicProof(record: PersistedBootstrapProof): PublicRouteBootstrapProof {
  return {
    id: record.id,
    candidateId: record.candidateId,
    candidateOrigin: record.candidateOrigin,
    status: record.status,
    preparedAt: record.preparedAt,
    expiresAt: record.expiresAt,
    verifiedAt: record.verifiedAt,
    verification: record.verification
  };
}

export class PublicRouteBootstrapProofStore {
  private readonly statePath: string;
  private readonly candidateStore: PublicRouteCandidateStore;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly createChallenge: () => string;

  constructor(options: {
    runtimeDir: string;
    candidateStore: PublicRouteCandidateStore;
    now?: () => string;
    createId?: () => string;
    createChallenge?: () => string;
  }) {
    this.statePath = path.join(options.runtimeDir, BOOTSTRAP_PROOF_FILE_NAME);
    this.candidateStore = options.candidateStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? crypto.randomUUID;
    this.createChallenge = options.createChallenge ?? (() => crypto.randomBytes(32).toString("base64url"));
  }

  snapshot(): PublicRouteBootstrapProofSnapshot {
    const route = this.candidateStore.snapshot();
    const record = this.readCurrentRecord(route);
    return {
      ok: true,
      schemaVersion: PUBLIC_ROUTE_BOOTSTRAP_PROOF_SCHEMA_VERSION,
      canonical: route.canonical,
      candidate: route.candidate,
      proof: record ? publicProof(record) : null
    };
  }

  prepare(candidateId: string): PublicRouteBootstrapProofSnapshot {
    const route = this.candidateStore.snapshot();
    if (route.canonical.origin) {
      throw new PublicRouteBootstrapProofError(
        "canonical-already-configured",
        "Public Route Bootstrap Proof is only available before the first canonical Public Route is configured"
      );
    }
    const candidate = route.candidate;
    if (!candidate || candidate.id !== candidateId) {
      throw new PublicRouteBootstrapProofError(
        "candidate-stale",
        "Candidate Public Route identity no longer matches the staged bootstrap candidate"
      );
    }
    const preparedAt = this.now();
    const preparedAtMs = parseTimestamp(preparedAt, "preparedAt");
    const challenge = this.createChallenge();
    if (challenge.length < 32) {
      throw new PublicRouteBootstrapProofError(
        "proof-state-invalid",
        "Public Route Bootstrap Proof challenge generator returned an invalid value"
      );
    }
    const record: PersistedBootstrapProof = {
      id: this.createId(),
      candidateId: candidate.id,
      candidateOrigin: candidate.origin,
      status: "prepared",
      preparedAt,
      expiresAt: new Date(preparedAtMs + PREPARED_TTL_MS).toISOString(),
      verifiedAt: null,
      verification: null,
      challenge
    };
    this.write(record);
    return this.snapshot();
  }

  cancel(): PublicRouteBootstrapProofSnapshot {
    this.clear();
    return this.snapshot();
  }

  consumeVerified(proofId: string): PublicRouteBootstrapProof {
    const route = this.candidateStore.snapshot();
    const record = this.readCurrentRecord(route);
    if (!record || record.id !== proofId) {
      throw new PublicRouteBootstrapProofError(
        "proof-stale",
        "Verified Public Route Bootstrap Proof is no longer available for Machine execution"
      );
    }
    if (record.status !== "verified" || !bootstrapVerificationFullyPassed(record.verification)) {
      throw new PublicRouteBootstrapProofError(
        "proof-not-verified",
        "Public Route Bootstrap Proof must be fully verified before Machine execution"
      );
    }
    const proof = publicProof(record);
    this.clear();
    return proof;
  }

  challengeForRequest(proofId: string): string | null {
    const route = this.candidateStore.snapshot();
    const record = this.readCurrentRecord(route);
    if (!record || record.id !== proofId || record.status !== "prepared") return null;
    return record.challenge;
  }

  preparedForVerification(input: {
    proofId: string;
    candidateId: string;
  }): { proof: PublicRouteBootstrapProof; challenge: string } {
    const route = this.candidateStore.snapshot();
    const record = this.readCurrentRecord(route);
    if (
      !record ||
      record.id !== input.proofId ||
      record.status !== "prepared" ||
      record.candidateId !== input.candidateId ||
      !record.challenge
    ) {
      throw new PublicRouteBootstrapProofError(
        "proof-stale",
        "Public Route Bootstrap Proof is no longer available for this candidate"
      );
    }
    return { proof: publicProof(record), challenge: record.challenge };
  }

  recordVerification(input: {
    proofId: string;
    candidateId: string;
    verification: PublicRouteBootstrapVerificationArtifact;
  }): PublicRouteBootstrapProofSnapshot {
    const route = this.candidateStore.snapshot();
    const record = this.readCurrentRecord(route);
    if (
      !record ||
      record.id !== input.proofId ||
      record.status !== "prepared" ||
      record.candidateId !== input.candidateId
    ) {
      throw new PublicRouteBootstrapProofError(
        "proof-stale",
        "Public Route Bootstrap Proof changed while verification was running"
      );
    }
    if (input.verification.status === "verified") {
      const verifiedAt = input.verification.checkedAt;
      const verifiedAtMs = parseTimestamp(verifiedAt, "verifiedAt");
      this.write({
        ...record,
        status: "verified",
        verifiedAt,
        expiresAt: new Date(verifiedAtMs + VERIFIED_TTL_MS).toISOString(),
        verification: input.verification,
        challenge: null
      });
    } else {
      this.write({
        ...record,
        verification: input.verification
      });
    }
    return this.snapshot();
  }

  private readCurrentRecord(route: ReturnType<PublicRouteCandidateStore["snapshot"]>): PersistedBootstrapProof | null {
    const record = this.readRecord();
    if (!record) return null;
    const nowMs = parseTimestamp(this.now(), "clock");
    const expired = nowMs > parseTimestamp(record.expiresAt, "expiresAt");
    const candidate = route.candidate;
    const invalidated =
      Boolean(route.canonical.origin) ||
      !candidate ||
      candidate.id !== record.candidateId ||
      candidate.origin !== record.candidateOrigin;
    if (expired || invalidated) {
      this.clear();
      return null;
    }
    return record;
  }

  private readRecord(): PersistedBootstrapProof | null {
    let source: string;
    try {
      source = fs.readFileSync(this.statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new PublicRouteBootstrapProofError(
        "proof-state-invalid",
        "Public Route Bootstrap Proof state is not valid JSON"
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PublicRouteBootstrapProofError(
        "proof-state-invalid",
        "Public Route Bootstrap Proof state is invalid"
      );
    }
    const envelope = parsed as Partial<PersistedBootstrapProofEnvelope>;
    if (envelope.schemaVersion !== PUBLIC_ROUTE_BOOTSTRAP_PROOF_SCHEMA_VERSION) {
      throw new PublicRouteBootstrapProofError(
        "proof-state-invalid",
        "Public Route Bootstrap Proof schema is unsupported"
      );
    }
    return parsePersistedProof(envelope.proof);
  }

  private write(proof: PersistedBootstrapProof): void {
    privateAtomicWrite(this.statePath, {
      schemaVersion: PUBLIC_ROUTE_BOOTSTRAP_PROOF_SCHEMA_VERSION,
      proof
    });
  }

  private clear(): void {
    try {
      fs.unlinkSync(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function emptyCheck(): PublicRouteBootstrapVerificationCheck {
  return { ok: false, reason: "not-attempted" };
}

function initialChecks(): PublicRouteBootstrapVerificationChecks {
  return {
    dns: emptyCheck(),
    tls: emptyCheck(),
    reachability: emptyCheck(),
    identity: emptyCheck()
  };
}

function publicSafeProbeReason(error: unknown): PublicRouteBootstrapVerificationReason {
  if (error instanceof PublicRouteHttpProbeError) return error.kind;
  return "network-error";
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export class PublicRouteBootstrapVerifier {
  private readonly candidateStore: PublicRouteCandidateStore;
  private readonly proofStore: PublicRouteBootstrapProofStore;
  private readonly resolver: PublicRouteBootstrapProofResolver;
  private readonly probe: PublicRouteBootstrapProofHttpProbe;
  private readonly now: () => string;
  private readonly createVerificationId: () => string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: {
    candidateStore: PublicRouteCandidateStore;
    proofStore: PublicRouteBootstrapProofStore;
    resolver?: PublicRouteBootstrapProofResolver;
    probe?: PublicRouteBootstrapProofHttpProbe;
    now?: () => string;
    createVerificationId?: () => string;
    timeoutMs?: number;
    maxBytes?: number;
  }) {
    this.candidateStore = options.candidateStore;
    this.proofStore = options.proofStore;
    this.resolver = options.resolver ?? new NodePublicRouteResolver();
    this.probe = options.probe ?? new NodePublicRouteHttpProbe();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createVerificationId = options.createVerificationId ?? crypto.randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async verify(input: {
    proofId: string;
    candidateId: string;
  }): Promise<PublicRouteBootstrapProofSnapshot> {
    const prepared = this.proofStore.preparedForVerification(input);
    const route = this.candidateStore.snapshot();
    if (route.canonical.origin || !route.candidate || route.candidate.id !== input.candidateId) {
      throw new PublicRouteBootstrapProofError(
        "proof-stale",
        "Public Route Bootstrap Proof candidate changed before verification"
      );
    }
    const candidate = route.candidate;
    const url = new URL(candidate.origin);
    const hostname = normalizeHostname(url.hostname);
    const port = url.port ? Number(url.port) : 443;
    const checks = initialChecks();
    let addresses: PublicRouteBootstrapResolvedAddress[];

    try {
      addresses = await this.resolver.resolve(hostname);
    } catch {
      checks.dns = { ok: false, reason: "dns-failed" };
      return this.persistFailed(input, checks);
    }
    if (addresses.length === 0) {
      checks.dns = { ok: false, reason: "no-addresses" };
      return this.persistFailed(input, checks);
    }
    if (addresses.length > MAX_RESOLVED_ADDRESSES) {
      checks.dns = { ok: false, reason: "too-many-addresses" };
      return this.persistFailed(input, checks);
    }
    if (addresses.some((entry) => !isPublicRouteNetworkAddress(entry.address))) {
      checks.dns = { ok: false, reason: "non-public-address" };
      return this.persistFailed(input, checks);
    }
    checks.dns = { ok: true, reason: null, publicAddressCount: addresses.length };

    let response: PublicRouteBootstrapProofHttpResponse;
    try {
      response = await this.probePinned(
        hostname,
        port,
        `${BOOTSTRAP_PROOF_PATH_PREFIX}${encodeURIComponent(prepared.proof.id)}`,
        addresses
      );
      checks.tls = { ok: true, reason: null };
    } catch (error) {
      const reason = publicSafeProbeReason(error);
      checks.tls = {
        ok: false,
        reason: reason === "tls-error" ? "tls-error" : "not-attempted"
      };
      checks.reachability = { ok: false, reason };
      return this.persistFailed(input, checks);
    }

    if (response.statusCode !== 200) {
      checks.reachability = {
        ok: false,
        reason: "unexpected-status",
        statusCode: response.statusCode
      };
      return this.persistFailed(input, checks);
    }
    checks.reachability = { ok: true, reason: null, statusCode: response.statusCode };

    if (response.body !== prepared.challenge) {
      checks.identity = { ok: false, reason: "proof-mismatch" };
      return this.persistFailed(input, checks);
    }
    checks.identity = { ok: true, reason: null };

    return this.proofStore.recordVerification({
      ...input,
      verification: {
        id: this.createVerificationId(),
        status: "verified",
        checkedAt: this.now(),
        checks
      }
    });
  }

  private async probePinned(
    hostname: string,
    port: number,
    requestPath: string,
    addresses: PublicRouteBootstrapResolvedAddress[]
  ): Promise<PublicRouteBootstrapProofHttpResponse> {
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
    throw lastError ?? new PublicRouteHttpProbeError("network-error", "Bootstrap HTTPS proof failed");
  }

  private persistFailed(
    input: { proofId: string; candidateId: string },
    checks: PublicRouteBootstrapVerificationChecks
  ): PublicRouteBootstrapProofSnapshot {
    return this.proofStore.recordVerification({
      ...input,
      verification: {
        id: this.createVerificationId(),
        status: "failed",
        checkedAt: this.now(),
        checks
      }
    });
  }
}

export function bootstrapProofPath(proofId: string): string {
  return `${BOOTSTRAP_PROOF_PATH_PREFIX}${encodeURIComponent(proofId)}`;
}

export function isBootstrapProofPath(pathname: string): boolean {
  return pathname.startsWith(BOOTSTRAP_PROOF_PATH_PREFIX) && pathname.length > BOOTSTRAP_PROOF_PATH_PREFIX.length;
}

export function bootstrapProofIdFromPath(pathname: string): string | null {
  if (!isBootstrapProofPath(pathname)) return null;
  const encoded = pathname.slice(BOOTSTRAP_PROOF_PATH_PREFIX.length);
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded && !decoded.includes("/") ? decoded : null;
  } catch {
    return null;
  }
}
