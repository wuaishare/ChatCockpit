import fs from "node:fs";
import path from "node:path";

import type {
  DownstreamMcpCapabilitySnapshot,
  DownstreamMcpToolCatalogEntry
} from "./downstream-mcp-types.js";
import { legacyDownstreamMcpToolCatalog } from "./downstream-mcp-tool-catalog.js";

const EXECUTOR_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/;

function assertExecutorId(executorId: string): void {
  if (!EXECUTOR_ID_PATTERN.test(executorId)) {
    throw new Error("Downstream MCP executor id is invalid");
  }
}

function snapshotFileName(executorId: string): string {
  assertExecutorId(executorId);
  return `${encodeURIComponent(executorId)}.json`;
}

function snapshotPath(runtimeDir: string, executorId: string): string {
  return path.join(
    runtimeDir,
    "capabilities",
    "downstream-mcp",
    snapshotFileName(executorId)
  );
}

function isToolCatalogEntry(value: unknown): value is DownstreamMcpToolCatalogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    (record.description === null || typeof record.description === "string") &&
    (record.inputSchema === null ||
      (typeof record.inputSchema === "object" && !Array.isArray(record.inputSchema))) &&
    (record.outputSchema === null ||
      (typeof record.outputSchema === "object" && !Array.isArray(record.outputSchema))) &&
    (record.annotations === null ||
      (typeof record.annotations === "object" && !Array.isArray(record.annotations))) &&
    ["ready", "bounded", "legacy-summary-only"].includes(
      String(record.metadataStatus)
    )
  );
}

function normalizeSnapshot(value: unknown): DownstreamMcpCapabilitySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const toolsObserved = Array.isArray(record.toolsObserved)
    ? record.toolsObserved.filter((tool): tool is string => typeof tool === "string")
    : null;
  if (
    record.schemaVersion !== 1 ||
    typeof record.executorId !== "string" ||
    !EXECUTOR_ID_PATTERN.test(record.executorId) ||
    typeof record.displayName !== "string" ||
    record.protocolFamily !== "mcp-legacy-stdio" ||
    typeof record.protocolVersion !== "string" ||
    typeof record.serverName !== "string" ||
    typeof record.serverVersion !== "string" ||
    typeof record.probedAt !== "string" ||
    !["ready", "degraded", "unavailable"].includes(String(record.health)) ||
    toolsObserved === null ||
    toolsObserved.length !== (record.toolsObserved as unknown[]).length ||
    !Array.isArray(record.mappings)
  ) {
    return null;
  }

  const rawCatalog = record.toolCatalog;
  const toolCatalog =
    rawCatalog === undefined
      ? legacyDownstreamMcpToolCatalog(toolsObserved)
      : Array.isArray(rawCatalog) && rawCatalog.every(isToolCatalogEntry)
        ? rawCatalog
        : null;
  if (!toolCatalog) return null;

  return {
    ...(record as unknown as DownstreamMcpCapabilitySnapshot),
    toolsObserved: [...toolsObserved],
    toolCatalog: toolCatalog.map((tool) => ({
      ...tool,
      inputSchema: tool.inputSchema ? structuredClone(tool.inputSchema) : null,
      outputSchema: tool.outputSchema ? structuredClone(tool.outputSchema) : null,
      annotations: tool.annotations ? structuredClone(tool.annotations) : null
    }))
  };
}

export class DownstreamMcpCapabilityStore {
  constructor(private readonly runtimeDir: string) {}

  read(executorId: string): DownstreamMcpCapabilitySnapshot | null {
    const filePath = snapshotPath(this.runtimeDir, executorId);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      const snapshot = normalizeSnapshot(parsed);
      if (!snapshot || snapshot.executorId !== executorId) {
        return null;
      }
      return snapshot;
    } catch {
      return null;
    }
  }

  write(snapshot: DownstreamMcpCapabilitySnapshot): void {
    const filePath = snapshotPath(this.runtimeDir, snapshot.executorId);
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8"
    );
    fs.renameSync(temporaryPath, filePath);
  }

  publicPath(executorId: string): string {
    assertExecutorId(executorId);
    const stateDirName = path.basename(path.dirname(this.runtimeDir));
    return `${stateDirName}/runtime/capabilities/downstream-mcp/${snapshotFileName(executorId)}`;
  }
}
