import type { TokenPilotPaths } from "../types.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpExecutorsConfig
} from "./downstream-mcp-config.js";
import {
  createDownstreamMcpClient,
  downstreamMcpProtocolFamily
} from "./downstream-mcp-client-factory.js";
import { probeDownstreamMcpExecutor } from "./downstream-mcp-probe.js";
import { DownstreamMcpCapabilityStore } from "./downstream-mcp-snapshot.js";

export interface DownstreamMcpProbeSummary {
  executorId: string;
  displayName: string;
  health: "ready" | "degraded" | "unavailable";
  protocolFamily: "mcp-legacy-stdio" | "mcp-streamable-http";
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  verifiedCapabilities: string[];
  snapshotPath: string;
}

export async function probeConfiguredDownstreamMcpExecutors(options: {
  paths: TokenPilotPaths;
  executorId?: string;
  configPath?: string;
  config?: DownstreamMcpExecutorsConfig;
}): Promise<DownstreamMcpProbeSummary[]> {
  const config = options.config ?? loadDownstreamMcpExecutorsConfig(options.configPath);
  const executors = options.executorId
    ? config.executors.filter((executor) => executor.id === options.executorId)
    : config.executors;

  if (options.executorId && executors.length === 0) {
    throw new Error(`Configured Direct executor not found: ${options.executorId}`);
  }
  if (executors.length === 0) {
    return [];
  }

  const store = new DownstreamMcpCapabilityStore(options.paths.runtimeDir);
  const summaries: DownstreamMcpProbeSummary[] = [];
  for (const executor of executors) {
    const snapshot = await probeDownstreamMcpExecutor({
      client: createDownstreamMcpClient(executor),
      store,
      config: {
        executorId: executor.id,
        displayName: executor.displayName,
        protocolFamily: downstreamMcpProtocolFamily(executor),
        mappings: executor.mappings
      }
    });
    summaries.push({
      executorId: snapshot.executorId,
      displayName: snapshot.displayName,
      health: snapshot.health,
      protocolFamily: snapshot.protocolFamily,
      protocolVersion: snapshot.protocolVersion,
      serverName: snapshot.serverName,
      serverVersion: snapshot.serverVersion,
      verifiedCapabilities: snapshot.mappings
        .filter((mapping) => mapping.status === "verified")
        .map((mapping) => mapping.capability)
        .sort(),
      snapshotPath: store.publicPath(snapshot.executorId)
    });
  }
  return summaries;
}
