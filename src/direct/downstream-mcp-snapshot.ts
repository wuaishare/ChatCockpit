import fs from "node:fs";
import path from "node:path";

import type { DownstreamMcpCapabilitySnapshot } from "./downstream-mcp-types.js";

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

function isSnapshot(value: unknown): value is DownstreamMcpCapabilitySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.executorId === "string" &&
    EXECUTOR_ID_PATTERN.test(record.executorId) &&
    typeof record.displayName === "string" &&
    record.protocolFamily === "mcp-legacy-stdio" &&
    typeof record.protocolVersion === "string" &&
    typeof record.serverName === "string" &&
    typeof record.serverVersion === "string" &&
    typeof record.probedAt === "string" &&
    ["ready", "degraded", "unavailable"].includes(String(record.health)) &&
    Array.isArray(record.toolsObserved) &&
    Array.isArray(record.mappings)
  );
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
      if (!isSnapshot(parsed) || parsed.executorId !== executorId) {
        return null;
      }
      return parsed;
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
