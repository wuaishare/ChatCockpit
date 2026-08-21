import crypto from "node:crypto";

import {
  buildDeviceChannelOpenProof,
  buildDeviceChannelResultProof,
  buildDeviceEnrollmentProof,
  buildDeviceEnrollmentStatusProof,
  buildDeviceHeartbeatProof,
  type DeviceEnrollmentStatus
} from "./device-registry.js";
import {
  addVerifiedDeviceAgentHubOrigin,
  clearDeviceAgentPendingEnrollment,
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  markDeviceAgentHeartbeatAccepted,
  markDeviceAgentRevoked,
  normalizeDeviceHubOrigin,
  pinDeviceAgentHubIdentity,
  projectDeviceAgentStatus,
  readDeviceAgentState,
  reserveDeviceHeartbeatSequence,
  setDeviceAgentPendingEnrollment,
  type DeviceAgentHubIdentityInput,
  type DeviceAgentStatusProjection,
  type DeviceAgentStateRecord
} from "./device-agent-state.js";
import { DeviceAgentCapabilityService } from "./device-agent-capability-service.js";
import type {
  DeviceCapabilityRequestEnvelope,
  DeviceCapabilityResultBody
} from "./device-capability-rpc.js";
import {
  DeviceAgentTransportError,
  HttpDeviceAgentTransport,
  type DeviceAgentChannelConnection,
  type DeviceAgentChannelEvent,
  type DeviceAgentTransport
} from "./device-agent-transport.js";
import { verifyHubIdentityProof } from "./hub-identity.js";
import { verifyLanTlsCertificateProof } from "./lan-tls-identity.js";
import {
  markDeviceAgentLanRouteSuccessful,
  projectDeviceAgentLanRoute,
  readDeviceAgentLanRoute,
  writeVerifiedDeviceAgentLanRoute,
  type DeviceAgentLanRouteRecord
} from "./device-agent-lan-route.js";
import {
  CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
  parseLanDiscoveryCandidate,
  type LanDiscoveryCandidate
} from "./lan-discovery.js";

export interface DeviceAgentUnconfiguredStatus {
  configured: false;
  state: "unconfigured";
}

export type DeviceAgentStatus = DeviceAgentStatusProjection | DeviceAgentUnconfiguredStatus;

export interface DeviceAgentRouteStatus {
  preference: "lan" | "public";
  lan: {
    configured: boolean;
    security: "pinned-tls" | null;
    verifiedAt: string | null;
    lastSuccessfulAt: string | null;
    certificateFingerprint: string | null;
  };
  public: {
    configured: boolean;
  };
}

export const DEVICE_AGENT_DEFAULT_INTERVAL_MS = 30_000;
export const DEVICE_AGENT_MIN_INTERVAL_MS = 5_000;
export const DEVICE_AGENT_MAX_INTERVAL_MS = 5 * 60_000;
const DEVICE_AGENT_RETRY_BASE_MS = 1_000;
const DEVICE_AGENT_RETRY_MAX_MS = 30_000;
const DEVICE_AGENT_LAN_VERIFY_DEFAULT_TIMEOUT_MS = 1_500;
const DEVICE_AGENT_LAN_VERIFY_MIN_TIMEOUT_MS = 250;
const DEVICE_AGENT_LAN_VERIFY_MAX_TIMEOUT_MS = 10_000;

export interface DeviceAgentPendingEnrollment {
  enrollmentId: string;
  verificationCode: string;
  expiresAt: string;
  pollAfterSeconds: number;
}

export interface DeviceAgentEnrollmentPoll {
  enrollmentId: string;
  status: DeviceEnrollmentStatus;
  verificationCode: string | null;
  expiresAt: string;
  decidedAt: string | null;
  deviceId: string | null;
  pollAfterSeconds: number;
}

