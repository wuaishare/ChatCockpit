import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/browser";

import type {
  ApiProblem,
  ContinuityDevelopmentDocumentDetailResponse,
  ContinuityDevelopmentDocumentKind,
  ContinuityDevelopmentDocumentMutationResponse,
  ContinuityDevelopmentDocumentsResponse,
  ContinuityDevelopmentDocumentStatus,
  ContinuityHandoffForkResponse,
  ContinuityHandoffMutationResponse,
  ContinuityProjectsResponse,
  ContinuitySessionMode,
  ContinuityTaskCompletionResponse,
  ContinuityTaskDocumentBindResponse,
  ContinuityTaskReviewResponse,
  ContinuityWorkspaceSnapshotResponse,
  GptConfigResponse,
  HealthResponse,
  IntegrationStatusResponse,
  JobControlResponse,
  JobArtifactReadResponse,
  JobArtifactsListResponse,
  JobDetailResponse,
  JobsListResponse,
  RuntimeRecoveryAction,
  RuntimeRecoveryAssessResponse,
  RuntimeRecoveryExecuteResponse,
  RuntimeResourceInspectResponse,
  RuntimeResourceInventoryResponse,
  RuntimeResourceMutationActivityResponse,
  RuntimeResourceMutationApprovalResponse,
  RuntimeResourceMutationExecuteResponse,
  RuntimeResourceMutationOperation,
  RuntimeResourceProfilesResponse,
  RuntimeResourceSnapshotResponse,
  SetupStatusResponse,
  TerminateAllJobsResponse
} from "./types";

let operatorCsrfToken: string | null = null;

export function setOperatorCsrfToken(value: string | null): void {
  operatorCsrfToken = value?.trim() || null;
}

function buildHeaders(
  _legacyToken?: string | null,
  options: { mutation?: boolean } = {}
): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (options.mutation && operatorCsrfToken) {
    headers["X-ChatCockpit-CSRF"] = operatorCsrfToken;
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
    credentials: "same-origin",
    headers: buildHeaders(token)
  });

  if (!response.ok) {
    throw await parseProblem(response);
  }

  return (await response.json()) as T;
}

export interface OperatorStatusResponse {
  configured: boolean;
  desktopSetupAvailable: boolean;
}

