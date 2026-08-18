import { ServiceError } from "./service-error.js";
import { downstreamMcpProtocolFamily } from "../direct/downstream-mcp-client-factory.js";
import { loadDownstreamMcpExecutorsConfig } from "../direct/downstream-mcp-config.js";
import { DownstreamMcpCapabilityStore } from "../direct/downstream-mcp-snapshot.js";
import type { DownstreamMcpToolCatalogEntry } from "../direct/downstream-mcp-types.js";
import {
  buildLocalDeviceTarget,
  type DeviceTargetDescriptor
} from "../devices/local-device.js";

export type CapabilityRouterToolStatus =
  | "ready"
  | "metadata-limited"
  | "missing"
  | "provider-unavailable";

export interface CapabilityRouterToolProjection {
  executorId: string;
  providerDisplayName: string;
  protocolFamily: "mcp-legacy-stdio" | "mcp-streamable-http";
  toolName: string;
  mode: "read" | "mutation";
  description: string | null;
  metadataStatus: DownstreamMcpToolCatalogEntry["metadataStatus"] | "unavailable";
  status: CapabilityRouterToolStatus;
}

export interface CapabilityRouterProviderProjection {
  executorId: string;
  displayName: string;
  protocolFamily: "mcp-legacy-stdio" | "mcp-streamable-http";
  health: "ready" | "degraded" | "unavailable";
  catalogStatus: "ready" | "missing" | "stale";
  serverName: string | null;
  serverVersion: string | null;
  tools: CapabilityRouterToolProjection[];
}

export interface CapabilityRouterToolInspection extends CapabilityRouterToolProjection {
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
}

export interface CapabilityRouterCatalogProjection {
  target: DeviceTargetDescriptor;
  providers: CapabilityRouterProviderProjection[];
}

function toolStatus(
  providerHealth: CapabilityRouterProviderProjection["health"],
  catalog: DownstreamMcpToolCatalogEntry | null
): CapabilityRouterToolStatus {
  if (providerHealth === "unavailable") return "provider-unavailable";
  if (!catalog) return "missing";
  return catalog.metadataStatus === "ready" ? "ready" : "metadata-limited";
}

export class CapabilityRouterCatalogService {
  private readonly store: DownstreamMcpCapabilityStore;

  constructor(
    runtimeDir: string,
    private readonly configPath?: string
  ) {
    this.store = new DownstreamMcpCapabilityStore(runtimeDir);
  }

  list(input: { executorId?: string } = {}): CapabilityRouterCatalogProjection {
    const config = loadDownstreamMcpExecutorsConfig(this.configPath);
    const providers = config.executors
      .filter((executor) => executor.router?.enabled === true)
      .filter(
        (executor) => !input.executorId || executor.id === input.executorId
      )
      .map((executor) => {
        const storedSnapshot = this.store.read(executor.id);
        const protocolFamily = downstreamMcpProtocolFamily(executor);
        const snapshot =
          storedSnapshot?.protocolFamily === protocolFamily ? storedSnapshot : null;
        const catalogStatus = storedSnapshot
          ? snapshot
            ? "ready"
            : "stale"
          : "missing";
        const health = snapshot?.health ?? "unavailable";
        const tools = (executor.router?.tools ?? [])
          .map((exposure) => {
            const catalog =
              snapshot?.toolCatalog.find(
                (entry) => entry.name === exposure.toolName
              ) ?? null;
            return {
              executorId: executor.id,
              providerDisplayName: executor.displayName,
              protocolFamily,
              toolName: exposure.toolName,
              mode: exposure.mode,
              description: catalog?.description ?? null,
              metadataStatus: catalog?.metadataStatus ?? "unavailable",
              status: toolStatus(health, catalog)
            } satisfies CapabilityRouterToolProjection;
          })
          .sort((left, right) => left.toolName.localeCompare(right.toolName));

        return {
          executorId: executor.id,
          displayName: executor.displayName,
          protocolFamily,
          health,
          catalogStatus,
          serverName: snapshot?.serverName ?? null,
          serverVersion: snapshot?.serverVersion ?? null,
          tools
        } satisfies CapabilityRouterProviderProjection;
      })
      .sort((left, right) => left.executorId.localeCompare(right.executorId));

    return {
      target: buildLocalDeviceTarget(),
      providers
    };
  }

  inspect(input: {
    executorId: string;
    toolName: string;
  }): CapabilityRouterToolInspection {
    const provider = this.list({ executorId: input.executorId }).providers[0];
    if (!provider) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_PROVIDER_NOT_FOUND",
        "Capability Router provider is not exposed"
      );
    }
    const tool = provider.tools.find((entry) => entry.toolName === input.toolName);
    if (!tool) {
      throw new ServiceError(
        "CAPABILITY_ROUTER_TOOL_NOT_FOUND",
        "Capability Router tool is not exposed"
      );
    }

    const snapshot = this.store.read(input.executorId);
    const catalog =
      snapshot?.protocolFamily === provider.protocolFamily
        ? snapshot.toolCatalog.find((entry) => entry.name === input.toolName) ?? null
        : null;
    return {
      ...tool,
      inputSchema: catalog?.inputSchema ? structuredClone(catalog.inputSchema) : null,
      outputSchema: catalog?.outputSchema ? structuredClone(catalog.outputSchema) : null,
      annotations: catalog?.annotations ? structuredClone(catalog.annotations) : null
    };
  }
}
