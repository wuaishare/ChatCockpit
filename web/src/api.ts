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
  ContinuityProjectDetailResponse,
  ContinuityProjectsResponse,
  ProjectRootDiscoveryResponse,
  ProjectRegistryDetailResponse,
  ProjectRegistryMutationResponse,
  ProjectRegistryResponse,
  ProjectRootAccess,
  ProjectRootKind,
  ProjectRootRole,
  CodexNativeThreadMutationResponse,
  CodexRuntimeAccountStatusResponse,
  CodexRuntimeThreadReadResponse,
  CodexThreadImportAssessmentResponse,
  CodexThreadImportContextResponse,
  CodexThreadImportExecutionResponse,
  CodexThreadImportResponse,
  WorkspaceDiscoveryImportResponse,
  WorkspaceDiscoveryRootsResponse,
  WorkspaceDiscoveryScanResponse,
  ContinuitySessionMode,
  ContinuityTaskCompletionResponse,
  ContinuityTaskDocumentBindResponse,
  ContinuityTaskReviewResponse,
  ContinuityWorkspaceSnapshotResponse,
  ConnectivityProviderPublicSnapshot,
  PublicRouteBootstrapProofSnapshot,
  PublicRouteCandidateSnapshot,
  PublicRouteCandidateSource,
  PublicRouteCutoverIntentSnapshot,
  PublicRouteVerificationSnapshot,
  GptConfigResponse,
  HealthResponse,
  IntegrationStatusResponse,
  OAuthAuthorizationGrantsResponse,
  OAuthAuthorizationGrantSummary,
  OAuthGrantDeviceAccessMutationResponse,
  OAuthGrantDeviceAccessResponse,
  ManagedDevicesResponse,
  DeviceOnboardingResponse,
  DeviceEnrollmentRequestsResponse,
  DeviceEnrollmentDecisionResponse,
  DeviceExecutionPolicyMutationResponse,
  DeviceRevokeResponse,
  DeviceRuntimeLifecycleExecuteResponse,
  DeviceRuntimeStatusResponse,
  OperationalActivityListResponse,
  OperationalActivityTimelineResponse,
  ContinuityCapsuleResponse,
  TrajectoryResponse,
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
  options: {
    mutation?: boolean;
    loginGate?: string | null;
    oauthRequestId?: string | null;
  } = {}
): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (options.mutation && operatorCsrfToken) {
    headers["X-ChatCockpit-CSRF"] = operatorCsrfToken;
  }
  if (options.loginGate) {
    headers["X-ChatCockpit-Login-Gate"] = options.loginGate;
  }
  if (options.oauthRequestId) {
    headers["X-ChatCockpit-OAuth-Request-Id"] = options.oauthRequestId;
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

async function requestJson<T>(
  path: string,
  token?: string | null,
  options: { loginGate?: string | null; oauthRequestId?: string | null } = {}
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: buildHeaders(token, options)
  });

  if (!response.ok) {
    throw await parseProblem(response);
  }

  return (await response.json()) as T;
}

async function putBodyJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      ...buildHeaders(null, { mutation: true }),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
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

export interface OperatorSecondFactorChallengeResponse {
  ok: true;
  requiresSecondFactor: true;
  challenge: string;
  expiresAt: string;
  username: string;
  role: "owner";
}

export type OperatorPasswordLoginResponse =
  | OperatorSessionResponse
  | OperatorSecondFactorChallengeResponse;

export interface OperatorTotpStatusResponse {
  ok: true;
  enabled: boolean;
  recoveryCodesRemaining: number;
  pendingEnrollment: boolean;
}

export interface OperatorTotpEnrollmentResponse {
  ok: true;
  enrollmentId: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}

export interface OperatorTotpRecoveryCodesResponse {
  ok: true;
  recoveryCodes: string[];
  recoveryCodesRemaining: number;
  revokedSessionCount: number;
}