export class DeviceAgentProtocolError extends Error {
  constructor(
    readonly statusCode: number | null,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DeviceAgentProtocolError";
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepLike = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

interface DeviceAgentCapabilityExecutor {
  execute(request: DeviceCapabilityRequestEnvelope): Promise<DeviceCapabilityResultBody>;
}

interface DeviceAgentServiceOptions {
  runtimeDir: string;
  fetchImpl?: FetchLike;
  transport?: DeviceAgentTransport;
  pinnedTransportFactory?: (certificatePem: string) => DeviceAgentTransport;
  capabilityService?: DeviceAgentCapabilityExecutor;
  directExecutorsConfigPath?: string;
  sleep?: SleepLike;
  now?: () => string;
  random?: () => number;
}

interface DeviceAgentConnectInput {
  hubOrigin: string;
  displayName: string;
  platform?: string;
  architecture?: string;
}

interface DeviceAgentConnectHooks {
  onPending?: (pending: DeviceAgentPendingEnrollment) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface DeviceAgentLoopOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  onHeartbeat?: (status: DeviceAgentStatusProjection) => void | Promise<void>;
  onRetry?: (input: { attempt: number; delayMs: number; error: DeviceAgentProtocolError }) => void | Promise<void>;
}

export interface DeviceAgentChannelLoopOptions {
  signal?: AbortSignal;
  onEvent?: (event: DeviceAgentChannelEvent) => void | Promise<void>;
  onRetry?: (input: { attempt: number; delayMs: number; error: DeviceAgentProtocolError }) => void | Promise<void>;
}

interface DeviceAgentRouteTarget {
  kind: "lan" | "public";
  origin: string;
  transport: DeviceAgentTransport;
  lanRoute: DeviceAgentLanRouteRecord | null;
}

export interface DeviceAgentLanCandidateVerificationOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DeviceAgentVerifiedLanCandidate {
  schemaVersion: 1;
  source: "mdns";
  identityVerified: true;
  controlTransportEligible: boolean;
  transportSecurity: "plaintext-http" | "pinned-tls";
  instanceName: string;
  origin: string;
  address: string;
  port: number;
  secureOrigin: string | null;
  securePort: number | null;
  certificateFingerprint: string | null;
  hubId: string;
  hubPublicKeyFingerprint: string;
  verifiedAt: string;
}

interface EnrollmentCreateBody {
  ok?: unknown;
  enrollment?: {
    id?: unknown;
    displayName?: unknown;
    verificationCode?: unknown;
    expiresAt?: unknown;
    pollAfterSeconds?: unknown;
  };
}

interface EnrollmentStatusBody {
  ok?: unknown;
  enrollment?: {
    id?: unknown;
    status?: unknown;
    verificationCode?: unknown;
    expiresAt?: unknown;
    decidedAt?: unknown;
    deviceId?: unknown;
    pollAfterSeconds?: unknown;
  };
}

interface HeartbeatBody {
  ok?: unknown;
  deviceId?: unknown;
  acceptedSequence?: unknown;
  revision?: unknown;
}

interface HubIdentityProofBody {
  ok?: unknown;
  hubId?: unknown;
  nonce?: unknown;
  signature?: unknown;
}

interface LanTlsIdentityBody {
  ok?: unknown;
  tls?: {
    schemaVersion?: unknown;
    algorithm?: unknown;
    certificate?: unknown;
    certificateFingerprint?: unknown;
    createdAt?: unknown;
    notAfter?: unknown;
  };
}

interface LanTlsProofBody {
  ok?: unknown;
  hubId?: unknown;
  nonce?: unknown;
  certificateFingerprint?: unknown;
  signature?: unknown;
}

interface HubIdentityBody {
  ok?: unknown;
  hub?: {
    schemaVersion?: unknown;
    hubId?: unknown;
    algorithm?: unknown;
    publicKey?: unknown;
    publicKeyFingerprint?: unknown;
    createdAt?: unknown;
  };
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeviceAgentProtocolError(null, "DEVICE_AGENT_ABORTED", "Device Agent operation was cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DeviceAgentProtocolError(null, "DEVICE_AGENT_ABORTED", "Device Agent operation was cancelled"));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const NON_RETRYABLE_PROTOCOL_CODES = new Set([
  "DEVICE_AGENT_CHANNEL_INVALID",
  "DEVICE_AGENT_HUB_IDENTITY_INVALID",
  "DEVICE_AGENT_LAN_TLS_IDENTITY_INVALID",
  "DEVICE_AGENT_RESPONSE_INVALID"
]);

function isRouteUnavailableError(error: DeviceAgentProtocolError): boolean {
  if (error.code === "DEVICE_AGENT_TLS_PIN_MISMATCH") return false;
  if (
    error.code === "DEVICE_AGENT_NETWORK_ERROR" ||
    error.code === "DEVICE_AGENT_CHANNEL_NETWORK_ERROR" ||
    error.code === "DEVICE_AGENT_CHANNEL_CLOSED"
  ) {
    return true;
  }
  return (
    error.statusCode !== null &&
    error.statusCode >= 502 &&
    error.statusCode <= 504 &&
    !NON_RETRYABLE_PROTOCOL_CODES.has(error.code)
  );
}

function isRetryableDeviceAgentError(error: DeviceAgentProtocolError): boolean {
  if (
    error.code === "DEVICE_AGENT_NETWORK_ERROR" ||
    error.code === "DEVICE_AGENT_CHANNEL_NETWORK_ERROR" ||
    error.code === "DEVICE_AGENT_CHANNEL_CLOSED"
  ) {
    return true;
  }
  if (error.statusCode === 429) return true;
  return (
    error.statusCode !== null &&
    error.statusCode >= 500 &&
    !NON_RETRYABLE_PROTOCOL_CODES.has(error.code)
  );
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function requiredEnrollmentId(value: unknown): string {
  if (typeof value !== "string" || !/^cc_enroll_[A-Za-z0-9_-]{20,80}$/.test(value)) {
    throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid enrollment ID");
  }
  return value;
}

function requiredDeviceId(value: unknown): string {
  if (typeof value !== "string" || !/^cc_device_[A-Za-z0-9_-]{20,80}$/.test(value)) {
    throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid device ID");
  }
  return value;
}

function requiredVerificationCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(value)) {
    throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid verification code");
  }
  return value;
}

function requiredPollSeconds(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 60) {
    throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid poll interval");
  }
  return Number(value);
}

function parsePrivateKey(state: DeviceAgentStateRecord): crypto.KeyObject {
  try {
    const key = crypto.createPrivateKey({
      key: Buffer.from(state.privateKeyPkcs8, "base64url"),
      format: "der",
      type: "pkcs8"
    });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("unexpected key type");
    return key;
  } catch {
    throw new DeviceAgentProtocolError(null, "DEVICE_AGENT_IDENTITY_INVALID", "Device Agent private identity is invalid");
  }
}

function sign(state: DeviceAgentStateRecord, message: Buffer): string {
  return crypto.sign(null, message, parsePrivateKey(state)).toString("base64url");
}

function hubIdentityFromResponse(origin: string, body: unknown): DeviceAgentHubIdentityInput {
  const response = body && typeof body === "object" ? body as HubIdentityBody : {};
  const hub = response.hub;
  if (
    response.ok !== true ||
    hub?.schemaVersion !== 1 ||
    hub.algorithm !== "Ed25519" ||
    typeof hub.hubId !== "string" ||
    !/^cc_hub_[A-Za-z0-9_-]{43}$/.test(hub.hubId) ||
    typeof hub.publicKey !== "string" ||
    hub.publicKey.length > 512 ||
    typeof hub.publicKeyFingerprint !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(hub.publicKeyFingerprint) ||
    !validTimestamp(hub.createdAt)
  ) {
    throw new DeviceAgentProtocolError(
      502,
      "DEVICE_AGENT_HUB_IDENTITY_INVALID",
      "Hub returned an invalid public identity"
    );
  }
  return {
    hubOrigin: origin,
    hubId: hub.hubId,
    publicKeySpki: hub.publicKey,
    publicKeyFingerprint: hub.publicKeyFingerprint
  };
}

function lanTlsIdentityFromResponse(body: unknown): {
  certificatePem: string;
  certificateFingerprint: string;
} {
  const response = body && typeof body === "object" ? body as LanTlsIdentityBody : {};
  const tls = response.tls;
  if (
    response.ok !== true ||
    tls?.schemaVersion !== 1 ||
    tls.algorithm !== "P-256" ||
    typeof tls.certificate !== "string" ||
    tls.certificate.length < 200 ||
    tls.certificate.length > 32_768 ||
    typeof tls.certificateFingerprint !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(tls.certificateFingerprint) ||
    !validTimestamp(tls.createdAt) ||
    !validTimestamp(tls.notAfter)
  ) {
    throw new DeviceAgentProtocolError(
      502,
      "DEVICE_AGENT_LAN_TLS_IDENTITY_INVALID",
      "Hub returned an invalid LAN TLS identity"
    );
  }
  let certificate: crypto.X509Certificate;
  try {
    certificate = new crypto.X509Certificate(tls.certificate);
  } catch {
    throw new DeviceAgentProtocolError(
      502,
      "DEVICE_AGENT_LAN_TLS_IDENTITY_INVALID",
      "Hub returned an invalid LAN TLS certificate"
    );
  }
  const fingerprint = crypto.createHash("sha256").update(certificate.raw).digest("base64url");
  if (fingerprint !== tls.certificateFingerprint) {
    throw new DeviceAgentProtocolError(
      502,
      "DEVICE_AGENT_LAN_TLS_IDENTITY_INVALID",
      "Hub LAN TLS certificate fingerprint does not match the certificate"
    );
  }
  return {
    certificatePem: tls.certificate,
    certificateFingerprint: fingerprint
  };
}

