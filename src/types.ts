export type JobType = "pack" | "taskpack";

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

export interface TokenPilotRepoMapping {
  path: string;
}

export interface TokenPilotUserConfig {
  workspaceAllowlist: string[];
  repoMappings: Record<string, TokenPilotRepoMapping>;
}

export interface RepoBundleManifest {
  createdAt: string;
  repoId: string;
  repoName: string;
  repomixXmlPath: string;
  promptPath: string;
  summaryPath: string;
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

export type TokenPilotJobPayload = PackJobPayload | TaskPackJobPayload;

export interface FileReadPayload {
  repoId: string;
  path: string;
}

export interface FileReadBatchPayload {
  repoId: string;
  paths: string[];
}

export interface TokenPilotHealthStatus {
  ok: true;
  mode: string;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrl: string | null;
  openapiUrl: string;
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
  result?: Record<string, unknown>;
  error?: string;
}
