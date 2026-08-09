import { buildRuntimeProfileId } from "../../application/runtime-resource-hash.js";
import type { RuntimeProfileDescriptor } from "../../application/runtime-resource-types.js";
import type { DownstreamMcpProbeSummary } from "../../direct/downstream-mcp-operator.js";
import type { RuntimeProfileSourceAdapter } from "./runtime-profile-registry.js";

interface DownstreamRuntimeProfileSource {
  probe(): Promise<DownstreamMcpProbeSummary[]>;
}

function compatibilityStatus(
  health: DownstreamMcpProbeSummary["health"]
): RuntimeProfileDescriptor["compatibilityStatus"] {
  if (health === "ready") return "ready";
  if (health === "degraded") return "degraded";
  return "unavailable";
}

export class DownstreamRuntimeProfileAdapter implements RuntimeProfileSourceAdapter {
  readonly sourceKind = "downstream-mcp";

  constructor(private readonly source: DownstreamRuntimeProfileSource) {}

  async listProfiles(): Promise<RuntimeProfileDescriptor[]> {
    const summaries = await this.source.probe();
    return summaries.map((summary) => ({
      id: buildRuntimeProfileId({
        providerKind: "downstream-mcp",
        protocolKind: summary.protocolFamily,
        instanceIdentity: summary.executorId
      }),
      providerKind: "downstream-mcp",
      protocolKind: summary.protocolFamily,
      displayName: summary.displayName,
      executableSource: null,
      executableVersion: summary.serverVersion || null,
      protocolVersion: summary.protocolVersion || null,
      compatibilityStatus: compatibilityStatus(summary.health),
      homeIdentityHash: null,
      authStatus: "not-applicable",
      capabilities: [...summary.verifiedCapabilities].sort(),
      publicReason:
        summary.health === "ready"
          ? null
          : `Downstream MCP executor health is ${summary.health}`
    }));
  }
}
