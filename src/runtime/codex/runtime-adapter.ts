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

export interface RuntimeThreadContextInput {
  threadId: string;
  cursor?: string | null;
  limit?: number;
}

export interface RuntimeThreadContextMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant";
  text: string;
  truncated: boolean;
}

export interface RuntimeThreadContextPage {
  threadId: string;
  projectId: string | null;
  workspaceId: string | null;
  repoId: string | null;
  messages: RuntimeThreadContextMessage[];
  nextCursor: string | null;
  truncated: boolean;
  lastTurnId: string | null;
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

export interface RuntimeSkillListInput {
  workspaceId: string;
  forceReload?: boolean;
}

export interface RuntimeSkillProjection {
  name: string;
  description: string | null;
  scope: string | null;
  sourceIdentityHash?: string | null;
  enabled: boolean;
  displayName: string | null;
  shortDescription: string | null;
  brandColor: string | null;
}

export interface RuntimeMcpServerProjection {
  name: string;
  title: string | null;
  version: string | null;
  authStatus: string | null;
  toolCount: number;
  readOnlyToolCount: number;
  mutatingToolCount: number;
}

export interface RuntimePluginListInput {
  workspaceId?: string;
  forceRefetch?: boolean;
}

export type RuntimePluginSourceType =
  | "local"
  | "git"
  | "npm"
  | "remote"
  | "unknown";

export type RuntimePluginObservationSource = "installed" | "catalog";

export interface RuntimePluginProjection {
  id: string;
  marketplaceName: string;
  sourceIdentityHash: string | null;
  sourceType: RuntimePluginSourceType;
  name: string;
  displayName: string;
  description: string | null;
  version: string | null;
  availableVersion: string | null;
  installed: boolean;
  enabled: boolean;
  availability: string | null;
  installPolicy: string | null;
  installPolicySource: string | null;
  mustShowInstallationInterstitial: boolean | null;
  authPolicy: string | null;
  category: string | null;
  capabilities: string[];
  observedBy: RuntimePluginObservationSource[];
}

export interface RuntimeResourceConfigSummary {
  loaded: true;
  modelProviderConfigured: boolean;
  sandboxModeConfigured: boolean;
  desktopConfigPresent: boolean;
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
  readThreadContext(input: RuntimeThreadContextInput): Promise<RuntimeThreadContextPage>;
  resumeThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection>;
  forkThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection>;
  startTurn(input: RuntimeTurnStartInput): Promise<RuntimeTurnProjection>;
  interruptTurn(input: RuntimeTurnInterruptInput): Promise<void>;
  listSkills?(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]>;
  listMcpServers?(): Promise<RuntimeMcpServerProjection[]>;
  listPlugins?(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]>;
  readResourceConfigSummary?(): Promise<RuntimeResourceConfigSummary>;
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
