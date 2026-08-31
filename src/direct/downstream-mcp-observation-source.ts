import { createHash } from "node:crypto";

import type { TokenPilotPaths } from "../types.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpExecutorsConfig
} from "./downstream-mcp-config.js";
import {
  probeConfiguredDownstreamMcpExecutors,
  type DownstreamMcpProbeSummary
} from "./downstream-mcp-operator.js";

const DEFAULT_CACHE_TTL_MS = 15_000;

export interface DownstreamMcpObservationSourceOptions {
  paths: TokenPilotPaths;
  configPath?: string;
  cacheTtlMs?: number;
  now?: () => number;
  loadConfig?: () => DownstreamMcpExecutorsConfig;
  probeConfigured?: (options: {
    paths: TokenPilotPaths;
    configPath?: string;
    config: DownstreamMcpExecutorsConfig;
  }) => Promise<DownstreamMcpProbeSummary[]>;
}
interface CachedObservation {
  fingerprint: string;
  expiresAt: number;
  summaries: DownstreamMcpProbeSummary[];
}

interface ActiveObservation {
  fingerprint: string;
  promise: Promise<DownstreamMcpProbeSummary[]>;
}

function configFingerprint(config: DownstreamMcpExecutorsConfig): string {
  return createHash("sha256")
    .update(JSON.stringify(config), "utf8")
    .digest("hex");
}

function cloneSummaries(
  summaries: DownstreamMcpProbeSummary[]
): DownstreamMcpProbeSummary[] {
  return summaries.map((summary) => ({
    ...summary,
    verifiedCapabilities: [...summary.verifiedCapabilities]
  }));
}

export class DownstreamMcpObservationSource {
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly loadConfigValue: () => DownstreamMcpExecutorsConfig;
  private readonly probeConfiguredValue: NonNullable<
    DownstreamMcpObservationSourceOptions["probeConfigured"]
  >;
  private cache: CachedObservation | null = null;
  private active: ActiveObservation | null = null;

  constructor(private readonly options: DownstreamMcpObservationSourceOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new Error("Downstream MCP observation cache TTL must be non-negative");
    }
    this.now = options.now ?? Date.now;
    this.loadConfigValue =
      options.loadConfig ?? (() => loadDownstreamMcpExecutorsConfig(options.configPath));
    this.probeConfiguredValue =
      options.probeConfigured ?? probeConfiguredDownstreamMcpExecutors;
  }

  loadConfig(): DownstreamMcpExecutorsConfig {
    return this.loadConfigValue();
  }

  invalidate(): void {
    this.cache = null;
  }
  async probe(): Promise<DownstreamMcpProbeSummary[]> {
    const config = this.loadConfig();
    const fingerprint = configFingerprint(config);
    const now = this.now();

    if (
      this.cache &&
      this.cache.fingerprint === fingerprint &&
      this.cache.expiresAt > now
    ) {
      return cloneSummaries(this.cache.summaries);
    }

    if (this.active?.fingerprint === fingerprint) {
      return cloneSummaries(await this.active.promise);
    }

    const promise = this.probeConfiguredValue({
      paths: this.options.paths,
      ...(this.options.configPath ? { configPath: this.options.configPath } : {}),
      config
    });
    this.active = { fingerprint, promise };
    try {
      const summaries = await promise;
      if (this.active?.promise === promise) {
        this.cache = {
          fingerprint,
          expiresAt: this.now() + this.cacheTtlMs,
          summaries: cloneSummaries(summaries)
        };
      }
      return cloneSummaries(summaries);
    } finally {
      if (this.active?.promise === promise) {
        this.active = null;
      }
    }
  }
}
