import crypto from "node:crypto";

import {
  buildDeviceChannelOpenProof,
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
import {
  DeviceAgentTransportError,
  HttpDeviceAgentTransport,
  type DeviceAgentChannelConnection,
  type DeviceAgentChannelEvent,
  type DeviceAgentTransport
} from "./device-agent-transport.js";
import { verifyHubIdentityProof } from "./hub-identity.js";

export interface DeviceAgentUnconfiguredStatus {
  configured: false;
  state: "unconfigured";
}

export type DeviceAgentStatus = DeviceAgentStatusProjection | DeviceAgentUnconfiguredStatus;

export const DEVICE_AGENT_DEFAULT_INTERVAL_MS = 30_000;
export const DEVICE_AGENT_MIN_INTERVAL_MS = 5_000;
export const DEVICE_AGENT_MAX_INTERVAL_MS = 5 * 60_000;
const DEVICE_AGENT_RETRY_BASE_MS = 1_000;
const DEVICE_AGENT_RETRY_MAX_MS = 30_000;

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

interface DeviceAgentServiceOptions {
  runtimeDir: string;
  fetchImpl?: FetchLike;
  transport?: DeviceAgentTransport;
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
  "DEVICE_AGENT_RESPONSE_INVALID"
]);

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
  private readonly now: () => string;
  private readonly random: () => number;
  private readonly verifiedHubOrigins = new Set<string>();

  constructor(options: DeviceAgentServiceOptions) {
    this.runtimeDir = options.runtimeDir;
    this.transport = options.transport ?? new HttpDeviceAgentTransport({ fetchImpl: options.fetchImpl });
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date().toISOString());
    this.random = options.random ?? Math.random;
  }

  status(): DeviceAgentStatus {
    const state = readDeviceAgentState(this.runtimeDir);
    return state ? projectDeviceAgentStatus(state) : { configured: false, state: "unconfigured" };
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
    await this.ensureHubIdentity(current);
    const { sequence, state } = reserveDeviceHeartbeatSequence(this.runtimeDir, this.now());
    const signature = sign(state, buildDeviceHeartbeatProof(current.deviceId, sequence));
    let response: HeartbeatBody;
    try {
      response = await this.transportCall(() =>
        this.transport.heartbeat(state.hubOrigin, {
          deviceId: current.deviceId,
          sequence,
          signature
        })
      ) as HeartbeatBody;
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
    if (
      response.ok !== true ||
      response.deviceId !== current.deviceId ||
      response.acceptedSequence !== sequence
    ) {
      throw new DeviceAgentProtocolError(502, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned an invalid heartbeat acknowledgement");
    }
    return projectDeviceAgentStatus(markDeviceAgentHeartbeatAccepted(this.runtimeDir, this.now()));
  }

  async runOutboundChannelLoop(
    options: DeviceAgentChannelLoopOptions = {}
  ): Promise<DeviceAgentStatusProjection> {
    let latest = this.requireConnectedStatus();
    let retryAttempt = 0;

    while (true) {
      if (options.signal?.aborted) return latest;
      let connection: DeviceAgentChannelConnection | null = null;
      try {
        const current = this.requireState();
        if (current.revokedAt || !current.deviceId) {
          throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_NOT_CONNECTED", "Device Agent is not connected");
        }
        const verified = await this.ensureHubIdentity(current);
        const { sequence, state } = reserveDeviceHeartbeatSequence(this.runtimeDir, this.now());
        const channelNonce = crypto.randomBytes(18).toString("base64url");
        const signature = sign(
          state,
          buildDeviceChannelOpenProof(current.deviceId, sequence, channelNonce)
        );
        connection = await this.transportCall(() =>
          this.transport.openChannel(verified.hubOrigin, {
            deviceId: current.deviceId!,
            sequence,
            channelNonce,
            signature,
            signal: options.signal
          })
        );

        let readySeen = false;
        let serverShutdown = false;
        for await (const event of connection.events) {
          if (options.signal?.aborted) return latest;
          if (!readySeen) {
            if (
              event.type !== "channel.ready" ||
              event.deviceId !== current.deviceId ||
              event.acceptedSequence !== sequence ||
              event.protocolVersion !== 1
            ) {
              throw new DeviceAgentProtocolError(
                502,
                "DEVICE_AGENT_CHANNEL_INVALID",
                "Hub device channel did not begin with the expected ready event"
              );
            }
            readySeen = true;
            retryAttempt = 0;
            latest = this.requireConnectedStatus();
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
