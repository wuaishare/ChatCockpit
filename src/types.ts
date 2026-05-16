export type JobType = "pack" | "taskpack";

export interface TokenPilotPaths {
  repoRoot: string;
  workspaceDir: string;
  bundlesDir: string;
  jobsDir: string;
  manifestsDir: string;
}

export interface RepoBundleManifest {
  createdAt: string;
  repoId: string;
  repoName: string;
  repomixXmlPath: string;
  promptPath: string;
  summaryPath: string;
  sourceFiles: string[];
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