export type HostPermissionProfile =
  | "restricted"
  | "development"
  | "device-maintenance"
  | "full-host";

export interface HostExecutionPermissionsResponse {
  ok: true;
  hostPermissionProfile: HostPermissionProfile;
  approvalPolicy: "operator-required";
  capabilities: {
    hostManagedWorkspace: boolean;
    deviceDiagnostics: boolean;
    fullHostCommands: boolean;
  };
}

export interface HostCommandPendingApprovalSummary {
  id: string;
  revision: number;
  status: "pending";
  effect: "read" | "write";
  command: string;
  args: string[];
  workdir: string;
  executorId: string;
  timeoutMs: number;
  expiresAt: string;
  publicSummary: Record<string, unknown>;
}

export interface HostCommandPendingApprovalsResponse {
  ok: true;
  approvals: HostCommandPendingApprovalSummary[];
}

export interface HostCommandApprovalDecisionSummary {
  id: string;
  revision: number;
  status: "approved" | "denied";
  effect: "read" | "write";
  expiresAt: string;
  publicSummary: Record<string, unknown>;
}

export interface HostMutationPendingApprovalSummary {
  id: string;
  revision: number;
  status: "pending";
  operation: "files.write" | "files.edit";
  rootId: string;
  targetKind: "pure-host" | "workspace";
  executorId: string;
  expiresAt: string;
  publicSummary: Record<string, unknown>;
}

export interface HostMutationPendingApprovalsResponse {
  ok: true;
  approvals: HostMutationPendingApprovalSummary[];
}

export interface HostProcessPendingApprovalSummary {
  id: string;
  revision: number;
  status: "pending";
  operation: "start" | "input" | "stop";
  processId: string | null;
  executorId: string;
  expiresAt: string;
  publicSummary: Record<string, unknown>;
}

export interface HostProcessPendingApprovalsResponse {
  ok: true;
  approvals: HostProcessPendingApprovalSummary[];
}

export interface HostApprovalDecisionSummary {
  id: string;
  revision: number;
  status: "approved" | "denied";
  expiresAt: string;
  publicSummary: Record<string, unknown>;
}

export async function fetchOperatorStatus(
  loginGate?: string | null,
  oauthRequestId?: string | null
): Promise<OperatorStatusResponse> {
  return requestJson<OperatorStatusResponse>(
    "/api/operator/status",
    null,
    { loginGate, oauthRequestId }
  );
}

export async function fetchOperatorSession(): Promise<OperatorSessionResponse> {
  const result = await requestJson<OperatorSessionResponse>("/api/operator/session");
  setOperatorCsrfToken(result.csrfToken);
  return result;
}

export async function fetchHostExecutionPermissions(): Promise<HostExecutionPermissionsResponse> {
  return requestJson<HostExecutionPermissionsResponse>(
    "/api/operator/execution-permissions"
  );
}

export async function updateHostExecutionPermissions(
  hostPermissionProfile: HostPermissionProfile
): Promise<HostExecutionPermissionsResponse> {
  return putBodyJson<HostExecutionPermissionsResponse>(
    "/api/operator/execution-permissions",
    { hostPermissionProfile }
  );
}

export async function fetchPendingHostCommandApprovals(): Promise<HostCommandPendingApprovalsResponse> {
  return requestJson<HostCommandPendingApprovalsResponse>(
    "/api/host/commands/pending"
  );
}

export async function decideHostCommandApproval(input: {
  approvalId: string;
  expectedRevision: number;
  decision: "approved" | "denied";
}): Promise<{ ok: true; approval: HostCommandApprovalDecisionSummary; replayed: boolean }> {
  return postBodyJson(
    "/api/host/commands/decision",
    {
      ...input,
      idempotencyKey: `web-host-command-${input.approvalId}-${input.expectedRevision}-${input.decision}`
    }
  );
}

