import type {
  DownstreamMcpCapabilityMapping,
  DownstreamMcpCapabilitySnapshot,
  DownstreamMcpCapabilitySnapshotMapping,
  DownstreamMcpClient,
  DownstreamMcpProbeConfig
} from "./downstream-mcp-types.js";
import { DownstreamMcpCapabilityStore } from "./downstream-mcp-snapshot.js";

function normalizeMapping(
  mapping: DownstreamMcpCapabilityMapping,
  observedTools: Set<string>
): DownstreamMcpCapabilitySnapshotMapping {
  if (
    !mapping.toolName.trim() ||
    mapping.scopes.length === 0 ||
    mapping.access.length === 0
  ) {
    return {
      ...mapping,
      scopes: [...mapping.scopes],
      access: [...mapping.access],
      status: "rejected",
      errorCode: "INVALID_MAPPING"
    };
  }

  if (!observedTools.has(mapping.toolName)) {
    return {
      ...mapping,
      scopes: [...mapping.scopes],
      access: [...mapping.access],
      status: "missing",
      errorCode: "TOOL_NOT_FOUND"
    };
  }

  return {
    ...mapping,
    scopes: [...mapping.scopes],
    access: [...mapping.access],
    status: "verified",
    errorCode: null
  };
}

function deriveHealth(
  mappings: DownstreamMcpCapabilitySnapshotMapping[]
): DownstreamMcpCapabilitySnapshot["health"] {
  const verified = mappings.filter((mapping) => mapping.status === "verified");
  if (verified.length === 0) {
    return "unavailable";
  }
  return verified.length === mappings.length ? "ready" : "degraded";
}

export async function probeDownstreamMcpExecutor(options: {
  client: DownstreamMcpClient;
  config: DownstreamMcpProbeConfig;
  store: DownstreamMcpCapabilityStore;
  now?: string;
}): Promise<DownstreamMcpCapabilitySnapshot> {
  const { client, config, store } = options;
  try {
    const listed = await client.listTools();
    const observedTools = new Set(listed.tools.map((tool) => tool.name));
    const mappings = config.mappings.map((mapping) =>
      normalizeMapping(mapping, observedTools)
    );
    const snapshot: DownstreamMcpCapabilitySnapshot = {
      schemaVersion: 1,
      executorId: config.executorId,
      displayName: config.displayName,
      protocolFamily: "mcp-legacy-stdio",
      protocolVersion: listed.server.protocolVersion,
      serverName: listed.server.name,
      serverVersion: listed.server.version,
      probedAt: options.now ?? new Date().toISOString(),
      health: deriveHealth(mappings),
      toolsObserved: Array.from(observedTools).sort(),
      mappings
    };
    store.write(snapshot);
    return snapshot;
  } finally {
    await client.close();
  }
}
