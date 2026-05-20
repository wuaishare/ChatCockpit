import type {
  ApiProblem,
  GptConfigResponse,
  HealthResponse,
  JobControlResponse,
  JobArtifactReadResponse,
  JobArtifactsListResponse,
  JobDetailResponse,
  JobsListResponse
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

  try {
    const data = (await response.json()) as { error?: string; message?: string };
    message = data.error || data.message || message;
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) message = text.trim();
    } catch {
      // ignore
    }
  }

  return { status: response.status, message };
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

export async function fetchJobs(token?: string | null): Promise<JobsListResponse> {
  return requestJson<JobsListResponse>("/api/jobs", token);
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

export async function terminateAllJobs(token?: string | null): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>("/api/jobs/control/terminate-all", token);
}
