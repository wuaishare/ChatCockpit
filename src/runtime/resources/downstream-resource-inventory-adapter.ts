import { ServiceError } from "../../application/service-error.js";
import {
  buildRuntimeProfileId,
  buildRuntimeResourceId,
  hashRuntimeResource
} from "../../application/runtime-resource-hash.js";
import type {
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryAdapter,
  RuntimeResourceInventoryProjection,
  RuntimeResourceInventoryRequest
} from "../../application/runtime-resource-types.js";
import type { DownstreamMcpExecutorsConfig } from "../../direct/downstream-mcp-config.js";
import type { DownstreamMcpProbeSummary } from "../../direct/downstream-mcp-operator.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  type ProductIdentity
} from "../../core/product-identity.js";

interface DownstreamResourceInventorySource {
  loadConfig(): DownstreamMcpExecutorsConfig;
  probe(): Promise<DownstreamMcpProbeSummary[]>;
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

function compatibilityFromHealth(
  health: DownstreamMcpProbeSummary["health"]
): RuntimeResourceDescriptor["compatibilityStatus"] {
  if (health === "ready") return "ready";
  if (health === "degraded") return "degraded";
  return "blocked";
}

export class DownstreamResourceInventoryAdapter
  implements RuntimeResourceInventoryAdapter
{
  readonly providerKind = "downstream-mcp";
  readonly protocolKind = "mcp-legacy-stdio";

  constructor(
    private readonly source: DownstreamResourceInventorySource,
    private readonly identity: ProductIdentity = DEFAULT_PRODUCT_IDENTITY
  ) {}

  async inventory(
    input: RuntimeResourceInventoryRequest
  ): Promise<RuntimeResourceInventoryProjection> {
    if (
      input.profile.providerKind !== "downstream-mcp" ||
      input.profile.protocolKind !== "mcp-legacy-stdio"
    ) {
      throw new ServiceError(
        "RUNTIME_PROFILE_MISMATCH",
        "Downstream Resource Inventory requires a downstream MCP profile"
      );
    }

    const config = this.source.loadConfig();
    const executor = config.executors.find(
      (candidate) =>
        buildRuntimeProfileId({
          providerKind: "downstream-mcp",
          protocolKind: "mcp-legacy-stdio",
          instanceIdentity: candidate.id
        }) === input.profile.id
    );
    if (!executor) {
      throw new ServiceError(
        "RUNTIME_PROFILE_NOT_FOUND",
        "Downstream Runtime Profile no longer matches a configured executor"
      );
    }

    let summaries: DownstreamMcpProbeSummary[];
    try {
      summaries = await this.source.probe();
    } catch (error) {
      return {
        profile: input.profile,
        resources: [],
        diagnostics: [
          {
            source: `downstream-mcp:${executor.id}`,
            status: "failed",
            code:
              error instanceof Error && "code" in error
                ? String((error as { code?: unknown }).code ?? "DOWNSTREAM_MCP_PROBE_FAILED")
                : "DOWNSTREAM_MCP_PROBE_FAILED",
            message:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Downstream MCP probe failed"
          }
        ]
      };
    }

    const summary = summaries.find((entry) => entry.executorId === executor.id);
    if (!summary) {
      throw new ServiceError(
        "RUNTIME_PROFILE_NOT_FOUND",
        "Downstream Runtime Profile probe returned no matching executor"
      );
    }

    const verified = new Set(summary.verifiedCapabilities);
    const mappings = executor.mappings.filter((mapping) =>
      verified.has(mapping.capability)
    );
    const capabilities = new Set<string>();
    for (const mapping of mappings) {
      capabilities.add(`capability:${mapping.capability}`);
      for (const scope of mapping.scopes) capabilities.add(`scope:${scope}`);
      for (const access of mapping.access) capabilities.add(`access:${access}`);
    }
    const publicCapabilities = [...capabilities].sort();
    const compatibilityStatus = compatibilityFromHealth(summary.health);
    const enabled = summary.health !== "unavailable";

    const serverExternalId = `mcp:${executor.id}:${summary.serverName}`;
    const server = finalizeResource({
      id: buildRuntimeResourceId({
        runtimeProfileId: input.profile.id,
        kind: "mcp-server",
        externalId: serverExternalId
      }),
      runtimeProfileId: input.profile.id,
      kind: "mcp-server",
      externalId: serverExternalId,
      displayName: summary.serverName || executor.displayName,
      description: `Verified downstream MCP server with ${summary.verifiedCapabilities.length} ${this.identity.displayName} capabilities`,
      scope: "runtime",
      installed: true,
      enabled,
      version: summary.serverVersion || null,
      availableVersion: null,
      updateStatus: "unknown",
      authStatus: "not-applicable",
      compatibilityStatus,
      sourceKind: this.identity.localResourceSourceKind,
      sourceLabel: `${this.identity.displayName} Downstream MCP`,
      capabilities: publicCapabilities,
      publicReason:
        summary.health === "ready"
          ? null
          : `Downstream MCP server health is ${summary.health}`
    });

    const adapterExternalId = `adapter:${executor.id}`;
    const runtimeAdapter = finalizeResource({
      id: buildRuntimeResourceId({
        runtimeProfileId: input.profile.id,
        kind: "runtime-adapter",
        externalId: adapterExternalId
      }),
      runtimeProfileId: input.profile.id,
      kind: "runtime-adapter",
      externalId: adapterExternalId,
      displayName: `${executor.displayName} Adapter`,
      description: `${this.identity.displayName} governed downstream MCP capability adapter`,
      scope: "runtime",
      installed: true,
      enabled,
      version: null,
      availableVersion: null,
      updateStatus: "not-applicable",
      authStatus: "not-applicable",
      compatibilityStatus,
      sourceKind: this.identity.localResourceSourceKind,
      sourceLabel: this.identity.displayName,
      capabilities: publicCapabilities,
      publicReason:
        summary.health === "ready"
          ? null
          : `Downstream MCP adapter health is ${summary.health}`
    });

    return {
      profile: input.profile,
      resources: [server, runtimeAdapter].sort((left, right) =>
        left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
      ),
      diagnostics: [
        {
          source: `downstream-mcp:${executor.id}`,
          status: summary.health === "ready" ? "ready" : "degraded",
          code: summary.health === "ready" ? null : "DOWNSTREAM_MCP_DEGRADED",
          message:
            summary.health === "ready"
              ? null
              : `Downstream MCP probe health is ${summary.health}`
        }
      ]
    };
  }
}