export interface OperatorPasskeySummary {
  id: string;
  label: string;
  rpId: string;
  origin: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OperatorSessionResponse {
  ok: true;
  sessionId: string;
  username: string;
  role: "owner";
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export async function fetchOperatorStatus(): Promise<OperatorStatusResponse> {
  return requestJson<OperatorStatusResponse>("/api/operator/status");
}

export async function fetchOperatorSession(): Promise<OperatorSessionResponse> {
  const result = await requestJson<OperatorSessionResponse>("/api/operator/session");
  setOperatorCsrfToken(result.csrfToken);
  return result;
}

export async function fetchPasskeyAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return postBodyJson<PublicKeyCredentialRequestOptionsJSON>(
    "/api/operator/passkeys/authentication/options",
    {}
  );
}

export async function verifyPasskeyAuthentication(input: {
  challenge: string;
  response: AuthenticationResponseJSON;
}): Promise<OperatorSessionResponse> {
  const response = await fetch("/api/operator/passkeys/authentication/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await parseProblem(response);
  const result = (await response.json()) as OperatorSessionResponse;
  setOperatorCsrfToken(result.csrfToken);
  return result;
}

export async function fetchOperatorPasskeys(): Promise<OperatorPasskeySummary[]> {
  const result = await requestJson<{ ok: true; passkeys: OperatorPasskeySummary[] }>(
    "/api/operator/passkeys"
  );
  return result.passkeys;
}

export async function fetchPasskeyRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return postBodyJson<PublicKeyCredentialCreationOptionsJSON>(
    "/api/operator/passkeys/registration/options",
    {}
  );
}

export async function verifyPasskeyRegistration(input: {
  challenge: string;
  response: RegistrationResponseJSON;
  label?: string;
}): Promise<OperatorPasskeySummary> {
  const result = await postBodyJson<{ ok: true; passkey: OperatorPasskeySummary }>(
    "/api/operator/passkeys/registration/verify",
    input
  );
  return result.passkey;
}

export async function deleteOperatorPasskey(id: string): Promise<void> {
  const response = await fetch(`/api/operator/passkeys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: buildHeaders(null, { mutation: true })
  });
  if (!response.ok) throw await parseProblem(response);
}

export async function redeemLocalLoginGrant(grant: string): Promise<OperatorSessionResponse> {
  const response = await fetch("/api/operator/local-login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ grant })
  });
  if (!response.ok) throw await parseProblem(response);
  const result = (await response.json()) as OperatorSessionResponse;
  setOperatorCsrfToken(result.csrfToken);
  return result;
}

export async function loginOperator(input: {
  username: string;
  password: string;
}): Promise<OperatorSessionResponse> {
  const response = await fetch("/api/operator/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await parseProblem(response);
  const result = (await response.json()) as OperatorSessionResponse;
  setOperatorCsrfToken(result.csrfToken);
  return result;
}

export async function logoutOperator(): Promise<void> {
  await postJson<{ ok: true }>("/api/operator/logout");
  setOperatorCsrfToken(null);
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

export async function fetchGptConfig(
  locale: "zh-CN" | "en-US",
  token?: string | null
): Promise<GptConfigResponse> {
  const query = new URLSearchParams({ locale });
  return requestJson<GptConfigResponse>(`/api/gpt/config?${query.toString()}`, token);
}

export async function fetchIntegrationStatus(
  token?: string | null
): Promise<IntegrationStatusResponse> {
  return requestJson<IntegrationStatusResponse>("/api/integrations/status", token);
}

export async function fetchContinuityProjects(
  token?: string | null
): Promise<ContinuityProjectsResponse> {
  return requestJson<ContinuityProjectsResponse>(
    "/api/continuity/projects?status=active",
    token
  );
}

export async function fetchDevelopmentDocuments(
  workspaceId: string,
  token?: string | null
): Promise<ContinuityDevelopmentDocumentsResponse> {
  const query = new URLSearchParams({ workspaceId });
  return requestJson<ContinuityDevelopmentDocumentsResponse>(
    `/api/continuity/documents?${query.toString()}`,
    token
  );
}

export async function fetchDevelopmentDocument(
  documentId: string,
  token?: string | null
): Promise<ContinuityDevelopmentDocumentDetailResponse> {
  return requestJson<ContinuityDevelopmentDocumentDetailResponse>(
    `/api/continuity/documents/${encodeURIComponent(documentId)}`,
    token
  );
}

export async function fetchWorkspaceContinuitySnapshot(
  workspaceId: string,
  token?: string | null
): Promise<ContinuityWorkspaceSnapshotResponse> {
  return requestJson<ContinuityWorkspaceSnapshotResponse>(
    `/api/continuity/workspaces/${encodeURIComponent(workspaceId)}/snapshot`,
    token
  );
}

export async function assessRuntimeRecovery(
  payload: {
    workspaceId: string;
    taskId: string;
    sessionId?: string;
    providerKind?: string;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<RuntimeRecoveryAssessResponse> {
  return postBodyJson("/api/recovery/assess", payload, token);
}

export async function executeRuntimeRecovery(
  payload: {
    recoveryId: string;
    assessmentHash: string;
    expectedRecoveryRevision: number;
    action: RuntimeRecoveryAction;
    targetThreadId?: string;
    targetMode?: ContinuitySessionMode;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<RuntimeRecoveryExecuteResponse> {
  return postBodyJson("/api/recovery/execute", payload, token);
}

export async function fetchRuntimeResourceProfiles(
  token?: string | null
): Promise<RuntimeResourceProfilesResponse> {
  return requestJson<RuntimeResourceProfilesResponse>(
    "/api/resources/runtime-profiles",
    token
  );
}

export async function inventoryRuntimeResources(
  payload: {
    runtimeProfileId: string;
    workspaceId?: string;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<RuntimeResourceInventoryResponse> {
  return postBodyJson<RuntimeResourceInventoryResponse>(
    "/api/resources/inventory",
    payload,
    token
  );
}

export async function fetchRuntimeResourceSnapshot(
  snapshotId: string,
  token?: string | null
): Promise<RuntimeResourceSnapshotResponse> {
  return requestJson<RuntimeResourceSnapshotResponse>(
    `/api/resources/snapshots/${encodeURIComponent(snapshotId)}`,
    token
  );
}

export async function fetchRuntimeResourceItem(
  resourceId: string,
  token?: string | null
): Promise<RuntimeResourceInspectResponse> {
  return requestJson<RuntimeResourceInspectResponse>(
    `/api/resources/items/${encodeURIComponent(resourceId)}`,
    token
  );
}

export async function prepareRuntimeResourceMutation(
  payload: {
    operation: RuntimeResourceMutationOperation;
    runtimeProfileId: string;
    workspaceId: string;
    resourceId: string;
    expectedSnapshotId: string;
    expectedFingerprint: string;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<RuntimeResourceMutationApprovalResponse> {
  return postBodyJson<RuntimeResourceMutationApprovalResponse>(
    "/api/resources/mutations/prepare",
    payload,
    token
  );
}

export async function decideRuntimeResourceMutation(
  payload: {
    approvalId: string;
    expectedRevision: number;
    decision: "approved" | "denied";
    idempotencyKey: string;
  },
  token?: string | null
): Promise<RuntimeResourceMutationApprovalResponse> {
  return postBodyJson<RuntimeResourceMutationApprovalResponse>(
    "/api/resources/mutations/decision",
    payload,
    token
  );
}

export async function executeRuntimeResourceMutation(
  payload: {
    approvalId: string;
    expectedApprovalRevision: number;
    runtimeProfileId: string;
    workspaceId: string;
    resourceId: string;
    expectedFingerprint: string;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<RuntimeResourceMutationExecuteResponse> {
  return postBodyJson<RuntimeResourceMutationExecuteResponse>(
    "/api/resources/mutations/execute",
    payload,
    token
  );
}

export async function fetchRuntimeResourceMutationActivity(
  input: {
    workspaceId: string;
    resourceId?: string;
    approvalStatus?: string;
    limit?: number;
  },
  token?: string | null
): Promise<RuntimeResourceMutationActivityResponse> {
  const query = new URLSearchParams({ workspaceId: input.workspaceId });
  if (input.resourceId) query.set("resourceId", input.resourceId);
  if (input.approvalStatus) query.set("approvalStatus", input.approvalStatus);
  if (typeof input.limit === "number") query.set("limit", String(input.limit));
  return requestJson<RuntimeResourceMutationActivityResponse>(
    `/api/resources/mutations/activity?${query.toString()}`,
    token
  );
}

async function postBodyJson<T>(
  path: string,
  body: unknown,
  token?: string | null
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...buildHeaders(token, { mutation: true }),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw await parseProblem(response);
  }

  return (await response.json()) as T;
}

export async function createDevelopmentDocument(
  payload: {
    projectId: string;
    workspaceId: string;
    kind: ContinuityDevelopmentDocumentKind;
    title: string;
    contentMarkdown: string;
    changeSummary?: string;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityDevelopmentDocumentMutationResponse> {
  return postBodyJson("/api/continuity/documents", payload, token);
}

export async function appendDevelopmentDocumentVersion(
  payload: {
    documentId: string;
    contentMarkdown: string;
    changeSummary?: string;
    expectedRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityDevelopmentDocumentMutationResponse> {
  return postBodyJson(
    "/api/continuity/documents/append-version",
    payload,
    token
  );
}

export async function updateDevelopmentDocumentStatus(
  payload: {
    documentId: string;
    status: ContinuityDevelopmentDocumentStatus;
    expectedRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityDevelopmentDocumentMutationResponse> {
  return postBodyJson(
    "/api/continuity/documents/update-status",
    payload,
    token
  );
}

export async function bindContinuityTaskDocuments(
  payload: {
    taskId: string;
    specId: string | null;
    planId: string | null;
    expectedTaskRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityTaskDocumentBindResponse> {
  return postBodyJson(
    "/api/continuity/tasks/bind-documents",
    payload,
    token
  );
}

export async function submitContinuityTaskReview(
  payload: {
    taskId: string;
    expectedRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityTaskReviewResponse> {
  return postBodyJson("/api/continuity/tasks/submit-review", payload, token);
}

export async function completeContinuityTask(
  payload: {
    taskId: string;
    expectedRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityTaskCompletionResponse> {
  return postBodyJson("/api/continuity/tasks/complete", payload, token);
}

export async function prepareContinuityHandoff(
  payload: {
    taskId: string;
    sessionId: string;
    toMode: ContinuitySessionMode | "unassigned";
    goal: string;
    completedItems: string[];
    pendingItems: string[];
    changedFiles: string[];
    risks: string[];
    nextAction: string;
    gitHead: string | null;
    gitBranch: string | null;
    gitDirty: boolean;
    evidenceBundleId?: string | null;
    expectedTaskRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<
  ContinuityHandoffMutationResponse & {
    task: { revision: number };
  }
> {
  return postBodyJson("/api/continuity/handoffs/prepare", payload, token);
}

export async function acceptContinuityHandoff(
  payload: {
    handoffId: string;
    expectedRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityHandoffMutationResponse> {
  return postBodyJson("/api/continuity/handoffs/accept", payload, token);
}

export async function cancelContinuityHandoff(
  payload: {
    handoffId: string;
    expectedRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityHandoffMutationResponse> {
  return postBodyJson("/api/continuity/handoffs/cancel", payload, token);
}

export async function forkContinuityHandoff(
  payload: {
    handoffId: string;
    expectedRevision: number;
    title: string;
    sessionTitle: string;
    mode?: ContinuitySessionMode;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<ContinuityHandoffForkResponse> {
  return postBodyJson("/api/continuity/handoffs/fork", payload, token);
}

async function postJson<T>(path: string, token?: string | null): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: buildHeaders(token, { mutation: true })
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
