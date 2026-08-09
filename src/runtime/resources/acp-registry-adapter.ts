import { z } from "zod";

import { ServiceError } from "../../application/service-error.js";
import {
  buildRuntimeProfileId,
  buildRuntimeResourceId,
  hashRuntimeResource
} from "../../application/runtime-resource-hash.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryAdapter,
  RuntimeResourceInventoryProjection,
  RuntimeResourceInventoryRequest
} from "../../application/runtime-resource-types.js";
import type { RuntimeProfileSourceAdapter } from "./runtime-profile-registry.js";

export const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const MAX_REGISTRY_AGENTS = 1000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const platformNames = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-aarch64",
  "linux-x86_64",
  "windows-aarch64",
  "windows-x86_64"
] as const;
const platformSet = new Set<string>(platformNames);

const packageDistributionSchema = z
  .object({
    package: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional()
  })
  .strict();

const binaryTargetSchema = z
  .object({
    archive: z.string().url(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    cmd: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional()
  })
  .strict();

const binaryDistributionSchema = z
  .record(z.string(), binaryTargetSchema)
  .superRefine((value, context) => {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ACP binary distribution must contain at least one platform"
      });
    }
    for (const key of keys) {
      if (!platformSet.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Unsupported ACP registry platform: ${key}`
        });
      }
    }
  });

const distributionSchema = z
  .object({
    binary: binaryDistributionSchema.optional(),
    npx: packageDistributionSchema.optional(),
    uvx: packageDistributionSchema.optional()
  })
  .strict()
  .refine(
    (value) => Boolean(value.binary || value.npx || value.uvx),
    "ACP agent distribution must contain binary, npx, or uvx"
  );

const agentSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1).max(200),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+/).max(200),
    description: z.string().min(1).max(5000),
    distribution: distributionSchema,
    repository: z.string().url().optional(),
    website: z.string().url().optional(),
    authors: z.array(z.string()).optional(),
    license: z.string().optional(),
    icon: z.string().url().optional()
  })
  .passthrough();

const registrySchema = z
  .object({
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+/).max(100),
    agents: z.array(agentSchema).max(MAX_REGISTRY_AGENTS)
  })
  .strict();

type AcpRegistry = z.infer<typeof registrySchema>;
type AcpRegistryAgent = z.infer<typeof agentSchema>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface AcpRegistryAdapterOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

type ResourceWithoutFingerprint = Omit<RuntimeResourceDescriptor, "fingerprint">;

function finalizeResource(
  resource: ResourceWithoutFingerprint
): RuntimeResourceDescriptor {
  const normalized = {
    ...resource,
    capabilities: [...resource.capabilities].sort()
  };
  return {
    ...normalized,
    fingerprint: hashRuntimeResource(normalized)
  };
}

function distributionCapabilities(agent: AcpRegistryAgent): string[] {
  const capabilities = new Set<string>(["acp", "auth-supported"]);
  if (agent.distribution.npx) capabilities.add("distribution:npx");
  if (agent.distribution.uvx) capabilities.add("distribution:uvx");
  if (agent.distribution.binary) {
    capabilities.add("distribution:binary");
    for (const platform of Object.keys(agent.distribution.binary)) {
      capabilities.add(`platform:${platform}`);
    }
  }
  return [...capabilities].sort();
}

export class AcpRegistryAdapter
  implements RuntimeProfileSourceAdapter, RuntimeResourceInventoryAdapter
{
  readonly sourceKind = "acp-registry";
  readonly providerKind = "acp-registry";
  readonly protocolKind = "registry-v1";
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private cache: { expiresAt: number; registry: AcpRegistry } | null = null;

  constructor(options: AcpRegistryAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async listProfiles(): Promise<RuntimeProfileDescriptor[]> {
    const registry = await this.loadRegistry();
    return [this.profileFor(registry)];
  }

  async inventory(
    input: RuntimeResourceInventoryRequest
  ): Promise<RuntimeResourceInventoryProjection> {
    if (
      input.profile.providerKind !== "acp-registry" ||
      input.profile.protocolKind !== "registry-v1"
    ) {
      throw new ServiceError(
        "RUNTIME_PROFILE_MISMATCH",
        "ACP Registry inventory requires the official registry profile"
      );
    }
    const registry = await this.loadRegistry();
    const expectedProfile = this.profileFor(registry);
    if (input.profile.id !== expectedProfile.id) {
      throw new ServiceError(
        "RUNTIME_PROFILE_MISMATCH",
        "ACP Registry Runtime Profile identity does not match the official registry"
      );
    }

    const resources = registry.agents
      .map((agent) => this.resourceFor(expectedProfile, agent))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName) ||
        left.id.localeCompare(right.id)
      );
    return {
      profile: expectedProfile,
      resources,
      diagnostics: [
        {
          source: "acp-registry",
          status: "ready",
          code: null,
          message: `ACP Registry ${registry.version} loaded with ${resources.length} agents`
        }
      ]
    };
  }

  private profileFor(registry: AcpRegistry): RuntimeProfileDescriptor {
    return {
      id: buildRuntimeProfileId({
        providerKind: "acp-registry",
        protocolKind: "registry-v1",
        instanceIdentity: "official"
      }),
      providerKind: "acp-registry",
      protocolKind: "registry-v1",
      displayName: "ACP Agent Registry",
      executableSource: "registry",
      executableVersion: registry.version,
      protocolVersion: "1",
      compatibilityStatus: "ready",
      homeIdentityHash: null,
      authStatus: "not-applicable",
      capabilities: ["catalog:agents", "catalog:distribution-metadata"],
      publicReason: null
    };
  }

  private resourceFor(
    profile: RuntimeProfileDescriptor,
    agent: AcpRegistryAgent
  ): RuntimeResourceDescriptor {
    const externalId = `acp:${agent.id}`;
    return finalizeResource({
      id: buildRuntimeResourceId({
        runtimeProfileId: profile.id,
        kind: "acp-agent",
        externalId
      }),
      runtimeProfileId: profile.id,
      kind: "acp-agent",
      externalId,
      displayName: agent.name,
      description: agent.description.slice(0, 1000),
      scope: "registry",
      installed: false,
      enabled: null,
      version: agent.version,
      availableVersion: agent.version,
      updateStatus: "not-applicable",
      authStatus: "unknown",
      compatibilityStatus: "ready",
      sourceKind: "acp-registry",
      sourceLabel: "ACP Registry",
      capabilities: distributionCapabilities(agent),
      publicReason: null
    });
  }

  private async loadRegistry(): Promise<AcpRegistry> {
    const now = this.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.registry;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(ACP_REGISTRY_URL, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "TokenPilot-Runtime-Resource-Center/0.1"
        }
      });
    } catch (error) {
      throw new ServiceError(
        "ACP_REGISTRY_FETCH_FAILED",
        "Unable to fetch the official ACP Registry",
        {
          details: {
            cause: error instanceof Error ? error.name : "FETCH_FAILED"
          }
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ServiceError(
        "ACP_REGISTRY_FETCH_FAILED",
        `Official ACP Registry returned HTTP ${response.status}`
      );
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_REGISTRY_BYTES) {
      throw new ServiceError(
        "ACP_REGISTRY_TOO_LARGE",
        "Official ACP Registry response exceeds the configured size limit"
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REGISTRY_BYTES) {
      throw new ServiceError(
        "ACP_REGISTRY_TOO_LARGE",
        "Official ACP Registry response exceeds the configured size limit"
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new ServiceError(
        "ACP_REGISTRY_INVALID",
        "Official ACP Registry returned invalid JSON"
      );
    }
    const parsed = registrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ServiceError(
        "ACP_REGISTRY_INVALID",
        "Official ACP Registry failed TokenPilot schema validation",
        {
          details: {
            issueCount: parsed.error.issues.length
          }
        }
      );
    }

    this.cache = {
      expiresAt: now + this.cacheTtlMs,
      registry: parsed.data
    };
    return parsed.data;
  }
}
