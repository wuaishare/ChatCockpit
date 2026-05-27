export type JobType = "pack" | "taskpack" | "codex-run";
export type TokenPilotTrackedProcessState =
  | "running"
  | "paused"
  | "terminated"
  | "completed"
  | "failed";

export interface TokenPilotPaths {
  repoRoot: string;
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

export interface TokenPilotUserConfig {
  workspaceAllowlist: string[];
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
  status: "queued" | "running" | "completed" | "failed";
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

export interface FileReadPayload {
  repoId: string;
  path: string;
  offset?: number;
  limit?: number;
}

export interface FileReadBatchPayload {
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
}

export interface TokenPilotGptConfigRecord {
  version: string;
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
  };
  artifacts?: TokenPilotJobArtifactSummary[];
  result?: Record<string, unknown>;
  error?: string;
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
