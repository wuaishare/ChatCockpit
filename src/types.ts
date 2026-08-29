export type JobType = "pack" | "taskpack" | "codex-run";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type TokenPilotDistributionMode = "source" | "packaged";
export type ProductIdentityKey = "tokenpilot" | "chatcockpit";

export interface TokenPilotDistributionContext {
  productIdentity: ProductIdentityKey;
  mode: TokenPilotDistributionMode;
  installRoot: string;
  stateRoot: string;
  primaryWorkspaceRoot: string;
  nodeExecutable: string;
  configPath: string;
}
export type TokenPilotTrackedProcessState =
  | "running"
  | "paused"
  | "terminated"
  | "completed"
  | "failed";

export interface TokenPilotPaths {
  productIdentity: ProductIdentityKey;
  repoRoot: string;
  installRoot: string;
  stateRoot: string;
  distributionMode: TokenPilotDistributionMode;
  nodeExecutable: string;
  configPath: string;
  workspaceDir: string;
  bundlesDir: string;
  jobsDir: string;
  queuedJobsDir: string;
  runningJobsDir: string;
  completedJobsDir: string;
  failedJobsDir: string;
  manifestsDir: string;
  runtimeDir: string;
  runnerStatusPath: string;
  runnerLogPath: string;
  runnerPidPath: string;
  runnerPlistPath: string;
  deviceAgentLogPath: string;
  deviceAgentPidPath: string;
  deviceAgentPlistPath: string;
  processSupervisorSocketPath: string;
  processSupervisorTokenPath: string;
  processSupervisorStatusPath: string;
  processSupervisorPidPath: string;
  processSupervisorLogPath: string;
  processSupervisorEventsPath: string;
  processSupervisorPlistPath: string;
}

export interface TokenPilotRepoTargetPaths {
  repoRoot: string;
  workspaceDir: string;
  bundlesDir: string;
  manifestsDir: string;
}

export interface TokenPilotRepoMapping {
  path: string;
}

export type TokenPilotProjectRootKind = "git-repository" | "directory";
export type TokenPilotProjectRootRole =
  | "primary-source"
  | "supporting-source"
  | "documentation"
  | "knowledge"
  | "assets";
export type TokenPilotProjectRootAccess = "read-write" | "read-only";

export interface TokenPilotProjectRootMapping {
  path: string;
  kind: TokenPilotProjectRootKind;
  role: TokenPilotProjectRootRole;
  access: TokenPilotProjectRootAccess;
}

export interface TokenPilotExecutionWorkspaceMapping {
  projectRootId: string;
  path: string;
  kind: "checkout" | "worktree";
  provenance: "registered" | "chatcockpit-created";
}

export interface TokenPilotProjectMapping {
  displayName: string;
  primaryRootId: string;
  rootIds: string[];
}

export interface TokenPilotUserConfig {
  schemaVersion: 3;
  workspaceDiscoveryRoots: string[];
  workspaceAllowlist: string[];
  projects: Record<string, TokenPilotProjectMapping>;
  projectRoots: Record<string, TokenPilotProjectRootMapping>;
  executionWorkspaces: Record<string, TokenPilotExecutionWorkspaceMapping>;
  /** @deprecated In-memory compatibility projection for existing execution/Git consumers. */
  defaultRepoId: string;
  /** @deprecated In-memory compatibility projection for existing execution/Git consumers. */
  repoMappings: Record<string, TokenPilotRepoMapping>;
}

export type TokenPilotRepoGovernanceStatus = "enabled" | "missing" | "blocked";
export type TokenPilotRepoGovernanceSource = "default" | "default-sibling" | "local-config";
export type TokenPilotRepoGovernanceCapability = "pack" | "files-read" | "codex-run";

export interface TokenPilotRepoGovernanceEntry {
  repoId: string;
  status: TokenPilotRepoGovernanceStatus;
  defaultRepo: boolean;
  source: TokenPilotRepoGovernanceSource;
  pathConfigured: boolean;
  allowlisted: boolean;
  pathVisibility: "hidden";
  capabilities: TokenPilotRepoGovernanceCapability[];
}

export interface TokenPilotRepoGovernanceRecord {
  defaultRepoId: string;
  configScope: "local-private";
  pathVisibility: "hidden";
  repos: TokenPilotRepoGovernanceEntry[];
}

export interface RepoBundleManifest {
  createdAt: string;
  repoId: string;
  repoName: string;
  repomixXmlPath: string;
  promptPath: string;
  summaryPath: string;
  manifestPath: string;
  publicIncludeEntries: string[];
  /**
   * Deprecated compatibility field. Use publicIncludeEntries instead.
   */
  sourceFiles?: string[];
}