export async function fetchPendingHostMutationApprovals(): Promise<HostMutationPendingApprovalsResponse> {
  return requestJson<HostMutationPendingApprovalsResponse>(
    "/api/host/mutations/pending"
  );
}

export async function decideHostMutationApproval(input: {
  approvalId: string;
  expectedRevision: number;
  decision: "approved" | "denied";
}): Promise<{ ok: true; approval: HostApprovalDecisionSummary; replayed: boolean }> {
  return postBodyJson(
    "/api/host/mutations/decision",
    {
      ...input,
      idempotencyKey: `web-host-mutation-${input.approvalId}-${input.expectedRevision}-${input.decision}`
    }
  );
}

export async function fetchPendingHostProcessApprovals(): Promise<HostProcessPendingApprovalsResponse> {
  return requestJson<HostProcessPendingApprovalsResponse>(
    "/api/host/processes/pending"
  );
}

export async function decideHostProcessApproval(input: {
  approvalId: string;
  expectedRevision: number;
  decision: "approved" | "denied";
}): Promise<{ ok: true; approval: HostApprovalDecisionSummary; replayed: boolean }> {
  return postBodyJson(
    "/api/host/processes/decision",
    {
      ...input,
      idempotencyKey: `web-host-process-${input.approvalId}-${input.expectedRevision}-${input.decision}`
    }
  );
}

export async function fetchPasskeyAuthenticationOptions(
  loginGate?: string | null,
  oauthRequestId?: string | null
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return postBodyJson<PublicKeyCredentialRequestOptionsJSON>(
    "/api/operator/passkeys/authentication/options",
    {},
    null,
    { loginGate, oauthRequestId }
  );
}

export async function verifyPasskeyAuthentication(
  input: {
    challenge: string;
    response: AuthenticationResponseJSON;
  },
  loginGate?: string | null,
  oauthRequestId?: string | null
): Promise<OperatorSessionResponse> {
  const response = await fetch("/api/operator/passkeys/authentication/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...buildHeaders(null, { loginGate, oauthRequestId }),
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
      ...buildHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ grant })
  });
  if (!response.ok) throw await parseProblem(response);
  const result = (await response.json()) as OperatorSessionResponse;
  setOperatorCsrfToken(result.csrfToken);
  return result;
}

