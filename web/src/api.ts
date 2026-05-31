import type {
  ApiProblem,
  GptConfigResponse,
  HealthResponse,
  JobControlResponse,
  JobArtifactReadResponse,
  JobArtifactsListResponse,
  JobDetailResponse,
  JobsListResponse,
  SetupStatusResponse,
  TerminateAllJobsResponse
} from "./types";

function buildHeaders(token?: string | null): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/json"
  };

  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return headers;
}

async function parseProblem(response: Response): Promise<ApiProblem> {
  let message = `${response.status} ${response.statusText}`;
  let code: string | undefined;
  let details: unknown;

  try {
    const data = (await response.json()) as {
      error?: string | { code?: string; message?: string; details?: unknown };
      message?: string;
    };
    if (typeof data.error === "object" && data.error) {
      code = data.error.code;
      details = data.error.details;
      message = data.error.message || message;
    } else {
      message = data.error || data.message || message;
    }
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) message = text.trim();
    } catch {
      // ignore
    }
  }

  return { status: response.status, code, message, details };
}

async function requestJson<T>(path: string, token?: string | null): Promise<T> {
  const response = await fetch(path, {
    headers: buildHeaders(token)
  });

  if (!response.ok) {
    throw await parseProblem(response);
  }

  return (await response.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/api/health");
}

export async function fetchSetupStatus(token?: string | null): Promise<SetupStatusResponse> {
  return requestJson<SetupStatusResponse>("/api/setup/status", token);
}

export async function fetchJobs(
  token?: string | null,
  options?: {
    limit?: number;
    cursor?: string | null;
    status?: string;
    type?: string;
    includeResult?: boolean;
  }
): Promise<JobsListResponse> {
  const query = new URLSearchParams();
  if (typeof options?.limit === "number") query.set("limit", String(options.limit));
  if (options?.cursor) query.set("cursor", options.cursor);
  if (options?.status) query.set("status", options.status);
  if (options?.type) query.set("type", options.type);
  if (options?.includeResult) query.set("includeResult", "true");
  const suffix = query.size ? `?${query.toString()}` : "";
  return requestJson<JobsListResponse>(`/api/jobs${suffix}`, token);
}

export async function fetchJob(id: string, token?: string | null): Promise<JobDetailResponse> {
  return requestJson<JobDetailResponse>(`/api/jobs/${encodeURIComponent(id)}`, token);
}

export async function fetchJobArtifacts(
  id: string,
  token?: string | null
): Promise<JobArtifactsListResponse> {
  return requestJson<JobArtifactsListResponse>(
    `/api/jobs/${encodeURIComponent(id)}/artifacts`,
    token
  );
}

export async function fetchJobArtifactContent(
  id: string,
  artifactKey: string,
  options?: { offset?: number; limit?: number },
  token?: string | null
): Promise<JobArtifactReadResponse> {
  const query = new URLSearchParams();
  if (typeof options?.offset === "number") query.set("offset", String(options.offset));
  if (typeof options?.limit === "number") query.set("limit", String(options.limit));
  const suffix = query.size ? `?${query.toString()}` : "";
  return requestJson<JobArtifactReadResponse>(
    `/api/jobs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactKey)}${suffix}`,
    token
  );
}

export async function fetchGptConfig(token?: string | null): Promise<GptConfigResponse> {
  return requestJson<GptConfigResponse>("/api/gpt/config", token);
}

async function postJson<T>(path: string, token?: string | null): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: buildHeaders(token)
  });

  if (!response.ok) {
    throw await parseProblem(response);
  }

  return (await response.json()) as T;
}

export async function controlJob(
  id: string,
  action: "pause" | "resume" | "terminate",
  token?: string | null
): Promise<JobControlResponse> {
  return postJson<JobControlResponse>(
    `/api/jobs/${encodeURIComponent(id)}/control/${encodeURIComponent(action)}`,
    token
  );
}

export async function terminateAllJobs(token?: string | null): Promise<TerminateAllJobsResponse> {
  return postJson<TerminateAllJobsResponse>("/api/jobs/control/terminate-all", token);
}
