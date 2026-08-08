import type { TokenPilotPaths } from "../types.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpStdioExecutorConfig
} from "./downstream-mcp-config.js";
import { probeDownstreamMcpExecutor } from "./downstream-mcp-probe.js";
import { DownstreamMcpCapabilityStore } from "./downstream-mcp-snapshot.js";
import { DownstreamMcpStdioClient } from "./downstream-mcp-stdio-client.js";

export interface DownstreamMcpProbeSummary {
  executorId: string;
  displayName: string;
  health: "ready" | "degraded" | "unavailable";
  protocolFamily: "mcp-legacy-stdio";
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  verifiedCapabilities: string[];
  snapshotPath: string;
}

function buildClient(executor: DownstreamMcpStdioExecutorConfig) {
  return new DownstreamMcpStdioClient({
    command: executor.transport.command,
    args: executor.transport.args,
    ...(executor.transport.cwd ? { cwd: executor.transport.cwd } : {}),
    env: {
      ...process.env,
      ...(executor.transport.env ?? {})
    },
    timeoutMs: executor.transport.timeoutMs,
    maxBufferBytes: executor.transport.maxBufferBytes,
    maxStderrBytes: executor.transport.maxStderrBytes
  });
}

export async function probeConfiguredDownstreamMcpExecutors(options: {
  paths: TokenPilotPaths;
  executorId?: string;
  configPath?: string;
}): Promise<DownstreamMcpProbeSummary[]> {
  const config = loadDownstreamMcpExecutorsConfig(options.configPath);
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
      client: buildClient(executor),
      store,
      config: {
        executorId: executor.id,
        displayName: executor.displayName,
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
