import crypto from "node:crypto";

import {
  buildDeviceEnrollmentProof,
  buildDeviceEnrollmentStatusProof,
  buildDeviceHeartbeatProof,
  type DeviceEnrollmentStatus
} from "./device-registry.js";
import {
  clearDeviceAgentPendingEnrollment,
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  markDeviceAgentHeartbeatAccepted,
  markDeviceAgentRevoked,
  normalizeDeviceHubOrigin,
  projectDeviceAgentStatus,
  readDeviceAgentState,
  reserveDeviceHeartbeatSequence,
  setDeviceAgentPendingEnrollment,
  type DeviceAgentStatusProjection,
  type DeviceAgentStateRecord
} from "./device-agent-state.js";

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

interface ApiProblemBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
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

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
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

async function parseResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DeviceAgentProtocolError(response.status, "DEVICE_AGENT_RESPONSE_INVALID", "Hub returned a non-JSON device protocol response");
  }
}

function apiProblem(statusCode: number, body: unknown): DeviceAgentProtocolError {
  const candidate = body && typeof body === "object" ? (body as ApiProblemBody) : {};
  const code = typeof candidate.error?.code === "string"
    ? candidate.error.code
    : "DEVICE_AGENT_HUB_ERROR";
  const message = typeof candidate.error?.message === "string"
    ? candidate.error.message
    : `Hub device protocol request failed with HTTP ${statusCode}`;
  return new DeviceAgentProtocolError(statusCode, code, message);
}

function endpoint(state: DeviceAgentStateRecord, pathname: string): URL {
  return new URL(pathname, `${state.hubOrigin}/`);
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
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;
  private readonly now: () => string;
  private readonly random: () => number;

  constructor(options: DeviceAgentServiceOptions) {
    this.runtimeDir = options.runtimeDir;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date().toISOString());
    this.random = options.random ?? Math.random;
  }

  status(): DeviceAgentStatus {
    const state = readDeviceAgentState(this.runtimeDir);
    return state ? projectDeviceAgentStatus(state) : { configured: false, state: "unconfigured" };
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
    if (state.deviceId) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_ALREADY_CONNECTED", "Device Agent is already connected to this Hub");
    }
    if (state.enrollmentId) {
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
      state,
      buildDeviceEnrollmentProof({
        publicKey: state.publicKeySpki,
        displayName: state.displayName,
        platform: state.platform,
        architecture: state.architecture,
        requestNonce
      })
    );
    const response = await this.requestJson(
      state,
      "/api/devices/enrollment-requests",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: state.displayName,
          platform: state.platform,
          architecture: state.architecture,
          publicKey: state.publicKeySpki,
          requestNonce,
          signature
        })
      }
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
    const state = this.requireState();
    if (state.revokedAt) {
      throw new DeviceAgentProtocolError(401, "DEVICE_AGENT_REVOKED", "Device Agent identity is revoked");
    }
    if (!state.enrollmentId) {
      throw new DeviceAgentProtocolError(409, "DEVICE_AGENT_ENROLLMENT_MISSING", "Device Agent has no pending enrollment request");
    }
    const enrollmentId = state.enrollmentId;
    const signature = sign(state, buildDeviceEnrollmentStatusProof(enrollmentId));
    const response = await this.requestJson(
      state,
      `/api/devices/enrollment-requests/${encodeURIComponent(enrollmentId)}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature })
      }
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
    if (state.deviceId) return projectDeviceAgentStatus(state);

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
    const { sequence, state } = reserveDeviceHeartbeatSequence(this.runtimeDir, this.now());
    const signature = sign(state, buildDeviceHeartbeatProof(current.deviceId, sequence));
    let response: HeartbeatBody;
    try {
      response = await this.requestJson(
        state,
        "/api/devices/heartbeat",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceId: current.deviceId, sequence, signature })
        }
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
        const retryable =
          protocolError.code === "DEVICE_AGENT_NETWORK_ERROR" ||
          protocolError.statusCode === 429 ||
          (protocolError.statusCode !== null && protocolError.statusCode >= 500);
        if (!retryable) throw protocolError;

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

  private async requestJson(
    state: DeviceAgentStateRecord,
    pathname: string,
    init: RequestInit
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint(state, pathname), {
        ...init,
        redirect: "manual",
        headers: {
          accept: "application/json",
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DeviceAgentProtocolError(null, "DEVICE_AGENT_NETWORK_ERROR", `Unable to reach ChatCockpit Hub: ${message}`);
    }
    if (isRedirect(response.status)) {
      throw new DeviceAgentProtocolError(
        response.status,
        "DEVICE_AGENT_REDIRECT_REJECTED",
        "Device protocol redirects are not followed automatically"
      );
    }
    const body = await parseResponseJson(response);
    if (!response.ok) throw apiProblem(response.status, body);
    return body;
  }
}