function lanCandidateOrigin(address: string, port: number): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${port}`;
}

function lanSecureOrigin(address: string, port: number): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `https://${host}:${port}`;
}

function normalizeLanVerificationTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEVICE_AGENT_LAN_VERIFY_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isFinite(timeoutMs) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < DEVICE_AGENT_LAN_VERIFY_MIN_TIMEOUT_MS ||
    timeoutMs > DEVICE_AGENT_LAN_VERIFY_MAX_TIMEOUT_MS
  ) {
    throw new DeviceAgentProtocolError(
      null,
      "DEVICE_AGENT_LAN_VERIFY_TIMEOUT_INVALID",
      `LAN verification timeout must be ${DEVICE_AGENT_LAN_VERIFY_MIN_TIMEOUT_MS}-${DEVICE_AGENT_LAN_VERIFY_MAX_TIMEOUT_MS} ms`
    );
  }
  return timeoutMs;
}

function pendingFromPoll(poll: DeviceAgentEnrollmentPoll): DeviceAgentPendingEnrollment {
  if (poll.status !== "pending" || !poll.verificationCode) {
    throw new DeviceAgentProtocolError(null, "DEVICE_AGENT_STATE_INVALID", "Enrollment is not pending");
  }
  return {
    enrollmentId: poll.enrollmentId,
    verificationCode: poll.verificationCode,
    expiresAt: poll.expiresAt,
    pollAfterSeconds: poll.pollAfterSeconds
  };
}

export class DeviceAgentService {
  private readonly runtimeDir: string;
  private readonly transport: DeviceAgentTransport;
  private readonly sleep: SleepLike;
  private readonly pinnedTransportFactory: (certificatePem: string) => DeviceAgentTransport;
  private readonly capabilityService: DeviceAgentCapabilityExecutor;
  private readonly now: () => string;
  private readonly random: () => number;
  private readonly verifiedHubOrigins = new Set<string>();

