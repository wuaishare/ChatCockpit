import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  PublicRouteCandidateStore,
  type PublicRouteCandidateSource
} from "./public-route-candidate.js";
import {
  PublicRouteVerificationStore,
  type PublicRouteVerificationArtifact
} from "./public-route-verification.js";

export const PUBLIC_ROUTE_CUTOVER_INTENT_SCHEMA_VERSION = 1 as const;

const STATE_FILE_NAME = "connectivity-route-cutover-intent.json";
const INTENT_TTL_MS = 15 * 60 * 1_000;

export type PublicRouteCutoverIntentStatus = "pending-machine-execution";
export type PublicRouteCutoverIntentKind = "replacement";

export interface PublicRouteCutoverIntent {
  schemaVersion: typeof PUBLIC_ROUTE_CUTOVER_INTENT_SCHEMA_VERSION;
  id: string;
  kind: PublicRouteCutoverIntentKind;
  status: PublicRouteCutoverIntentStatus;
  candidateId: string;
  candidateOrigin: string;
  candidateSource: PublicRouteCandidateSource;
  verificationId: string;
  expectedCanonicalOrigin: string;
  requiresMachineAuthority: true;
  changesCanonicalOrigin: true;
  mayRestartRunningRuntime: true;
  startsStoppedRuntime: false;
  startsProviderTunnel: false;
  writesProviderSecrets: false;
  preparedAt: string;
  expiresAt: string;
}

export interface PublicRouteCutoverIntentSnapshot {
  ok: true;
  schemaVersion: typeof PUBLIC_ROUTE_CUTOVER_INTENT_SCHEMA_VERSION;
  intent: PublicRouteCutoverIntent | null;
}

export type PublicRouteCutoverIntentErrorCode =
  | "bootstrap-not-supported"
  | "candidate-already-canonical"
  | "candidate-stale"
  | "verification-missing"
  | "verification-stale"
  | "verification-not-verified"
  | "intent-stale"
  | "intent-state-invalid";

export class PublicRouteCutoverIntentError extends Error {
  constructor(
    readonly code: PublicRouteCutoverIntentErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PublicRouteCutoverIntentError";
  }
}

export interface PublicRouteCutoverIntentStoreOptions {
  runtimeDir: string;
  candidateStore: PublicRouteCandidateStore;
  verificationStore: PublicRouteVerificationStore;
  now?: () => string;
  createId?: () => string;
}

function verificationFullyPassed(verification: PublicRouteVerificationArtifact): boolean {
  return verification.status === "verified" && Object.values(verification.checks).every((check) => check.ok);
}

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new PublicRouteCutoverIntentError(
      "intent-state-invalid",
      `Public Route Cutover Intent ${label} is invalid`
    );
  }
  return parsed;
}

function atomicPrivateWrite(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
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

function requireBooleanLiteral(
  record: Record<string, unknown>,
  key: string,
  expected: boolean
): void {
  if (record[key] !== expected) {
    throw new PublicRouteCutoverIntentError(
      "intent-state-invalid",
      `Public Route Cutover Intent ${key} is invalid`
    );
  }
}

function parseIntent(raw: unknown): PublicRouteCutoverIntent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PublicRouteCutoverIntentError(
      "intent-state-invalid",
      "Public Route Cutover Intent state is invalid"
    );
  }
  const record = raw as Record<string, unknown>;
  if (
    record.schemaVersion !== PUBLIC_ROUTE_CUTOVER_INTENT_SCHEMA_VERSION ||
    typeof record.id !== "string" || !record.id.trim() ||
    record.kind !== "replacement" ||
    record.status !== "pending-machine-execution" ||
    typeof record.candidateId !== "string" || !record.candidateId.trim() ||
    typeof record.candidateOrigin !== "string" || !record.candidateOrigin.trim() ||
    !["existing-environment", "cloudflare-tunnel", "ngrok", "frp-client"].includes(
      String(record.candidateSource)
    ) ||
    typeof record.verificationId !== "string" || !record.verificationId.trim() ||
    typeof record.expectedCanonicalOrigin !== "string" || !record.expectedCanonicalOrigin.trim() ||
    typeof record.preparedAt !== "string" || !record.preparedAt.trim() ||
    typeof record.expiresAt !== "string" || !record.expiresAt.trim()
  ) {
    throw new PublicRouteCutoverIntentError(
      "intent-state-invalid",
      "Public Route Cutover Intent state is invalid"
    );
  }
  requireBooleanLiteral(record, "requiresMachineAuthority", true);
  requireBooleanLiteral(record, "changesCanonicalOrigin", true);
  requireBooleanLiteral(record, "mayRestartRunningRuntime", true);
  requireBooleanLiteral(record, "startsStoppedRuntime", false);
  requireBooleanLiteral(record, "startsProviderTunnel", false);
  requireBooleanLiteral(record, "writesProviderSecrets", false);
  parseTimestamp(record.preparedAt, "preparedAt");
  parseTimestamp(record.expiresAt, "expiresAt");
  return record as unknown as PublicRouteCutoverIntent;
}

