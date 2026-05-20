import type {
  ApiProblem,
  GptConfigResponse,
  HealthResponse,
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
  token?: string | null
): Promise<JobArtifactReadResponse> {
  return requestJson<JobArtifactReadResponse>(
    `/api/jobs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactKey)}`,
    token
  );
}

export async function fetchGptConfig(token?: string | null): Promise<GptConfigResponse> {
  return requestJson<GptConfigResponse>("/api/gpt/config", token);
}
