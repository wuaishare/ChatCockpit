import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { readIdentityEnv } from "../core/identity-env.js";

export const PUBLIC_ROUTE_CANDIDATE_SCHEMA_VERSION = 1 as const;

export type PublicRouteCandidateSource =
  | "existing-environment"
  | "cloudflare-tunnel"
  | "ngrok"
  | "frp-client";

export type PublicRouteCandidateStatus = "staged-unverified";

export interface PublicRouteCandidate {
  id: string;
  origin: string;
  source: PublicRouteCandidateSource;
  status: PublicRouteCandidateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PublicRouteCanonicalProjection {
  origin: string | null;
  configured: boolean;
  source: "runtime-config";
}

export interface PublicRouteCandidateSnapshot {
  ok: true;
  schemaVersion: typeof PUBLIC_ROUTE_CANDIDATE_SCHEMA_VERSION;
  canonical: PublicRouteCanonicalProjection;
  candidate: PublicRouteCandidate | null;
}

export type PublicRouteCandidateValidationCode =
  | "candidate-origin-invalid"
  | "candidate-https-required"
  | "candidate-already-canonical"
  | "candidate-source-invalid"
  | "candidate-state-invalid";

export class PublicRouteCandidateValidationError extends Error {
  constructor(
    readonly code: PublicRouteCandidateValidationCode,
    message: string
  ) {
    super(message);
    this.name = "PublicRouteCandidateValidationError";
  }
}

export interface PublicRouteCandidateStoreOptions {
  runtimeDir: string;
  canonicalOrigin?: () => string | null;
  now?: () => string;
  createId?: () => string;
}

interface PersistedCandidateEnvelope {
  schemaVersion: typeof PUBLIC_ROUTE_CANDIDATE_SCHEMA_VERSION;
  candidate: PublicRouteCandidate;
}

const STATE_FILE_NAME = "connectivity-route-candidate.json";
const VALID_SOURCES = new Set<PublicRouteCandidateSource>([
  "existing-environment",
  "cloudflare-tunnel",
  "ngrok",
  "frp-client"
]);

function defaultCanonicalOrigin(): string | null {
  const configured = readIdentityEnv("PUBLIC_BASE_URL")?.trim();
  return configured || null;
}

function normalizeCanonicalForComparison(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return value.trim() || null;
  }
}

function normalizeCandidateOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PublicRouteCandidateValidationError(
      "candidate-origin-invalid",
      "Candidate Public Route origin is required"
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PublicRouteCandidateValidationError(
      "candidate-origin-invalid",
      "Candidate Public Route must be a valid HTTPS origin"
    );
  }

  if (parsed.protocol !== "https:") {
    throw new PublicRouteCandidateValidationError(
      "candidate-https-required",
      "Candidate Public Route must use HTTPS"
    );
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    throw new PublicRouteCandidateValidationError(
      "candidate-origin-invalid",
      "Candidate Public Route must be an HTTPS origin without credentials, path, query, or fragment"
    );
  }

  return parsed.origin;
}

function requireSource(value: PublicRouteCandidateSource): PublicRouteCandidateSource {
  if (!VALID_SOURCES.has(value)) {
    throw new PublicRouteCandidateValidationError(
      "candidate-source-invalid",
      "Candidate Public Route source is unsupported"
    );
  }
  return value;
}

function parseCandidate(value: unknown): PublicRouteCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRouteCandidateValidationError(
      "candidate-state-invalid",
      "Candidate Public Route state is invalid"
    );
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const origin = typeof record.origin === "string" ? record.origin : "";
  const source = record.source as PublicRouteCandidateSource;
  const status = record.status;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : "";

  if (
    !id ||
    !createdAt ||
    !updatedAt ||
    status !== "staged-unverified" ||
    !VALID_SOURCES.has(source)
  ) {
    throw new PublicRouteCandidateValidationError(
      "candidate-state-invalid",
      "Candidate Public Route state is invalid"
    );
  }

  const normalizedOrigin = normalizeCandidateOrigin(origin);
  return {
    id,
    origin: normalizedOrigin,
    source,
    status: "staged-unverified",
    createdAt,
    updatedAt
  };
}

export class PublicRouteCandidateStore {
  private readonly runtimeDir: string;
  private readonly statePath: string;
  private readonly canonicalOrigin: () => string | null;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: PublicRouteCandidateStoreOptions) {
    this.runtimeDir = options.runtimeDir;
    this.statePath = path.join(options.runtimeDir, STATE_FILE_NAME);
    this.canonicalOrigin = options.canonicalOrigin ?? defaultCanonicalOrigin;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
  }

  snapshot(): PublicRouteCandidateSnapshot {
    const canonicalOrigin = this.canonicalOrigin()?.trim() || null;
    return {
      ok: true,
      schemaVersion: PUBLIC_ROUTE_CANDIDATE_SCHEMA_VERSION,
      canonical: {
        origin: canonicalOrigin,
        configured: Boolean(canonicalOrigin),
        source: "runtime-config"
      },
      candidate: this.readCandidate()
    };
  }

  stage(input: {
    origin: string;
    source: PublicRouteCandidateSource;
  }): PublicRouteCandidateSnapshot {
    const origin = normalizeCandidateOrigin(input.origin);
    const source = requireSource(input.source);
    const canonical = normalizeCanonicalForComparison(this.canonicalOrigin());
    if (canonical && canonical === origin) {
      throw new PublicRouteCandidateValidationError(
        "candidate-already-canonical",
        "Candidate Public Route already matches the canonical Runtime origin"
      );
    }

    const timestamp = this.now();
    const candidate: PublicRouteCandidate = {
      id: this.createId(),
      origin,
      source,
      status: "staged-unverified",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.writeCandidate(candidate);
    return this.snapshot();
  }

  clear(): PublicRouteCandidateSnapshot {
    try {
      fs.unlinkSync(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return this.snapshot();
  }

  private readCandidate(): PublicRouteCandidate | null {
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
      throw new PublicRouteCandidateValidationError(
        "candidate-state-invalid",
        "Candidate Public Route state is invalid"
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PublicRouteCandidateValidationError(
        "candidate-state-invalid",
        "Candidate Public Route state is invalid"
      );
    }
    const envelope = parsed as Partial<PersistedCandidateEnvelope>;
    if (envelope.schemaVersion !== PUBLIC_ROUTE_CANDIDATE_SCHEMA_VERSION) {
      throw new PublicRouteCandidateValidationError(
        "candidate-state-invalid",
        "Candidate Public Route state schema is unsupported"
      );
    }
    return parseCandidate(envelope.candidate);
  }

  private writeCandidate(candidate: PublicRouteCandidate): void {
    fs.mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    const envelope: PersistedCandidateEnvelope = {
      schemaVersion: PUBLIC_ROUTE_CANDIDATE_SCHEMA_VERSION,
      candidate
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
