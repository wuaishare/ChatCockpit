export type JobType = "pack" | "taskpack";
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
  result?: Record<string, unknown> | null;
  error?: string;
}

export interface JobsListResponse {
  ok: boolean;
  jobs: JobBase[];
}

export interface JobDetailResponse {
  ok: boolean;
  job: JobBase;
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

export interface JobCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export interface JobSummary extends JobBase {}