export async function loginOperator(
  input: {
    username: string;
    password: string;
  },
  loginGate?: string | null,
  oauthRequestId?: string | null
): Promise<OperatorPasswordLoginResponse> {
  const response = await fetch("/api/operator/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...buildHeaders(null, { loginGate, oauthRequestId }),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await parseProblem(response);
  const result = (await response.json()) as OperatorPasswordLoginResponse;
  if ("csrfToken" in result) {
    setOperatorCsrfToken(result.csrfToken);
  }
  return result;
}

export async function verifyOperatorTotpLogin(
  input: {
    challenge: string;
    verification: string;
  },
  loginGate?: string | null,
  oauthRequestId?: string | null
): Promise<OperatorSessionResponse> {
  const response = await fetch("/api/operator/totp/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...buildHeaders(null, { loginGate, oauthRequestId }),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await parseProblem(response);
  const result = (await response.json()) as OperatorSessionResponse;
  setOperatorCsrfToken(result.csrfToken);
  return result;
}

export async function fetchOperatorTotpStatus(): Promise<OperatorTotpStatusResponse> {
  return requestJson<OperatorTotpStatusResponse>("/api/operator/totp");
}

export async function startOperatorTotpEnrollment(): Promise<OperatorTotpEnrollmentResponse> {
  return postBodyJson<OperatorTotpEnrollmentResponse>("/api/operator/totp/enrollment", {});
}

export async function verifyOperatorTotpEnrollment(input: {
  enrollmentId: string;
  code: string;
}): Promise<OperatorTotpRecoveryCodesResponse> {
  return postBodyJson<OperatorTotpRecoveryCodesResponse>(
    "/api/operator/totp/enrollment/verify",
    input
  );
}

export async function regenerateOperatorTotpRecoveryCodes(
  verification: string
): Promise<OperatorTotpRecoveryCodesResponse> {
  return postBodyJson<OperatorTotpRecoveryCodesResponse>(
    "/api/operator/totp/recovery-codes/regenerate",
    { verification }
  );
}

export async function disableOperatorTotp(verification: string): Promise<void> {
  await postBodyJson<{ ok: true; revokedSessionCount: number }>(
    "/api/operator/totp/disable",
    { verification }
  );
}

export async function logoutOperator(): Promise<{ ok: true; loginPath: string }> {
  const result = await postJson<{ ok: true; loginPath: string }>("/api/operator/logout");
  setOperatorCsrfToken(null);
  return result;
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

export async function fetchOAuthAuthorizationGrants(): Promise<OAuthAuthorizationGrantsResponse> {
  return requestJson<OAuthAuthorizationGrantsResponse>("/api/integrations/oauth/grants");
}

export async function fetchOAuthGrantDeviceAccess(
  grantId: string
): Promise<OAuthGrantDeviceAccessResponse> {
  return requestJson<OAuthGrantDeviceAccessResponse>(
    `/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/devices`
  );
}

export async function fetchDevices(): Promise<ManagedDevicesResponse> {
  return requestJson<ManagedDevicesResponse>("/api/devices");
}

export async function fetchDeviceOnboarding(): Promise<DeviceOnboardingResponse> {
  return requestJson<DeviceOnboardingResponse>("/api/devices/onboarding");
}

export async function fetchDeviceEnrollmentRequests(): Promise<DeviceEnrollmentRequestsResponse> {
  return requestJson<DeviceEnrollmentRequestsResponse>("/api/devices/enrollment-requests");
}

export async function decideDeviceEnrollment(
  enrollmentId: string,
  decision: "approve" | "deny"
): Promise<DeviceEnrollmentDecisionResponse> {
  return postBodyJson<DeviceEnrollmentDecisionResponse>(
    `/api/devices/enrollment-requests/${encodeURIComponent(enrollmentId)}/decision`,
    { decision }
  );
}

export async function setDeviceExecutionPolicy(
  deviceId: string,
  action: "pause" | "resume",
  expectedExecutionPolicyRevision: number
): Promise<DeviceExecutionPolicyMutationResponse> {
  return postBodyJson<DeviceExecutionPolicyMutationResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/${action}`,
    { expectedExecutionPolicyRevision }
  );
}

export async function revokeDevice(deviceId: string): Promise<DeviceRevokeResponse> {
  const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: buildHeaders(null, { mutation: true })
  });
  if (!response.ok) throw await parseProblem(response);
  return (await response.json()) as DeviceRevokeResponse;
}

export async function fetchDeviceRuntimeStatus(
  deviceId: string
): Promise<DeviceRuntimeStatusResponse> {
  return requestJson<DeviceRuntimeStatusResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/runtime`
  );
}

export async function executeDeviceRuntimeLifecycle(
  deviceId: string,
  action: "start" | "stop" | "restart",
  idempotencyKey: string
): Promise<DeviceRuntimeLifecycleExecuteResponse> {
  return postBodyJson<DeviceRuntimeLifecycleExecuteResponse>(
    `/api/devices/${encodeURIComponent(deviceId)}/runtime/lifecycle`,
    { action, idempotencyKey }
  );
}

export async function grantOAuthDeviceAccess(
  grantId: string,
  deviceId: string
): Promise<OAuthGrantDeviceAccessMutationResponse> {
  return postBodyJson<OAuthGrantDeviceAccessMutationResponse>(
    `/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/devices/${encodeURIComponent(deviceId)}/grant`,
    {}
  );
}

export async function revokeOAuthAuthorizationGrant(
  grantId: string
): Promise<OAuthAuthorizationGrantSummary> {
  const result = await postBodyJson<{ ok: true; grant: OAuthAuthorizationGrantSummary }>(
    `/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/revoke`,
    {}
  );
  return result.grant;
}

export async function revokeOAuthDeviceAccess(
  grantId: string,
  deviceId: string
): Promise<OAuthGrantDeviceAccessMutationResponse> {
  return postBodyJson<OAuthGrantDeviceAccessMutationResponse>(
    `/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/devices/${encodeURIComponent(deviceId)}/revoke`,
    {}
  );
}

export async function fetchConnectivityProviders(
  token?: string | null
): Promise<ConnectivityProviderPublicSnapshot> {
  return requestJson<ConnectivityProviderPublicSnapshot>("/api/connectivity/providers", token);
}

export async function fetchPublicRouteCandidate(
  token?: string | null
): Promise<PublicRouteCandidateSnapshot> {
  return requestJson<PublicRouteCandidateSnapshot>("/api/connectivity/routes", token);
}

export async function stagePublicRouteCandidate(
  payload: { origin: string; source: PublicRouteCandidateSource },
  token?: string | null
): Promise<PublicRouteCandidateSnapshot> {
  return postBodyJson<PublicRouteCandidateSnapshot>(
    "/api/connectivity/routes/candidate",
    payload,
    token
  );
}

export async function discardPublicRouteCandidate(
  token?: string | null
): Promise<PublicRouteCandidateSnapshot> {
  const response = await fetch("/api/connectivity/routes/candidate", {
    method: "DELETE",
    credentials: "same-origin",
    headers: buildHeaders(token, { mutation: true })
  });
  if (!response.ok) {
    throw await parseProblem(response);
  }
  return (await response.json()) as PublicRouteCandidateSnapshot;
}

export async function fetchPublicRouteVerification(
  token?: string | null
): Promise<PublicRouteVerificationSnapshot> {
  return requestJson<PublicRouteVerificationSnapshot>(
    "/api/connectivity/routes/verification",
    token
  );
}

export async function verifyPublicRouteCandidate(
  candidateId: string,
  token?: string | null
): Promise<PublicRouteVerificationSnapshot> {
  return postBodyJson<PublicRouteVerificationSnapshot>(
    "/api/connectivity/routes/candidate/verify",
    { candidateId },
    token
  );
}

export async function fetchPublicRouteCutoverIntent(
  token?: string | null
): Promise<PublicRouteCutoverIntentSnapshot> {
  return requestJson<PublicRouteCutoverIntentSnapshot>(
    "/api/connectivity/routes/cutover-intent",
    token
  );
}

export async function preparePublicRouteCutoverIntent(
  payload: { candidateId: string; verificationId: string },
  token?: string | null
): Promise<PublicRouteCutoverIntentSnapshot> {
  return postBodyJson<PublicRouteCutoverIntentSnapshot>(
    "/api/connectivity/routes/cutover-intent",
    payload,
    token
  );
}

export async function cancelPublicRouteCutoverIntent(
  token?: string | null
): Promise<PublicRouteCutoverIntentSnapshot> {
  const response = await fetch("/api/connectivity/routes/cutover-intent", {
    method: "DELETE",
    credentials: "same-origin",
    headers: buildHeaders(token, { mutation: true })
  });
  if (!response.ok) {
    throw await parseProblem(response);
  }
  return (await response.json()) as PublicRouteCutoverIntentSnapshot;
}

export async function fetchPublicRouteBootstrapProof(
  token?: string | null
): Promise<PublicRouteBootstrapProofSnapshot> {
  return requestJson<PublicRouteBootstrapProofSnapshot>(
    "/api/connectivity/routes/bootstrap-proof",
    token
  );
}

export async function preparePublicRouteBootstrapProof(
  candidateId: string,
  token?: string | null
): Promise<PublicRouteBootstrapProofSnapshot> {
  return postBodyJson<PublicRouteBootstrapProofSnapshot>(
    "/api/connectivity/routes/bootstrap-proof",
    { candidateId },
    token
  );
}

export async function verifyPublicRouteBootstrapProof(
  payload: { candidateId: string; proofId: string },
  token?: string | null
): Promise<PublicRouteBootstrapProofSnapshot> {
  return postBodyJson<PublicRouteBootstrapProofSnapshot>(
    "/api/connectivity/routes/bootstrap-proof/verify",
    payload,
    token
  );
}

export async function cancelPublicRouteBootstrapProof(
  token?: string | null
): Promise<PublicRouteBootstrapProofSnapshot> {
  const response = await fetch("/api/connectivity/routes/bootstrap-proof", {
    method: "DELETE",
    credentials: "same-origin",
    headers: buildHeaders(token, { mutation: true })
  });
  if (!response.ok) {
    throw await parseProblem(response);
  }
  return (await response.json()) as PublicRouteBootstrapProofSnapshot;
}

export async function fetchProjects(): Promise<ProjectRegistryResponse> {
  return requestJson<ProjectRegistryResponse>("/api/projects?status=active");
}

export async function fetchProjectDiscovery(): Promise<ProjectRootDiscoveryResponse> {
  return requestJson<ProjectRootDiscoveryResponse>("/api/projects/discovery");
}

export async function fetchProject(
  projectId: string
): Promise<ProjectRegistryDetailResponse> {
  return requestJson<ProjectRegistryDetailResponse>(
    `/api/projects/${encodeURIComponent(projectId)}`
  );
}

export async function createProject(input: {
  slug?: string;
  displayName: string;
  root: {
    path: string;
    kind?: ProjectRootKind;
    role?: ProjectRootRole;
    access?: ProjectRootAccess;
    repoId?: string;
  };
  expectedConfigRevision: string;
}): Promise<ProjectRegistryMutationResponse> {
  return postBodyJson<ProjectRegistryMutationResponse>("/api/projects", input);
}

export async function renameProject(
  projectId: string,
  input: { displayName: string; expectedConfigRevision: string }
): Promise<ProjectRegistryMutationResponse> {
  return postBodyJson<ProjectRegistryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/rename`,
    input
  );
}

export async function attachProjectRoot(
  projectId: string,
  input: {
    path: string;
    kind: ProjectRootKind;
    role?: ProjectRootRole;
    access?: ProjectRootAccess;
    repoId?: string;
    expectedConfigRevision: string;
  }
): Promise<ProjectRegistryMutationResponse> {
  return postBodyJson<ProjectRegistryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/roots`,
    input
  );
}

export async function makeProjectRootPrimary(
  projectId: string,
  rootId: string,
  expectedConfigRevision: string
): Promise<ProjectRegistryMutationResponse> {
  return postBodyJson<ProjectRegistryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/roots/${encodeURIComponent(rootId)}/make-primary`,
    { expectedConfigRevision }
  );
}

export async function detachProjectRoot(
  projectId: string,
  rootId: string,
  expectedConfigRevision: string
): Promise<ProjectRegistryMutationResponse> {
  return postBodyJson<ProjectRegistryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/roots/${encodeURIComponent(rootId)}/detach`,
    { expectedConfigRevision }
  );
}