export class PublicRouteCutoverIntentStore {
  private readonly statePath: string;
  private readonly candidateStore: PublicRouteCandidateStore;
  private readonly verificationStore: PublicRouteVerificationStore;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: PublicRouteCutoverIntentStoreOptions) {
    this.statePath = path.join(options.runtimeDir, STATE_FILE_NAME);
    this.candidateStore = options.candidateStore;
    this.verificationStore = options.verificationStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
  }

  snapshot(): PublicRouteCutoverIntentSnapshot {
    const intent = this.readIntent();
    if (!intent) return this.emptySnapshot();

    const nowMs = parseTimestamp(this.now(), "clock");
    if (nowMs > parseTimestamp(intent.expiresAt, "expiresAt")) {
      this.removeState();
      return this.emptySnapshot();
    }

    const route = this.candidateStore.snapshot();
    const candidate = route.candidate;
    if (
      route.canonical.origin !== intent.expectedCanonicalOrigin ||
      !candidate ||
      candidate.id !== intent.candidateId ||
      candidate.origin !== intent.candidateOrigin ||
      candidate.source !== intent.candidateSource
    ) {
      this.removeState();
      return this.emptySnapshot();
    }

    const verification = this.verificationStore.read();
    if (
      !verification ||
      verification.id !== intent.verificationId ||
      !verificationFullyPassed(verification) ||
      verification.candidateId !== intent.candidateId ||
      verification.candidateOrigin !== intent.candidateOrigin
    ) {
      this.removeState();
      return this.emptySnapshot();
    }

    return {
      ok: true,
      schemaVersion: PUBLIC_ROUTE_CUTOVER_INTENT_SCHEMA_VERSION,
      intent
    };
  }

  prepare(input: {
    candidateId: string;
    verificationId: string;
  }): PublicRouteCutoverIntentSnapshot {
    const route = this.candidateStore.snapshot();
    if (!route.canonical.origin) {
      throw new PublicRouteCutoverIntentError(
        "bootstrap-not-supported",
        "Initial Public Route bootstrap requires a separate Machine Authority workflow"
      );
    }

    const candidate = route.candidate;
    if (!candidate || candidate.id !== input.candidateId) {
      throw new PublicRouteCutoverIntentError(
        "candidate-stale",
        "Candidate Public Route identity no longer matches the current staged candidate"
      );
    }
    if (candidate.origin === route.canonical.origin) {
      throw new PublicRouteCutoverIntentError(
        "candidate-already-canonical",
        "Candidate Public Route already matches the canonical Runtime origin"
      );
    }

    const verification = this.verificationStore.read();
    if (!verification) {
      throw new PublicRouteCutoverIntentError(
        "verification-missing",
        "Candidate Public Route has no Verification Artifact"
      );
    }
    if (
      verification.id !== input.verificationId ||
      verification.candidateId !== candidate.id ||
      verification.candidateOrigin !== candidate.origin
    ) {
      throw new PublicRouteCutoverIntentError(
        "verification-stale",
        "Candidate Public Route verification no longer matches the requested cutover"
      );
    }
    if (!verificationFullyPassed(verification)) {
      throw new PublicRouteCutoverIntentError(
        "verification-not-verified",
        "Candidate Public Route must pass verification before cutover can be prepared"
      );
    }

    const preparedAt = this.now();
    const preparedAtMs = parseTimestamp(preparedAt, "preparedAt");
    const intent: PublicRouteCutoverIntent = {
      schemaVersion: PUBLIC_ROUTE_CUTOVER_INTENT_SCHEMA_VERSION,
      id: this.createId(),
      kind: "replacement",
      status: "pending-machine-execution",
      candidateId: candidate.id,
      candidateOrigin: candidate.origin,
      candidateSource: candidate.source,
      verificationId: verification.id,
      expectedCanonicalOrigin: route.canonical.origin,
      requiresMachineAuthority: true,
      changesCanonicalOrigin: true,
      mayRestartRunningRuntime: true,
      startsStoppedRuntime: false,
      startsProviderTunnel: false,
      writesProviderSecrets: false,
      preparedAt,
      expiresAt: new Date(preparedAtMs + INTENT_TTL_MS).toISOString()
    };
    atomicPrivateWrite(this.statePath, intent);
    return this.snapshot();
  }

  consume(intentId: string): PublicRouteCutoverIntent {
    const current = this.snapshot().intent;
    if (!current || current.id !== intentId) {
      throw new PublicRouteCutoverIntentError(
        "intent-stale",
        "Public Route Cutover Intent is no longer available for Machine execution"
      );
    }
    this.removeState();
    return current;
  }

  cancel(): PublicRouteCutoverIntentSnapshot {
    this.removeState();
    return this.emptySnapshot();
  }

  private emptySnapshot(): PublicRouteCutoverIntentSnapshot {
    return {
      ok: true,
      schemaVersion: PUBLIC_ROUTE_CUTOVER_INTENT_SCHEMA_VERSION,
      intent: null
    };
  }

  private readIntent(): PublicRouteCutoverIntent | null {
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
      throw new PublicRouteCutoverIntentError(
        "intent-state-invalid",
        "Public Route Cutover Intent state is not valid JSON"
      );
    }
    return parseIntent(parsed);
  }

  private removeState(): void {
    try {
      fs.unlinkSync(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