  constructor(options: DeviceAgentServiceOptions) {
    this.runtimeDir = options.runtimeDir;
    this.transport = options.transport ?? new HttpDeviceAgentTransport({ fetchImpl: options.fetchImpl });
    this.pinnedTransportFactory = options.pinnedTransportFactory ?? ((certificatePem) =>
      new HttpDeviceAgentTransport({ pinnedCertificatePem: certificatePem }));
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date().toISOString());
    this.capabilityService =
      options.capabilityService ??
      new DeviceAgentCapabilityService({
        runtimeDir: options.runtimeDir,
        ...(options.directExecutorsConfigPath
          ? { configPath: options.directExecutorsConfigPath }
          : {}),
        now: this.now
      });
    this.random = options.random ?? Math.random;
  }

  status(): DeviceAgentStatus {
    const state = readDeviceAgentState(this.runtimeDir);
    return state ? projectDeviceAgentStatus(state) : { configured: false, state: "unconfigured" };
  }

  routeStatus(): DeviceAgentRouteStatus {
    const state = readDeviceAgentState(this.runtimeDir);
    const lanRoute = this.readLanRoute();
    const lan = lanRoute ? projectDeviceAgentLanRoute(lanRoute) : null;
    return {
      preference: lan && state?.hubId === lan.hubId ? "lan" : "public",
      lan: {
        configured: Boolean(lan && state?.hubId === lan.hubId),
        security: lan && state?.hubId === lan.hubId ? "pinned-tls" : null,
        verifiedAt: lan && state?.hubId === lan.hubId ? lan.verifiedAt : null,
        lastSuccessfulAt: lan && state?.hubId === lan.hubId ? lan.lastSuccessfulAt : null,
        certificateFingerprint: lan && state?.hubId === lan.hubId ? lan.certificateFingerprint : null
      },
      public: {
        configured: Boolean(state?.hubOrigin)
      }
    };
  }

  async verifyAndUseHubRoute(candidateOriginInput: string): Promise<DeviceAgentStatusProjection> {
    const current = this.requireState();
    if (current.revokedAt) {
      throw new DeviceAgentProtocolError(401, "DEVICE_AGENT_REVOKED", "Device Agent identity is revoked");
    }
    if (!current.deviceId) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_NOT_CONNECTED", "Device Agent must be connected before changing Hub routes");
    }
    const candidateOrigin = normalizeDeviceHubOrigin(candidateOriginInput);
    const pinned = current.hubId && current.hubPublicKeySpki && current.hubPublicKeyFingerprint
      ? current
      : await this.ensureHubIdentity(current);
    if (!pinned.hubId || !pinned.hubPublicKeySpki || !pinned.hubPublicKeyFingerprint) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_HUB_IDENTITY_MISSING", "Device Agent has no pinned Hub identity");
    }

    const identityBody = await this.transportCall(() => this.transport.getHubIdentity(candidateOrigin));
    const observed = hubIdentityFromResponse(candidateOrigin, identityBody);
    if (
      observed.hubId !== pinned.hubId ||
      observed.publicKeySpki !== pinned.hubPublicKeySpki ||
      observed.publicKeyFingerprint !== pinned.hubPublicKeyFingerprint
    ) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_HUB_IDENTITY_MISMATCH",
        "Candidate route does not expose the pinned ChatCockpit Hub identity"
      );
    }

    const nonce = crypto.randomBytes(18).toString("base64url");
    const proofRaw = await this.transportCall(() => this.transport.proveHubIdentity(candidateOrigin, nonce));
    const proof = proofRaw && typeof proofRaw === "object" ? proofRaw as HubIdentityProofBody : {};
    if (
      proof.ok !== true ||
      proof.hubId !== pinned.hubId ||
      proof.nonce !== nonce ||
      typeof proof.signature !== "string"
    ) {
      throw new DeviceAgentProtocolError(
        502,
        "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID",
        "Candidate route returned an invalid Hub identity proof"
      );
    }

    let proofValid = false;
    try {
      proofValid = verifyHubIdentityProof(pinned.hubPublicKeySpki, nonce, proof.signature);
    } catch {
      proofValid = false;
    }
    if (!proofValid) {
      throw new DeviceAgentProtocolError(
        401,
        "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID",
        "Candidate route could not prove possession of the pinned Hub identity"
      );
    }

    const updated = addVerifiedDeviceAgentHubOrigin(
      this.runtimeDir,
      observed,
      this.now()
    );
    this.verifiedHubOrigins.add(candidateOrigin);
    return projectDeviceAgentStatus(updated);
  }

  async verifyLanDiscoveryCandidate(
    candidateInput: LanDiscoveryCandidate,
    options: DeviceAgentLanCandidateVerificationOptions = {}
  ): Promise<DeviceAgentVerifiedLanCandidate> {
    const current = this.requireState();
    if (current.revokedAt) {
      throw new DeviceAgentProtocolError(401, "DEVICE_AGENT_REVOKED", "Device Agent identity is revoked");
    }
    if (!current.deviceId) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_NOT_CONNECTED",
        "Device Agent must be connected before verifying LAN routes"
      );
    }
    if (!current.hubId || !current.hubPublicKeySpki || !current.hubPublicKeyFingerprint) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_HUB_IDENTITY_MISSING",
        "Device Agent has no pinned Hub identity for LAN verification"
      );
    }

    let candidate: LanDiscoveryCandidate;
    try {
      candidate = parseLanDiscoveryCandidate({
        serviceType: candidateInput.serviceType,
        instanceName: candidateInput.instanceName,
        host: candidateInput.host,
        port: candidateInput.port,
        addresses: candidateInput.addresses,
        txt: candidateInput.securePort === undefined
          ? ["v=1", "role=hub", `hub=${candidateInput.hubIdHint}`]
          : ["v=2", "role=hub", `hub=${candidateInput.hubIdHint}`, `tls=${candidateInput.securePort}`]
      });
    } catch {
      throw new DeviceAgentProtocolError(
        400,
        "DEVICE_AGENT_LAN_CANDIDATE_INVALID",
        "LAN discovery candidate is invalid"
      );
    }
    if (
      candidate.serviceType !== CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE ||
      candidate.hubIdHint !== current.hubId
    ) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_HUB_IDENTITY_MISMATCH",
        "LAN discovery candidate does not match the pinned ChatCockpit Hub identity"
      );
    }

    const timeoutMs = normalizeLanVerificationTimeout(options.timeoutMs);
    for (const address of candidate.addresses) {
      const origin = lanCandidateOrigin(address, candidate.port);
      let identityBody: unknown;
      try {
        identityBody = await this.lanRequest(
          timeoutMs,
          options.signal,
          (signal) => this.transport.getHubIdentity(origin, signal)
        );
      } catch (error) {
        if (
          error instanceof DeviceAgentProtocolError &&
          (error.code === "DEVICE_AGENT_LAN_CANDIDATE_TIMEOUT" ||
            error.code === "DEVICE_AGENT_NETWORK_ERROR" ||
            error.statusCode === 404 ||
            (error.statusCode !== null && error.statusCode >= 500))
        ) {
          continue;
        }
        throw error;
      }

      const observed = hubIdentityFromResponse(origin, identityBody);
      if (
        observed.hubId !== current.hubId ||
        observed.publicKeySpki !== current.hubPublicKeySpki ||
        observed.publicKeyFingerprint !== current.hubPublicKeyFingerprint
      ) {
        throw new DeviceAgentProtocolError(
          409,
          "DEVICE_AGENT_HUB_IDENTITY_MISMATCH",
          "LAN discovery candidate does not expose the pinned ChatCockpit Hub identity"
        );
      }

      const nonce = crypto.randomBytes(18).toString("base64url");
      const proofRaw = await this.lanRequest(
        timeoutMs,
        options.signal,
        (signal) => this.transport.proveHubIdentity(origin, nonce, signal)
      );
      const proof = proofRaw && typeof proofRaw === "object" ? proofRaw as HubIdentityProofBody : {};
      if (
        proof.ok !== true ||
        proof.hubId !== current.hubId ||
        proof.nonce !== nonce ||
        typeof proof.signature !== "string"
      ) {
        throw new DeviceAgentProtocolError(
          502,
          "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID",
          "LAN discovery candidate returned an invalid Hub identity proof"
        );
      }
      let proofValid = false;
      try {
        proofValid = verifyHubIdentityProof(current.hubPublicKeySpki, nonce, proof.signature);
      } catch {
        proofValid = false;
      }
      if (!proofValid) {
        throw new DeviceAgentProtocolError(
          401,
          "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID",
          "LAN discovery candidate could not prove possession of the pinned Hub identity"
        );
      }

      if (candidate.securePort === undefined) {
        return {
          schemaVersion: 1,
          source: "mdns",
          identityVerified: true,
          controlTransportEligible: false,
          transportSecurity: "plaintext-http",
          instanceName: candidate.instanceName,
          origin,
          address,
          port: candidate.port,
          secureOrigin: null,
          securePort: null,
          certificateFingerprint: null,
          hubId: current.hubId,
          hubPublicKeyFingerprint: current.hubPublicKeyFingerprint,
          verifiedAt: this.now()
        };
      }

      try {
        const tlsIdentityRaw = await this.lanRequest(
        timeoutMs,
        options.signal,
        (signal) => this.transport.getLanTlsIdentity(origin, signal)
      );
      const tlsIdentity = lanTlsIdentityFromResponse(tlsIdentityRaw);
      const tlsNonce = crypto.randomBytes(18).toString("base64url");
      const tlsProofRaw = await this.lanRequest(
        timeoutMs,
        options.signal,
        (signal) => this.transport.proveLanTlsIdentity(origin, tlsNonce, signal)
      );
      const tlsProof = tlsProofRaw && typeof tlsProofRaw === "object"
        ? tlsProofRaw as LanTlsProofBody
        : {};
      if (
        tlsProof.ok !== true ||
        tlsProof.hubId !== current.hubId ||
        tlsProof.nonce !== tlsNonce ||
        tlsProof.certificateFingerprint !== tlsIdentity.certificateFingerprint ||
        typeof tlsProof.signature !== "string" ||
        !verifyLanTlsCertificateProof(
          current.hubPublicKeySpki,
          tlsNonce,
          tlsIdentity.certificateFingerprint,
          tlsProof.signature
        )
      ) {
        throw new DeviceAgentProtocolError(
          401,
          "DEVICE_AGENT_LAN_TLS_PROOF_INVALID",
          "LAN discovery candidate could not prove its TLS certificate with the pinned Hub identity"
        );
      }

      const secureOrigin = lanSecureOrigin(address, candidate.securePort);
      const secureTransport = this.pinnedTransportFactory(tlsIdentity.certificatePem);
      const secureIdentityRaw = await this.lanRequest(
        timeoutMs,
        options.signal,
        (signal) => secureTransport.getHubIdentity(secureOrigin, signal)
      );
      const secureIdentity = hubIdentityFromResponse(secureOrigin, secureIdentityRaw);
      if (
        secureIdentity.hubId !== current.hubId ||
        secureIdentity.publicKeySpki !== current.hubPublicKeySpki ||
        secureIdentity.publicKeyFingerprint !== current.hubPublicKeyFingerprint
      ) {
        throw new DeviceAgentProtocolError(
          409,
          "DEVICE_AGENT_HUB_IDENTITY_MISMATCH",
          "LAN secure route does not expose the pinned ChatCockpit Hub identity"
        );
      }
      const secureNonce = crypto.randomBytes(18).toString("base64url");
      const secureProofRaw = await this.lanRequest(
        timeoutMs,
        options.signal,
        (signal) => secureTransport.proveHubIdentity(secureOrigin, secureNonce, signal)
      );
      const secureProof = secureProofRaw && typeof secureProofRaw === "object"
        ? secureProofRaw as HubIdentityProofBody
        : {};
      if (
        secureProof.ok !== true ||
        secureProof.hubId !== current.hubId ||
        secureProof.nonce !== secureNonce ||
        typeof secureProof.signature !== "string" ||
        !verifyHubIdentityProof(current.hubPublicKeySpki, secureNonce, secureProof.signature)
      ) {
        throw new DeviceAgentProtocolError(
          401,
          "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID",
          "LAN secure route could not prove possession of the pinned Hub identity"
        );
      }

      const verifiedAt = this.now();
      writeVerifiedDeviceAgentLanRoute({
        runtimeDir: this.runtimeDir,
        hubId: current.hubId,
        address,
        bootstrapPort: candidate.port,
        securePort: candidate.securePort,
        certificatePem: tlsIdentity.certificatePem,
        certificateFingerprint: tlsIdentity.certificateFingerprint,
        verifiedAt
      });
      return {
        schemaVersion: 1,
        source: "mdns",
        identityVerified: true,
        controlTransportEligible: true,
        transportSecurity: "pinned-tls",
        instanceName: candidate.instanceName,
        origin,
        address,
        port: candidate.port,
        secureOrigin,
        securePort: candidate.securePort,
        certificateFingerprint: tlsIdentity.certificateFingerprint,
        hubId: current.hubId,
        hubPublicKeyFingerprint: current.hubPublicKeyFingerprint,
        verifiedAt
        };
      } catch (error) {
        if (error instanceof DeviceAgentProtocolError && isRouteUnavailableError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new DeviceAgentProtocolError(
      504,
      "DEVICE_AGENT_LAN_CANDIDATE_UNREACHABLE",
      "LAN discovery candidate could not be reached through any advertised local address"
    );
  }

  async startEnrollment(input: DeviceAgentConnectInput): Promise<DeviceAgentPendingEnrollment> {
    const state = createDeviceAgentState({
      runtimeDir: this.runtimeDir,
      hubOrigin: normalizeDeviceHubOrigin(input.hubOrigin),
      displayName: input.displayName,
      platform: input.platform,
      architecture: input.architecture,
      now: this.now()
    });
    if (state.revokedAt) {
      throw new DeviceAgentProtocolError(401, "DEVICE_AGENT_REVOKED", "Device Agent identity is revoked and cannot re-enroll automatically");
    }
    const verifiedState = await this.ensureHubIdentity(state);
    if (verifiedState.deviceId) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_ALREADY_CONNECTED", "Device Agent is already connected to this Hub");
    }
    if (verifiedState.enrollmentId) {
      const existing = await this.pollEnrollment();
      if (existing.status === "pending") return pendingFromPoll(existing);
      if (existing.status === "approved") {
        throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_ALREADY_CONNECTED", "Device enrollment is already approved");
      }
      throw new DeviceAgentProtocolError(
        409,
        existing.status === "denied" ? "DEVICE_ENROLLMENT_DENIED" : "DEVICE_ENROLLMENT_EXPIRED",
        existing.status === "denied" ? "Device enrollment was denied" : "Device enrollment expired"
      );
    }

    const requestNonce = crypto.randomBytes(18).toString("base64url");
    const signature = sign(
      verifiedState,
      buildDeviceEnrollmentProof({
        publicKey: verifiedState.publicKeySpki,
        displayName: verifiedState.displayName,
        platform: verifiedState.platform,
        architecture: verifiedState.architecture,
        requestNonce
      })
    );
    const response = await this.transportCall(() =>
      this.transport.createEnrollment(verifiedState.hubOrigin, {
        displayName: verifiedState.displayName,
        platform: verifiedState.platform,
        architecture: verifiedState.architecture,
        publicKey: verifiedState.publicKeySpki,
        requestNonce,
        signature
      })
    ) as EnrollmentCreateBody;
    const enrollment = response.enrollment;
    const enrollmentId = requiredEnrollmentId(enrollment?.id);
    const verificationCode = requiredVerificationCode(enrollment?.verificationCode);
    if (!validTimestamp(enrollment?.expiresAt)) {
      throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid enrollment expiry");
    }
    const pollAfterSeconds = requiredPollSeconds(enrollment?.pollAfterSeconds);
    setDeviceAgentPendingEnrollment(this.runtimeDir, enrollmentId, this.now());
    return {
      enrollmentId,
      verificationCode,
      expiresAt: enrollment.expiresAt,
      pollAfterSeconds
    };
  }

  async pollEnrollment(): Promise<DeviceAgentEnrollmentPoll> {
    const current = this.requireState();
    if (current.revokedAt) {
      throw new DeviceAgentProtocolError(401, "DEVICE_AGENT_REVOKED", "Device Agent identity is revoked");
    }
    const state = await this.ensureHubIdentity(current);
    if (!state.enrollmentId) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_ENROLLMENT_MISSING", "Device Agent has no pending enrollment request");
    }
    const enrollmentId = state.enrollmentId;
    const signature = sign(state, buildDeviceEnrollmentStatusProof(enrollmentId));
    const response = await this.transportCall(() =>
      this.transport.pollEnrollment(state.hubOrigin, enrollmentId, { signature })
    ) as EnrollmentStatusBody;
    const enrollment = response.enrollment;
    const responseId = requiredEnrollmentId(enrollment?.id);
    if (responseId !== enrollmentId) {
      throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub enrollment response ID does not match the pending request");
    }
    const status = enrollment?.status;
    if (status !== "pending" && status !== "approved" && status !== "denied" && status !== "expired") {
      throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid enrollment status");
    }
    if (!validTimestamp(enrollment?.expiresAt)) {
      throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid enrollment expiry");
    }
    const pollAfterSeconds = requiredPollSeconds(enrollment?.pollAfterSeconds);
    const verificationCode = status === "pending"
      ? requiredVerificationCode(enrollment?.verificationCode)
      : null;
    const decidedAt = enrollment?.decidedAt === null || enrollment?.decidedAt === undefined
      ? null
      : validTimestamp(enrollment.decidedAt)
        ? enrollment.decidedAt
        : (() => {
            throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid enrollment decision timestamp");
          })();
    let deviceId: string | null = null;
    if (status === "approved") {
      deviceId = requiredDeviceId(enrollment?.deviceId);
      await this.ensureHubIdentity(this.requireState(), true);
      completeDeviceAgentEnrollment(this.runtimeDir, deviceId, this.now());
    } else if (status === "denied" || status === "expired") {
      clearDeviceAgentPendingEnrollment(this.runtimeDir, this.now());
    }
    return {
      enrollmentId,
      status,
      verificationCode,
      expiresAt: enrollment.expiresAt,
      decidedAt,
      deviceId,
      pollAfterSeconds
    };
  }

  async connect(
    input: DeviceAgentConnectInput,
    hooks: DeviceAgentConnectHooks = {}
  ): Promise<DeviceAgentStatusProjection> {
    const state = createDeviceAgentState({
      runtimeDir: this.runtimeDir,
      hubOrigin: normalizeDeviceHubOrigin(input.hubOrigin),
      displayName: input.displayName,
      platform: input.platform,
      architecture: input.architecture,
      now: this.now()
    });
    if (state.revokedAt) {
      throw new DeviceAgentProtocolError(401, "DEVICE_AGENT_REVOKED", "Device Agent identity is revoked and requires explicit reset/re-authorization");
    }
    const verifiedState = await this.ensureHubIdentity(state);
    if (verifiedState.deviceId) return projectDeviceAgentStatus(verifiedState);

    let pending: DeviceAgentPendingEnrollment;
    if (state.enrollmentId) {
      const existing = await this.pollEnrollment();
      if (existing.status === "approved") {
        await this.heartbeat();
        return this.requireConnectedStatus();
      }
      if (existing.status === "denied") {
        throw new DeviceAgentProtocolError(403, "DEVICE_ENROLLMENT_DENIED", "Device enrollment was denied by the Owner");
      }
      if (existing.status === "expired") {
        throw new DeviceAgentProtocolError(409, "DEVICE_ENROLLMENT_EXPIRED", "Device enrollment request expired before approval");
      }
      pending = pendingFromPoll(existing);
    } else {
      pending = await this.startEnrollment(input);
    }

    await hooks.onPending?.(pending);
    while (true) {
      if (hooks.signal?.aborted) {
        throw new DeviceAgentProtocolError(null, "DEVICE_AGENT_ABORTED", "Device Agent connection was cancelled");
      }
      const poll = await this.pollEnrollment();
      if (poll.status === "approved") {
        await this.heartbeat();
        return this.requireConnectedStatus();
      }
      if (poll.status === "denied") {
        throw new DeviceAgentProtocolError(403, "DEVICE_ENROLLMENT_DENIED", "Device enrollment was denied by the Owner");
      }
      if (poll.status === "expired") {
        throw new DeviceAgentProtocolError(409, "DEVICE_ENROLLMENT_EXPIRED", "Device enrollment request expired before approval");
      }
      await this.sleep(Math.max(1, poll.pollAfterSeconds) * 1_000, hooks.signal);
    }
  }

  async heartbeat(): Promise<DeviceAgentStatusProjection> {
    const current = this.requireState();
    if (current.revokedAt) {
      throw new DeviceAgentProtocolError(401, "DEVICE_AGENT_REVOKED", "Device Agent identity is revoked");
    }
    if (!current.deviceId) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_NOT_CONNECTED", "Device Agent is not connected");
    }

    const preferred = this.preferredRouteTarget(current);
    try {
      return await this.heartbeatViaTarget(current, preferred);
    } catch (error) {
      const protocolError = error instanceof DeviceAgentProtocolError
        ? error
        : new DeviceAgentProtocolError(
            null,
            "DEVICE_AGENT_RUNTIME_ERROR",
            error instanceof Error ? error.message : String(error)
          );
      if (
        protocolError.statusCode === 401 &&
        protocolError.code === "DEVICE_NOT_TRUSTED"
      ) {
        markDeviceAgentRevoked(this.runtimeDir, this.now());
        throw protocolError;
      }
      if (preferred.kind !== "lan" || !isRouteUnavailableError(protocolError)) {
        throw protocolError;
      }
    }

    const refreshed = this.requireState();
    try {
      return await this.heartbeatViaTarget(refreshed, this.publicRouteTarget(refreshed));
    } catch (error) {
      if (
        error instanceof DeviceAgentProtocolError &&
        error.statusCode === 401 &&
        error.code === "DEVICE_NOT_TRUSTED"
      ) {
        markDeviceAgentRevoked(this.runtimeDir, this.now());
      }
      throw error;
    }
  }

  async runOutboundChannelLoop(
    options: DeviceAgentChannelLoopOptions = {}
  ): Promise<DeviceAgentStatusProjection> {
    let latest = this.requireConnectedStatus();
    let retryAttempt = 0;
    let forcePublicOnce = false;

    while (true) {
      if (options.signal?.aborted) return latest;
      let connection: DeviceAgentChannelConnection | null = null;
      let routeTarget: DeviceAgentRouteTarget | null = null;
      try {
        const current = this.requireState();
        if (current.revokedAt || !current.deviceId) {
          throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_NOT_CONNECTED", "Device Agent is not connected");
        }
        routeTarget = forcePublicOnce
          ? this.publicRouteTarget(current)
          : this.preferredRouteTarget(current);
        forcePublicOnce = false;
        await this.ensureRouteIdentity(current, routeTarget);
        const { sequence, state } = reserveDeviceHeartbeatSequence(this.runtimeDir, this.now());
        const channelNonce = crypto.randomBytes(18).toString("base64url");
        const channelProtocolVersion = 2 as const;
        const signature = sign(
          state,
          buildDeviceChannelOpenProof(
            current.deviceId,
            sequence,
            channelNonce,
            channelProtocolVersion
          )
        );
        connection = await this.transportCall(() =>
          routeTarget!.transport.openChannel(routeTarget!.origin, {
            deviceId: current.deviceId!,
            sequence,
            channelNonce,
            protocolVersion: channelProtocolVersion,
            signature,
            signal: options.signal
          })
        );

        let readySeen = false;
        let activeChannelId: string | null = null;
        let serverShutdown = false;
        for await (const event of connection.events) {
          if (options.signal?.aborted) return latest;
          if (!readySeen) {
            if (
              event.type !== "channel.ready" ||
              event.deviceId !== current.deviceId ||
              event.acceptedSequence !== sequence ||
              event.protocolVersion !== channelProtocolVersion
            ) {
              throw new DeviceAgentProtocolError(
                502,
                "DEVICE_AGENT_CHANNEL_INVALID",
                "Hub device channel did not begin with the expected ready event"
              );
            }
            readySeen = true;
            activeChannelId = event.channelId;
            retryAttempt = 0;
            if (routeTarget?.kind === "lan") {
              this.markLanRouteSuccessful();
            }
            latest = this.requireConnectedStatus();
            await options.onEvent?.(event);
            continue;
          }

          if (event.type === "capability.request") {
            if (!activeChannelId || !routeTarget?.transport.submitChannelResult) {
              throw new DeviceAgentProtocolError(
                502,
                "DEVICE_AGENT_CHANNEL_INVALID",
                "Device Agent capability result transport is unavailable"
              );
            }
            const result = await this.capabilityService.execute({
              protocolVersion: event.protocolVersion,
              requestId: event.requestId,
              operation: event.operation,
              issuedAt: event.issuedAt,
              expiresAt: event.expiresAt,
              payload: event.payload
            });
            const reserved = reserveDeviceHeartbeatSequence(
              this.runtimeDir,
              this.now()
            );
            const resultSignature = sign(
              reserved.state,
              buildDeviceChannelResultProof(
                current.deviceId,
                activeChannelId,
                reserved.sequence,
                result
              )
            );
            const acknowledgement = await this.transportCall(() =>
              routeTarget!.transport.submitChannelResult!(routeTarget!.origin, {
                deviceId: current.deviceId!,
                channelId: activeChannelId!,
                sequence: reserved.sequence,
                body: result,
                signature: resultSignature
              })
            );
            if (acknowledgement.acceptedSequence !== reserved.sequence) {
              throw new DeviceAgentProtocolError(
                502,
                "DEVICE_AGENT_CHANNEL_INVALID",
                "Hub acknowledged an unexpected device capability result sequence"
              );
            }
            await options.onEvent?.(event);
            continue;
          }

          await options.onEvent?.(event);
          if (event.type === "channel.close") {
            if (event.reason === "revoked") {
              markDeviceAgentRevoked(this.runtimeDir, this.now());
              throw new DeviceAgentProtocolError(
                401,
                "DEVICE_AGENT_REVOKED",
                "Device Agent identity was revoked by the Hub"
              );
            }
            if (event.reason === "superseded") {
              throw new DeviceAgentProtocolError(
                409,
                "DEVICE_AGENT_CHANNEL_SUPERSEDED",
                "Device Agent channel was superseded by another connection"
              );
            }
            serverShutdown = true;
            break;
          }
        }

        if (options.signal?.aborted) return latest;
        if (!readySeen) {
          throw new DeviceAgentProtocolError(
            null,
            "DEVICE_AGENT_CHANNEL_NETWORK_ERROR",
            "Device Agent channel ended before becoming ready"
          );
        }
        throw new DeviceAgentProtocolError(
          serverShutdown ? 503 : null,
          serverShutdown ? "DEVICE_AGENT_CHANNEL_CLOSED" : "DEVICE_AGENT_CHANNEL_NETWORK_ERROR",
          serverShutdown
            ? "ChatCockpit Hub closed the device channel for restart"
            : "Device Agent channel disconnected"
        );
      } catch (error) {
        if (options.signal?.aborted) return this.requireConnectedStatus();
        const protocolError = error instanceof DeviceAgentProtocolError
          ? error
          : new DeviceAgentProtocolError(
              null,
              "DEVICE_AGENT_RUNTIME_ERROR",
              error instanceof Error ? error.message : String(error)
            );
        if (
          protocolError.statusCode === 401 &&
          protocolError.code === "DEVICE_NOT_TRUSTED"
        ) {
          markDeviceAgentRevoked(this.runtimeDir, this.now());
        }
        if (routeTarget?.kind === "lan" && isRouteUnavailableError(protocolError)) {
          forcePublicOnce = true;
          retryAttempt = 0;
          connection?.close();
          continue;
        }
        if (!isRetryableDeviceAgentError(protocolError)) throw protocolError;

        retryAttempt += 1;
        const exponential = Math.min(
          DEVICE_AGENT_RETRY_MAX_MS,
          DEVICE_AGENT_RETRY_BASE_MS * 2 ** Math.min(retryAttempt - 1, 10)
        );
        const randomValue = this.random();
        const boundedRandom = Number.isFinite(randomValue)
          ? Math.min(1, Math.max(0, randomValue))
          : 0.5;
        const delayMs = Math.max(1, Math.round(exponential * (0.8 + boundedRandom * 0.4)));
        await options.onRetry?.({ attempt: retryAttempt, delayMs, error: protocolError });
        try {
          await this.sleep(delayMs, options.signal);
        } catch (sleepError) {
          if (
            options.signal?.aborted ||
            (sleepError instanceof DeviceAgentProtocolError && sleepError.code === "DEVICE_AGENT_ABORTED")
          ) {
            return this.requireConnectedStatus();
          }
          throw sleepError;
        }
      } finally {
        connection?.close();
      }
    }
  }

  async runHeartbeatLoop(options: DeviceAgentLoopOptions = {}): Promise<DeviceAgentStatusProjection> {
    const intervalMs = options.intervalMs ?? DEVICE_AGENT_DEFAULT_INTERVAL_MS;
    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < DEVICE_AGENT_MIN_INTERVAL_MS ||
      intervalMs > DEVICE_AGENT_MAX_INTERVAL_MS
    ) {
      throw new DeviceAgentProtocolError(
        null,
        "DEVICE_AGENT_INTERVAL_INVALID",
        `Device Agent heartbeat interval must be between ${DEVICE_AGENT_MIN_INTERVAL_MS / 1_000} and ${DEVICE_AGENT_MAX_INTERVAL_MS / 1_000} seconds`
      );
    }

    let latest = this.requireConnectedStatus();
    let retryAttempt = 0;
    while (true) {
      if (options.signal?.aborted) return latest;

      try {
        latest = await this.heartbeat();
        retryAttempt = 0;
      } catch (error) {
        if (options.signal?.aborted) return this.status() as DeviceAgentStatusProjection;
        const protocolError = error instanceof DeviceAgentProtocolError
          ? error
          : new DeviceAgentProtocolError(
              null,
              "DEVICE_AGENT_RUNTIME_ERROR",
              error instanceof Error ? error.message : String(error)
            );
        if (!isRetryableDeviceAgentError(protocolError)) throw protocolError;

        retryAttempt += 1;
        const exponential = Math.min(
          DEVICE_AGENT_RETRY_MAX_MS,
          DEVICE_AGENT_RETRY_BASE_MS * 2 ** Math.min(retryAttempt - 1, 10)
        );
        const randomValue = this.random();
        const boundedRandom = Number.isFinite(randomValue)
          ? Math.min(1, Math.max(0, randomValue))
          : 0.5;
        const delayMs = Math.max(1, Math.round(exponential * (0.8 + boundedRandom * 0.4)));
        await options.onRetry?.({ attempt: retryAttempt, delayMs, error: protocolError });
        try {
          await this.sleep(delayMs, options.signal);
        } catch (sleepError) {
          if (
            options.signal?.aborted ||
            (sleepError instanceof DeviceAgentProtocolError && sleepError.code === "DEVICE_AGENT_ABORTED")
          ) {
            return this.requireConnectedStatus();
          }
          throw sleepError;
        }
        continue;
      }

      await options.onHeartbeat?.(latest);
      try {
        await this.sleep(intervalMs, options.signal);
      } catch (sleepError) {
        if (
          options.signal?.aborted ||
          (sleepError instanceof DeviceAgentProtocolError && sleepError.code === "DEVICE_AGENT_ABORTED")
        ) {
          return latest;
        }
        throw sleepError;
      }
    }
  }

  private publicRouteTarget(state: DeviceAgentStateRecord): DeviceAgentRouteTarget {
    return {
      kind: "public",
      origin: state.hubOrigin,
      transport: this.transport,
      lanRoute: null
    };
  }

  private readLanRoute(): DeviceAgentLanRouteRecord | null {
    try {
      return readDeviceAgentLanRoute(this.runtimeDir);
    } catch {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_LAN_ROUTE_INVALID",
        "Persisted LAN route is invalid and must be verified again"
      );
    }
  }

  private markLanRouteSuccessful(): void {
    try {
      markDeviceAgentLanRouteSuccessful(this.runtimeDir, this.now());
    } catch {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_LAN_ROUTE_INVALID",
        "Persisted LAN route could not be updated safely"
      );
    }
  }

  private preferredRouteTarget(state: DeviceAgentStateRecord): DeviceAgentRouteTarget {
    const lanRoute = this.readLanRoute();
    if (!lanRoute) return this.publicRouteTarget(state);
    if (!state.hubId || lanRoute.hubId !== state.hubId) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_LAN_ROUTE_INVALID",
        "Persisted LAN route does not belong to the pinned ChatCockpit Hub"
      );
    }
    return {
      kind: "lan",
      origin: lanRoute.secureOrigin,
      transport: this.pinnedTransportFactory(lanRoute.certificatePem),
      lanRoute
    };
  }

  private async ensureRouteIdentity(
    state: DeviceAgentStateRecord,
    target: DeviceAgentRouteTarget
  ): Promise<DeviceAgentStateRecord> {
    if (target.kind === "public") return this.ensureHubIdentity(state);
    if (
      !state.hubId ||
      !state.hubPublicKeySpki ||
      !state.hubPublicKeyFingerprint
    ) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_HUB_IDENTITY_MISSING",
        "Device Agent has no pinned Hub identity"
      );
    }
    if (this.verifiedHubOrigins.has(target.origin)) return state;
    const identityRaw = await this.transportCall(() => target.transport.getHubIdentity(target.origin));
    const observed = hubIdentityFromResponse(target.origin, identityRaw);
    if (
      observed.hubId !== state.hubId ||
      observed.publicKeySpki !== state.hubPublicKeySpki ||
      observed.publicKeyFingerprint !== state.hubPublicKeyFingerprint
    ) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_HUB_IDENTITY_MISMATCH",
        "LAN secure route does not expose the pinned ChatCockpit Hub identity"
      );
    }
    const nonce = crypto.randomBytes(18).toString("base64url");
    const proofRaw = await this.transportCall(() => target.transport.proveHubIdentity(target.origin, nonce));
    const proof = proofRaw && typeof proofRaw === "object" ? proofRaw as HubIdentityProofBody : {};
    if (
      proof.ok !== true ||
      proof.hubId !== state.hubId ||
      proof.nonce !== nonce ||
      typeof proof.signature !== "string" ||
      !verifyHubIdentityProof(state.hubPublicKeySpki, nonce, proof.signature)
    ) {
      throw new DeviceAgentProtocolError(
        401,
        "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID",
        "LAN secure route could not prove possession of the pinned Hub identity"
      );
    }
    this.verifiedHubOrigins.add(target.origin);
    return state;
  }

  private async heartbeatViaTarget(
    current: DeviceAgentStateRecord,
    target: DeviceAgentRouteTarget
  ): Promise<DeviceAgentStatusProjection> {
    await this.ensureRouteIdentity(current, target);
    const { sequence, state } = reserveDeviceHeartbeatSequence(this.runtimeDir, this.now());
    const signature = sign(state, buildDeviceHeartbeatProof(current.deviceId!, sequence));
    const response = await this.transportCall(() =>
      target.transport.heartbeat(target.origin, {
        deviceId: current.deviceId!,
        sequence,
        signature
      })
    ) as HeartbeatBody;
    if (
      response.ok !== true ||
      response.deviceId !== current.deviceId ||
      response.acceptedSequence !== sequence
    ) {
      throw new DeviceAgentProtocolError(
        502,
        "DEVICE_AGENT_RESPONSE_INVALID",
        "Hub returned an invalid heartbeat acknowledgement"
      );
    }
    if (target.kind === "lan") {
      this.markLanRouteSuccessful();
    }
    return projectDeviceAgentStatus(markDeviceAgentHeartbeatAccepted(this.runtimeDir, this.now()));
  }

  private requireState(): DeviceAgentStateRecord {
    const state = readDeviceAgentState(this.runtimeDir);
    if (!state) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_NOT_CONFIGURED", "Device Agent is not configured");
    }
    return state;
  }

  private requireConnectedStatus(): DeviceAgentStatusProjection {
    const state = this.requireState();
    if (!state.deviceId || state.revokedAt) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_NOT_CONNECTED", "Device Agent is not connected");
    }
    return projectDeviceAgentStatus(state);
  }

  private async ensureHubIdentity(
    state: DeviceAgentStateRecord,
    force = false
  ): Promise<DeviceAgentStateRecord> {
    const origin = state.hubOrigin;
    if (!force && this.verifiedHubOrigins.has(origin) && state.hubId) {
      return state;
    }
    const body = await this.transportCall(() => this.transport.getHubIdentity(origin));
    const observed = hubIdentityFromResponse(origin, body);
    try {
      const pinned = pinDeviceAgentHubIdentity(this.runtimeDir, observed, this.now());
      this.verifiedHubOrigins.add(origin);
      return pinned;
    } catch (error) {
      throw new DeviceAgentProtocolError(
        409,
        "DEVICE_AGENT_HUB_IDENTITY_MISMATCH",
        error instanceof Error ? error.message : "Observed Hub identity does not match the pinned Hub"
      );
    }
  }

  private async lanRequest<T>(
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (externalSignal?.aborted) {
      throw new DeviceAgentProtocolError(null, "DEVICE_AGENT_ABORTED", "Device Agent operation was cancelled");
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.transportCall(() => operation(controller.signal));
    } catch (error) {
      if (externalSignal?.aborted) {
        throw new DeviceAgentProtocolError(null, "DEVICE_AGENT_ABORTED", "Device Agent operation was cancelled");
      }
      if (timedOut) {
        throw new DeviceAgentProtocolError(
          504,
          "DEVICE_AGENT_LAN_CANDIDATE_TIMEOUT",
          "LAN discovery candidate verification timed out"
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  private async transportCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DeviceAgentTransportError) {
        throw new DeviceAgentProtocolError(error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }
}