/** @deprecated Compatibility helper for legacy callers. New Project UI uses ProjectRoot APIs. */
export async function attachProjectWorkspace(
  projectId: string,
  input: { repoId: string; path: string; expectedConfigRevision: string }
): Promise<ProjectRegistryMutationResponse> {
  return postBodyJson<ProjectRegistryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/workspaces`,
    input
  );
}

/** @deprecated Compatibility helper for legacy callers. New Project UI uses ProjectRoot APIs. */
export async function makeProjectWorkspacePrimary(
  projectId: string,
  workspaceId: string,
  expectedConfigRevision: string
): Promise<ProjectRegistryMutationResponse> {
  return postBodyJson<ProjectRegistryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/make-primary`,
    { expectedConfigRevision }
  );
}

export async function fetchContinuityProjects(
  token?: string | null
): Promise<ContinuityProjectsResponse> {
  return requestJson<ContinuityProjectsResponse>(
    "/api/continuity/projects?status=active",
    token
  );
}

export async function fetchContinuityProject(
  projectId: string,
  token?: string | null
): Promise<ContinuityProjectDetailResponse> {
  return requestJson<ContinuityProjectDetailResponse>(
    `/api/continuity/projects/${encodeURIComponent(projectId)}`,
    token
  );
}

export async function fetchWorkspaceDiscoveryRoots(
  token?: string | null
): Promise<WorkspaceDiscoveryRootsResponse> {
  return requestJson<WorkspaceDiscoveryRootsResponse>(
    "/api/continuity/workspace-discovery/roots",
    token
  );
}

