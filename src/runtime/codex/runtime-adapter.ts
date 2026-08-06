import type { CodexStandaloneCapabilitySnapshot } from "./standalone-capabilities.js";

export interface RuntimeCapabilitySnapshot {
  available: boolean;
  runtime: "codex-app-server";
  binarySource: string | null;
  binaryVersion: string | null;
  protocolFamily: "app-server-v2";
  serverProtocolVersion: string | null;
  stableMethods: string[];
  experimentalApiEnabled: boolean;
  standaloneExecution: CodexStandaloneCapabilitySnapshot | null;
  unavailableReason?: string;
}

export interface RuntimeThreadStatus {
  type: string;
  activeFlags?: string[];
}

export interface RuntimeThreadProjection {
  id: string;
  preview: string;
  modelProvider: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  recencyAt: number | null;
  sourceKind: string | null;
  status: RuntimeThreadStatus;
  projectId: string | null;
  workspaceId: string | null;
  repoId: string | null;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
}

export interface RuntimeThreadListInput {
  cursor?: string | null;
  limit?: number;
  workspaceId?: string;
  searchTerm?: string;
  archived?: boolean;
}

export interface RuntimeThreadListResult {
  data: RuntimeThreadProjection[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface RuntimeThreadReadInput {
  threadId: string;
  includeTurns?: boolean;
}

export interface RuntimeThreadResumeInput {
  threadId: string;
}

export interface RuntimeThreadForkInput {
  threadId: string;
  lastTurnId?: string | null;
}

export interface RuntimeTurnProjection {
  id: string;
  status: string;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  errorCode: string | null;
}

export interface RuntimeTurnStartInput {
  threadId: string;
  text: string;
  clientUserMessageId: string;
}

export interface RuntimeTurnInterruptInput {
  threadId: string;
  turnId: string;
}

export interface RuntimeStandaloneFileReadResult {
  dataBase64: string;
}

export interface RuntimeStandaloneDirectoryEntry {
  fileName: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface RuntimeStandaloneCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RuntimeInboundRequest {
  connectionId: string;
  requestKey: string;
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface RuntimeInboundNotification {
  connectionId: string;
  method: string;
  params: Record<string, unknown>;
}

export interface RuntimeEventSink {
  onRequest(request: RuntimeInboundRequest): void | Promise<void>;
  onNotification(
    notification: RuntimeInboundNotification
  ): void | Promise<void>;
}

export interface CodingRuntimeAdapter {
  capabilities(): Promise<RuntimeCapabilitySnapshot>;
  listThreads(input?: RuntimeThreadListInput): Promise<RuntimeThreadListResult>;
  readThread(input: RuntimeThreadReadInput): Promise<RuntimeThreadProjection>;
  resumeThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection>;
  forkThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection>;
  startTurn(input: RuntimeTurnStartInput): Promise<RuntimeTurnProjection>;
  interruptTurn(input: RuntimeTurnInterruptInput): Promise<void>;
  readStandaloneFile(path: string): Promise<RuntimeStandaloneFileReadResult>;
  writeStandaloneFile(path: string, dataBase64: string): Promise<void>;
  listStandaloneDirectory(path: string): Promise<RuntimeStandaloneDirectoryEntry[]>;
  executeStandaloneCommand(input: {
    command: string[];
    cwd: string;
    timeoutMs: number;
    outputBytesCap: number;
    readOnly: boolean;
  }): Promise<RuntimeStandaloneCommandResult>;
  respondToServerRequest(
    requestKey: string,
    result: Record<string, unknown>
  ): Promise<void>;
  rejectServerRequest(
    requestKey: string,
    code: number,
    message: string
  ): Promise<void>;
  setEventSink(sink: RuntimeEventSink | null): void;
  close(): Promise<void>;
}