export interface TaskPackInput {
  title: string;
  problem: string;
  contextSummary?: string;
  mustInspect?: string[];
  mayInspect?: string[];
  mustNotModify?: string[];
  verificationCommands?: string[];
  acceptanceCriteria?: string[];
}

export interface TaskPackArtifact {
  createdAt: string;
  title: string;
  markdownPath: string;
  jsonPath: string;
  input: TaskPackInput;
}

export type CodexRunExecutionMode = "plan" | "review" | "develop";
export type CodexRunWorktreePolicy = "auto" | "always" | "never";
export type CodexRunCommitPolicy = "none" | "propose" | "commit";
export type CodexRunSandbox = "read-only" | "workspace-write" | "danger-full-access";
export type CodexRunApprovalPolicy = "untrusted" | "on-request" | "never";

export interface CodexRunJobPayload {
  repoId: string;
  title: string;
  instructions: string;
  executionMode?: CodexRunExecutionMode;
  worktreePolicy?: CodexRunWorktreePolicy;
  branchName?: string;
  approvalPolicy?: CodexRunApprovalPolicy;
  sandbox?: CodexRunSandbox;
  verificationCommands?: string[];
  acceptanceCriteria?: string[];
  commitPolicy?: CodexRunCommitPolicy;
  commitTitle?: string;
  commitBody?: string;
  continuityTaskId?: string;
  continuitySessionId?: string;
  continuityRuntimeBindingId?: string;
}

export interface CodexRunArtifact {
  key: Extract<
    JobArtifactKey,
    "codexPrompt" | "codexStdout" | "codexStderr" | "codexDiff" | "codexReview" | "codexSummary"
  >;
  label: string;
  path: string;
  contentType: string;
}

export interface CodexRunJobResult {
  createdAt: string;
  repoId: string;
  title: string;
  executionMode: CodexRunExecutionMode;
  worktreePolicy: CodexRunWorktreePolicy;
  worktreeCreated: boolean;
  branchName?: string;
  statusSummary: string;
  codexExitCode: number;
  reviewExitCode: number;
  gitStatus: string;
  hasDiff: boolean;
  commit: {
    committed: boolean;
    commitHash?: string;
    commitMessage?: string;
    error?: string;
  };
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  diffPath: string;
  reviewPath: string;
  summaryPath: string;
  artifacts: CodexRunArtifact[];
}

export interface JobRecord<TPayload = unknown> {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  payload: TPayload;
  result?: unknown;
  error?: string;
}

export interface PackJobPayload {
  repoId: string;
}

export interface TaskPackJobPayload extends TaskPackInput {}

export type TokenPilotJobPayload = PackJobPayload | TaskPackJobPayload | CodexRunJobPayload;

export interface DirectExecutorPreference {
  executorId?: string;
}

export interface HostFileReadPayload extends DirectExecutorPreference {
  rootId: string;
  path: string;
}

export interface FileReadPayload extends DirectExecutorPreference {
  repoId: string;
  path: string;
  offset?: number;
  limit?: number;
}

export interface FileReadBatchPayload extends DirectExecutorPreference {
  repoId: string;
  paths: string[];
  offset?: number;
  limit?: number;
}

export interface TokenPilotHealthStatus {
  ok: true;
  mode: string;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrl: string | null;
  openapiUrl: string;
  build: {
    version: string;
    buildId: string | null;
    revision: string | null;
    builtAt: string | null;
  };
}

export interface TokenPilotSetupStatusStep {
  key: "runtime" | "auth" | "oauth" | "repo" | "runner" | "gpt" | "firstTask";
  ok: boolean;
  label: string;
  detail: string;
  nextAction: string;
}

export interface TokenPilotSetupStatus {
  ok: true;
  ready: boolean;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrlConfigured: boolean;
  oauthStatus: "disabled" | "ready" | "needs-attention";
  oauthProtectedResourceMetadataUrl: string | null;
  openapiUrl: string;
  runnerStatus: "missing" | "ready";
  firstTaskSeen: boolean;
  steps: TokenPilotSetupStatusStep[];
}

export interface TokenPilotGptConfigRecord {
  version: string;
  productVersion: string;
  schemaVersion: string;
  buildVersion: string;
  updatedAt: string;
  actionHost: string;
  openapiUrl: string;
  publicBaseUrl: string | null;
  schemaImportUrl: string;
  repoGovernance: TokenPilotRepoGovernanceRecord;
  instructions: string;
  notes: string[];
}