export async function addDiscoveryRoot(
  path: string,
  expectedConfigRevision: string,
  token?: string | null
): Promise<WorkspaceDiscoveryRootsResponse> {
  return postBodyJson<WorkspaceDiscoveryRootsResponse>(
    "/api/continuity/workspace-discovery/roots",
    { path, expectedConfigRevision },
    token
  );
}

export async function removeDiscoveryRoot(
  rootId: string,
  expectedConfigRevision: string,
  token?: string | null
): Promise<WorkspaceDiscoveryRootsResponse> {
  const response = await fetch(
    `/api/continuity/workspace-discovery/roots/${encodeURIComponent(rootId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        ...buildHeaders(token, { mutation: true }),
        "content-type": "application/json"
      },
      body: JSON.stringify({ expectedConfigRevision })
    }
  );
  if (!response.ok) throw await parseProblem(response);
  return (await response.json()) as WorkspaceDiscoveryRootsResponse;
}

export async function scanWorkspaceDiscoveryRoot(
  rootId: string,
  expectedConfigRevision: string,
  token?: string | null
): Promise<WorkspaceDiscoveryScanResponse> {
  return postBodyJson<WorkspaceDiscoveryScanResponse>(
    `/api/continuity/workspace-discovery/roots/${encodeURIComponent(rootId)}/scan`,
    { expectedConfigRevision },
    token
  );
}

export async function importWorkspaceCandidate(
  rootId: string,
  payload: {
    candidateId: string;
    repoId: string;
    expectedConfigRevision: string;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<WorkspaceDiscoveryImportResponse> {
  return postBodyJson<WorkspaceDiscoveryImportResponse>(
    `/api/continuity/workspace-discovery/roots/${encodeURIComponent(rootId)}/import`,
    payload,
    token
  );
}

export async function fetchCodexRuntimeThread(
  threadId: string,
  token?: string | null
): Promise<CodexRuntimeThreadReadResponse> {
  return requestJson<CodexRuntimeThreadReadResponse>(
    `/api/runtime/codex/threads/${encodeURIComponent(threadId)}`,
    token
  );
}

export async function fetchCodexRuntimeAccountStatus(
  token?: string | null
): Promise<CodexRuntimeAccountStatusResponse> {
  return requestJson<CodexRuntimeAccountStatusResponse>(
    "/api/runtime/codex/account/status",
    token
  );
}

export async function resumeNativeCodexThread(
  payload: { workspaceId: string; threadId: string; idempotencyKey: string },
  token?: string | null
): Promise<CodexNativeThreadMutationResponse> {
  return postBodyJson<CodexNativeThreadMutationResponse>(
    "/api/runtime/codex/native/threads/resume",
    payload,
    token
  );
}

export async function assessCodexThreadImport(
  workspaceId: string,
  payload: { threadRef: string; idempotencyKey: string },
  token?: string | null
): Promise<CodexThreadImportAssessmentResponse> {
  return postBodyJson(
    `/api/continuity/workspaces/${encodeURIComponent(workspaceId)}/codex-thread-imports/assess`,
    payload,
    token
  );
}

export async function executeCodexThreadImport(
  importId: string,
  payload: {
    assessmentHash: string;
    expectedRevision: number;
    action: "handoff-to-chat-direct";
    idempotencyKey: string;
  },
  token?: string | null
): Promise<CodexThreadImportExecutionResponse> {
  return postBodyJson(
    `/api/continuity/codex-thread-imports/${encodeURIComponent(importId)}/execute`,
    payload,
    token
  );
}

export async function fetchCodexThreadImport(
  importId: string,
  token?: string | null
): Promise<CodexThreadImportResponse> {
  return requestJson<CodexThreadImportResponse>(
    `/api/continuity/codex-thread-imports/${encodeURIComponent(importId)}`,
    token
  );
}

export async function fetchCodexThreadImportContext(
  importId: string,
  cursor?: string | null,
  token?: string | null
): Promise<CodexThreadImportContextResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return requestJson<CodexThreadImportContextResponse>(
    `/api/continuity/codex-thread-imports/${encodeURIComponent(importId)}/context${query}`,
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

export async function fetchOperationalActivities(
  token?: string | null
): Promise<OperationalActivityListResponse> {
  return requestJson<OperationalActivityListResponse>("/api/activities", token);
}

export async function fetchOperationalActivityTimeline(
  activityId: string,
  token?: string | null
): Promise<OperationalActivityTimelineResponse> {
  return requestJson<OperationalActivityTimelineResponse>(
    `/api/activities/${encodeURIComponent(activityId)}/events?limit=50`,
    token
  );
}

export async function fetchExecutionTrajectory(
  activityId: string,
  token?: string | null
): Promise<TrajectoryResponse> {
  return requestJson<TrajectoryResponse>(
    `/api/trajectories/${encodeURIComponent(activityId)}?limit=50`,
    token
  );
}

export async function fetchContinuityCapsule(
  workspaceId: string,
  options: { taskId?: string; activityId?: string; trajectoryLimit?: number } = {},
  token?: string | null
): Promise<ContinuityCapsuleResponse> {
  const query = new URLSearchParams();
  if (options.taskId) query.set("taskId", options.taskId);
  if (options.activityId) query.set("activityId", options.activityId);
  if (options.trajectoryLimit) query.set("trajectoryLimit", String(options.trajectoryLimit));
  const suffix = query.size ? `?${query.toString()}` : "";
  return requestJson<ContinuityCapsuleResponse>(
    `/api/continuity/workspaces/${encodeURIComponent(workspaceId)}/capsule${suffix}`,
    token
  );
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
  token?: string | null,
  options: { loginGate?: string | null; oauthRequestId?: string | null } = {}
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...buildHeaders(token, { mutation: true, ...options }),
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

export async function interruptCodexRuntimeTurn(
  payload: { runId: string; expectedRunRevision: number; idempotencyKey: string },
  token?: string | null
): Promise<{ ok: true; replayed: boolean }> {
  return postBodyJson<{ ok: true; replayed: boolean }>(
    "/api/runtime/codex/turns/interrupt",
    payload,
    token
  );
}

export async function controlJob(
  id: string,
  payload: {
    action: "pause" | "resume" | "terminate";
    expectedRevision: number;
    idempotencyKey: string;
  },
  token?: string | null
): Promise<JobControlResponse> {
  return postBodyJson<JobControlResponse>(
    `/api/jobs/${encodeURIComponent(id)}/control`,
    payload,
    token
  );
}

export async function terminateAllJobs(token?: string | null): Promise<TerminateAllJobsResponse> {
  return postJson<TerminateAllJobsResponse>("/api/jobs/control/terminate-all", token);
}
