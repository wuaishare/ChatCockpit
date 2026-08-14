import fs from "node:fs";
import path from "node:path";

export type CodexStandaloneCapabilityStatus =
  | "verified"
  | "unavailable"
  | "failed";

export type CodexStandaloneOperation =
  | "files.read"
  | "files.write"
  | "files.list"
  | "files.metadata"
  | "files.createDirectory"
  | "files.copy"
  | "files.remove"
  | "search.fileName"
  | "search.content"
  | "command.exec"
  | "git.native";

export interface CodexStandaloneOperationCapability {
  operation: CodexStandaloneOperation;
  method: string | null;
  status: CodexStandaloneCapabilityStatus;
  safeForChatDirect: boolean;
  errorCode: string | null;
  evidence: Record<string, boolean | number | string | null>;
}

export interface CodexStandaloneCapabilitySnapshot {
  schemaVersion: 1;
  runtime: "codex-app-server";
  protocolFamily: "app-server-v2";
  binarySource: string | null;
  binaryVersion: string | null;
  serverProtocolVersion: string | null;
  probedAt: string;
  operations: Record<
    CodexStandaloneOperation,
    CodexStandaloneOperationCapability
  >;
  outgoingMethods: string[];
  turnStartObserved: boolean;
  directExecutionReady: boolean;
}

function snapshotPath(runtimeDir: string): string {
  return path.join(
    runtimeDir,
    "capabilities",
    "codex-app-server-standalone.json"
  );
}

function isSnapshot(value: unknown): value is CodexStandaloneCapabilitySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    record.runtime === "codex-app-server" &&
    record.protocolFamily === "app-server-v2" &&
    typeof record.probedAt === "string" &&
    Array.isArray(record.outgoingMethods) &&
    typeof record.turnStartObserved === "boolean" &&
    typeof record.directExecutionReady === "boolean" &&
    Boolean(record.operations && typeof record.operations === "object")
  );
}

export class CodexStandaloneCapabilityStore {
  constructor(private readonly runtimeDir: string) {}

  read(): CodexStandaloneCapabilitySnapshot | null {
    const filePath = snapshotPath(this.runtimeDir);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      return isSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  write(snapshot: CodexStandaloneCapabilitySnapshot): void {
    const filePath = snapshotPath(this.runtimeDir);
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

  publicPath(): string {
    const stateDirName = path.basename(path.dirname(this.runtimeDir));
    return `${stateDirName}/runtime/capabilities/codex-app-server-standalone.json`;
  }
}
