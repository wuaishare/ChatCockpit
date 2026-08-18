import type {
  DirectCapabilityAccess,
  DirectCapabilityId,
  DirectExecutionScope
} from "./capability-broker.js";

export interface DownstreamMcpToolSummary {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface DownstreamMcpToolCatalogEntry {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
  metadataStatus: "ready" | "bounded" | "legacy-summary-only";
}

export interface DownstreamMcpServerIdentity {
  name: string;
  version: string;
  protocolVersion: string;
}

export interface DownstreamMcpListToolsResult {
  server: DownstreamMcpServerIdentity;
  tools: DownstreamMcpToolSummary[];
}

export interface DownstreamMcpClient {
  initialize(): Promise<DownstreamMcpServerIdentity>;
  listTools(): Promise<DownstreamMcpListToolsResult>;
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface DownstreamMcpCapabilityMapping {
  capability: DirectCapabilityId;
  toolName: string;
  scopes: DirectExecutionScope[];
  access: DirectCapabilityAccess[];
}

export interface DownstreamMcpProbeConfig {
  executorId: string;
  displayName: string;
  mappings: DownstreamMcpCapabilityMapping[];
}

export type DownstreamMcpMappingStatus = "verified" | "missing" | "rejected";

export interface DownstreamMcpCapabilitySnapshotMapping
  extends DownstreamMcpCapabilityMapping {
  status: DownstreamMcpMappingStatus;
  errorCode: string | null;
}

export interface DownstreamMcpCapabilitySnapshot {
  schemaVersion: 1;
  executorId: string;
  displayName: string;
  protocolFamily: "mcp-legacy-stdio";
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  probedAt: string;
  health: "ready" | "degraded" | "unavailable";
  toolsObserved: string[];
  toolCatalog: DownstreamMcpToolCatalogEntry[];
  mappings: DownstreamMcpCapabilitySnapshotMapping[];
}
