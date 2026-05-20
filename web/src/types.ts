export type JobType = "pack" | "taskpack" | "codex-run";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface HealthResponse {
  ok: boolean;
  mode: string;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrl: string | null;
  openapiUrl: string;
}

export interface JobBase {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  headline: string;
  hasResult: boolean;
  hasError: boolean;
  payload: Record<string, unknown>;
  artifacts?: JobArtifactSummary[];
  result?: Record<string, unknown> | null;
  error?: string;
}

export interface JobArtifactSummary {
  key:
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
  label: string;
  path: string;
  contentType: string;
}

export interface JobsListResponse {
  ok: boolean;
  jobs: JobBase[];
}

export interface JobDetailResponse {
  ok: boolean;
  job: JobBase;
}

export interface JobArtifactsListResponse {
  ok: boolean;
  artifacts: JobArtifactSummary[];
}

export interface JobArtifactReadResponse {
  ok: boolean;
  artifact: JobArtifactSummary;
  file: {
    path: string;
    content: string;
    truncated: boolean;
    size: number;
    encoding: string;
    returnedBytes: number;
    maxBytes: number;
    previewMode: "head";
    offset: number;
    nextOffset: number | null;
    eof: boolean;
  };
}

export interface JobControlResponse {
  ok: boolean;
  jobId: string;
  action: "pause" | "resume" | "terminate";
  state: string;
  message: string;
}

export interface ApiProblem {
  status: number;
  message: string;
}

export interface HealthModel {
  ok: boolean;
  mode: string;
  authRequired: boolean;
  exposed: boolean;
  openapiUrl: string;
  publicBaseUrl: string | null;
}

export interface GptConfigModel {
  version: string;
  updatedAt: string;
  actionHost: string;
  openapiUrl: string;
  publicBaseUrl: string | null;
  schemaImportUrl: string;
  instructions: string;
  notes: string[];
}

export interface GptConfigResponse {
  ok: boolean;
  config: GptConfigModel;
}

export interface JobCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export interface JobSummary extends JobBase {}