export interface TokenPilotCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  committedAt: string;
}

export interface TokenPilotPublicJobRecord {
  id: string;
  type: JobType;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  headline: string;
  hasResult: boolean;
  hasError: boolean;
  payload: Record<string, unknown>;
  process?: {
    state: TokenPilotTrackedProcessState;
    updatedAt: string;
    label: string;
    revision: number;
  };
  artifacts?: TokenPilotJobArtifactSummary[];
  result?: Record<string, unknown>;
  error?: string;
}

export interface TokenPilotJobsListResponse {
  ok: true;
  jobs: TokenPilotPublicJobRecord[];
  nextCursor: string | null;
  totalVisible: number;
  includeResult: boolean;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: unknown;
  };
}

export type JobArtifactKey =
  | "repomixXml"
  | "prompt"
  | "summary"
  | "manifest"
  | "markdown"
  | "json"
  | "codexPrompt"
  | "codexStdout"
  | "codexStderr"
  | "codexDiff"
  | "codexReview"
  | "codexSummary";

export interface TokenPilotJobArtifactSummary {
  key: JobArtifactKey;
  label: string;
  path: string;
  contentType: string;
}

export interface TokenPilotTextPreview {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
  encoding: string;
  returnedBytes: number;
  maxBytes: number;
  previewMode: "head";
  offset?: number;
  nextOffset?: number | null;
  eof?: boolean;
}

// ── ChatGPT 直驱开发 API 类型 ──

export interface FileWritePayload extends DirectExecutorPreference {
  repoId: string;
  sessionId?: string;
  path: string;
  content: string;
}

export interface FileWriteResponse {
  ok: boolean;
  repoId: string;
  path: string;
  written: boolean;
  size: number;
  error?: string;
}

export interface FileEditPayload extends DirectExecutorPreference {
  repoId: string;
  sessionId?: string;
  path: string;
  search: string;
  replace: string;
}

export interface FileEditResponse {
  ok: boolean;
  repoId: string;
  path: string;
  applied: boolean;
  error?: string;
}

export interface FileListPayload extends DirectExecutorPreference {
  repoId: string;
  path: string;
}

export interface FileListEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
}

export interface FileListResponse {
  ok: boolean;
  repoId: string;
  path: string;
  entries: FileListEntry[];
  error?: string;
}

export interface SearchPayload extends DirectExecutorPreference {
  repoId: string;
  pattern: string;
  path?: string;
  maxResults?: number;
  contextLines?: number;
  caseSensitive?: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  content: string;
}

export interface SearchResponse {
  ok: boolean;
  repoId: string;
  pattern: string;
  matches: SearchMatch[];
  truncated: boolean;
  totalMatches: number;
  error?: string;
}

export interface ShellRunPayload extends DirectExecutorPreference {
  repoId: string;
  sessionId?: string;
  command: string;
  args: string[];
  workdir?: string;
  timeoutMs?: number;
}

export interface ShellRunResponse {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  executedCommand: string;
  error?: string;
}

export type WorkspaceExecExecutionMode = "native-sandbox" | "host-managed";

export interface WorkspaceExecPayload extends DirectExecutorPreference {
  repoId: string;
  sessionId?: string;
  command: string;
  args: string[];
  workdir?: string;
  allowStdin?: boolean;
  networkAccess?: boolean;
  executionMode?: WorkspaceExecExecutionMode;
  allowBuiltinFallback?: boolean;
}

export interface WorkspaceProcessReadPayload {
  repoId: string;
  sessionId?: string;
  processId: string;
  cursor?: number;
  limit?: number;
}

export interface WorkspaceProcessInputPayload {
  repoId: string;
  sessionId?: string;
  processId: string;
  input: string;
  closeStdin?: boolean;
}

export interface WorkspaceProcessTerminatePayload {
  repoId: string;
  sessionId?: string;
  processId: string;
}

export interface GitDiffPayload extends DirectExecutorPreference {
  repoId: string;
  staged?: boolean;
}

export interface GitDiffResponse {
  ok: boolean;
  repoId: string;
  diff: string;
  truncated: boolean;
  error?: string;
}

export interface GitStatusEntry {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatusResponse {
  ok: boolean;
  repoId: string;
  branch: string;
  entries: GitStatusEntry[];
  error?: string;
}

export interface GitCommitPayload extends DirectExecutorPreference {
  repoId: string;
  sessionId?: string;
  message: string;
  body?: string;
}

export interface GitCommitResponse {
  ok: boolean;
  repoId: string;
  committed: boolean;
  commitHash?: string;
  commitMessage?: string;
  error?: string;
}
