import type {
  CodexStandaloneCapabilitySnapshot,
  CodexStandaloneSnapshotStatus
} from "./standalone-capabilities.js";

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
  standaloneExecutionStatus?: CodexStandaloneSnapshotStatus;
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
  threadSource: string | null;
  name?: string | null;
  status: RuntimeThreadStatus;
  projectId: string | null;
  workspaceId: string | null;
  repoId: string | null;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
}

export type RuntimeThreadSourceKind =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | "unknown";

export interface RuntimeThreadListInput {
  cursor?: string | null;
  limit?: number;
  workspaceId?: string;
  searchTerm?: string;
  archived?: boolean;
  sourceKinds?: RuntimeThreadSourceKind[];
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

export interface RuntimeThreadStartInput {
  workspaceId: string;
  name?: string;
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

export interface RuntimeRateLimitWindowProjection {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RuntimeRateLimitProjection {
  limitId: string | null;
  limitName: string | null;
  primary: RuntimeRateLimitWindowProjection | null;
  secondary: RuntimeRateLimitWindowProjection | null;
  spendControlReached: boolean | null;
  planType: string | null;
  rateLimitReachedType: string | null;
  limited: boolean;
}

export interface RuntimeCodexAccountStatus {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
  accountType: string | null;
  planType: string | null;
  limited: boolean;
  rateLimits: RuntimeRateLimitProjection[];
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
  compatibilityMode?: string;
}

export type RuntimeStandaloneProcessState =
  | "running"
  | "completed"
  | "failed"
  | "terminated";

export interface RuntimeStandaloneProcessChunk {
  sequence: number;
  stream: "stdout" | "stderr";
  content: string;
  capReached: boolean;
}

export interface RuntimeStandaloneProcessStartResult {
  processId: string;
  state: "running";
  compatibilityMode?: string;
}

export interface RuntimeStandaloneProcessSnapshot {
  processId: string;
  state: RuntimeStandaloneProcessState;
  exitCode: number | null;
  errorCode: string | null;
  chunks: RuntimeStandaloneProcessChunk[];
  nextCursor: number;
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
  startThread(input: RuntimeThreadStartInput): Promise<RuntimeThreadProjection>;
  resumeThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection>;
  forkThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection>;
  startTurn(input: RuntimeTurnStartInput): Promise<RuntimeTurnProjection>;
  interruptTurn(input: RuntimeTurnInterruptInput): Promise<void>;
  readAccountStatus(): Promise<RuntimeCodexAccountStatus>;
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
  startStandaloneProcess?(input: {
    command: string[];
    cwd: string;
    readOnly: boolean;
    allowStdin: boolean;
    networkAccess: boolean;
  }): Promise<RuntimeStandaloneProcessStartResult>;
  readStandaloneProcess?(
    processId: string,
    cursor?: number,
    limit?: number
  ): Promise<RuntimeStandaloneProcessSnapshot>;
  waitStandaloneProcess?(processId: string): Promise<RuntimeStandaloneProcessSnapshot>;
  writeStandaloneProcess?(
    processId: string,
    input: string,
    closeStdin?: boolean
  ): Promise<void>;
  terminateStandaloneProcess?(processId: string): Promise<void>;
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
