export type JobType = "pack" | "taskpack" | "codex-run";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobProcessState = "running" | "paused" | "terminated" | "completed" | "failed";

export interface JobProcessInfo {
  state: JobProcessState;
  updatedAt: string;
  label: string;
  revision: number;
}

export interface HealthResponse {
  ok: boolean;
  mode: string;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrl: string | null;
  openapiUrl: string;
  build?: RuntimeBuildProvenance;
}

export interface RuntimeBuildProvenance {
  version: string;
  buildId: string | null;
  revision: string | null;
  builtAt: string | null;
}

export interface SetupStatusStep {
  key: "runtime" | "auth" | "oauth" | "repo" | "runner" | "gpt" | "firstTask";
  ok: boolean;
  label: string;
  detail: string;
  nextAction: string;
}

export interface SetupStatusResponse {
  ok: true;
  ready: boolean;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrlConfigured: boolean;
  oauthStatus: "disabled" | "ready" | "needs-attention";
  oauthProtectedResourceMetadataUrl: string | null;
  openapiUrl: string;
  runnerStatus: "missing" | "ready";
  firstTaskSeen: boolean;
  steps: SetupStatusStep[];
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
  process?: JobProcessInfo | null;
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
  nextCursor: string | null;
  totalVisible: number;
  includeResult: boolean;
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
  ok: true;
  jobId: string;
  action: "pause" | "resume" | "terminate";
  state: JobProcessState;
  revision: number;
  updatedAt: string;
  message: string;
  replayed: boolean;
}

export interface TerminateAllJobsResponse {
  ok: boolean;
  terminated: Array<{
    jobId: string;
    state: string;
    message: string;
  }>;
}

export interface ApiProblem {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
}

export interface HealthModel {
  ok: boolean;
  mode: string;
  authRequired: boolean;
  exposed: boolean;
  openapiUrl: string;
  publicBaseUrl: string | null;
  build: RuntimeBuildProvenance;
}

export type RepoGovernanceStatus = "enabled" | "missing" | "blocked";
export type RepoGovernanceSource = "default" | "default-sibling" | "local-config";
export type RepoGovernanceCapability = "pack" | "files-read" | "codex-run";

export interface RepoGovernanceEntry {
  repoId: string;
  status: RepoGovernanceStatus;
  defaultRepo: boolean;
  source: RepoGovernanceSource;
  pathConfigured: boolean;
  allowlisted: boolean;
  pathVisibility: "hidden";
  capabilities: RepoGovernanceCapability[];
}

export interface RepoGovernanceModel {
  defaultRepoId: string;
  configScope: "local-private";
  pathVisibility: "hidden";
  repos: RepoGovernanceEntry[];
}

export interface GptConfigModel {
  version: string;
  productVersion: string;
  schemaVersion: string;
  buildVersion: string;
  updatedAt: string;
  actionHost: string;
  openapiUrl: string;
  publicBaseUrl: string | null;
  schemaImportUrl: string;
  repoGovernance: RepoGovernanceModel;
  instructions: string;
  notes: string[];
}

export interface GptConfigResponse {
  ok: boolean;
  config: GptConfigModel;
}

export type ConnectivityProviderDetection = "detected" | "not-detected" | "probe-failed";
export type ConnectivityProviderMachineAction = "install" | "upgrade" | "uninstall";
export type ConnectivityProviderActionUnavailableReason =
  | "homebrew-not-detected"
  | "provider-already-detected"
  | "provider-not-detected"
  | "provider-not-managed"
  | "provider-probe-failed"
  | "adapter-not-implemented";

export interface ConnectivityProviderPublicActionAvailability {
  action: ConnectivityProviderMachineAction;
  available: boolean;
  reason: ConnectivityProviderActionUnavailableReason | null;
}

export interface ConnectivityProviderPublicStatus {
  id: "cloudflare-tunnel" | "ngrok" | "frp-client";
  displayName: string;
  detection: ConnectivityProviderDetection;
  version: string | null;
  managedByChatCockpit: boolean;
  actions: ConnectivityProviderPublicActionAvailability[];
}

export interface ConnectivityProviderPublicSnapshot {
  ok: true;
  schemaVersion: 1;
  providers: ConnectivityProviderPublicStatus[];
}

export type PublicRouteCandidateSource =
  | "existing-environment"
  | "cloudflare-tunnel"
  | "ngrok"
  | "frp-client";

export interface PublicRouteCandidate {
  id: string;
  origin: string;
  source: PublicRouteCandidateSource;
  status: "staged-unverified";
  createdAt: string;
  updatedAt: string;
}

export interface PublicRouteCandidateSnapshot {
  ok: true;
  schemaVersion: 1;
  canonical: {
    origin: string | null;
    configured: boolean;
    source: "runtime-config";
  };
  candidate: PublicRouteCandidate | null;
}

export type PublicRouteVerificationReason =
  | "not-attempted"
  | "dns-failed"
  | "no-addresses"
  | "too-many-addresses"
  | "non-public-address"
  | "tls-error"
  | "network-error"
  | "timeout"
  | "response-too-large"
  | "unexpected-status"
  | "invalid-json"
  | "unexpected-health-contract"
  | "unexpected-oauth-metadata";

export interface PublicRouteVerificationCheck {
  ok: boolean;
  reason: PublicRouteVerificationReason | null;
  statusCode?: number | null;
  publicAddressCount?: number;
}

export interface PublicRouteVerificationArtifact {
  id: string;
  candidateId: string;
  candidateOrigin: string;
  status: "verified" | "failed";
  checkedAt: string;
  checks: {
    dns: PublicRouteVerificationCheck;
    tls: PublicRouteVerificationCheck;
    reachability: PublicRouteVerificationCheck;
    identity: PublicRouteVerificationCheck;
    oauth: PublicRouteVerificationCheck;
  };
}

export interface PublicRouteVerificationSnapshot extends PublicRouteCandidateSnapshot {
  verification: PublicRouteVerificationArtifact | null;
}

export interface PublicRouteCutoverIntent {
  schemaVersion: 1;
  id: string;
  kind: "replacement";
  status: "pending-machine-execution";
  candidateId: string;
  candidateOrigin: string;
  candidateSource: PublicRouteCandidateSource;
  verificationId: string;
  expectedCanonicalOrigin: string;
  requiresMachineAuthority: true;
  changesCanonicalOrigin: true;
  mayRestartRunningRuntime: true;
  startsStoppedRuntime: false;
  startsProviderTunnel: false;
  writesProviderSecrets: false;
  preparedAt: string;
  expiresAt: string;
}

export interface PublicRouteCutoverIntentSnapshot {
  ok: true;
  schemaVersion: 1;
  intent: PublicRouteCutoverIntent | null;
}

export type PublicRouteBootstrapVerificationReason =
  | "not-attempted"
  | "dns-failed"
  | "no-addresses"
  | "too-many-addresses"
  | "non-public-address"
  | "tls-error"
  | "network-error"
  | "timeout"
  | "response-too-large"
  | "unexpected-status"
  | "proof-mismatch";

export interface PublicRouteBootstrapVerificationCheck {
  ok: boolean;
  reason: PublicRouteBootstrapVerificationReason | null;
  statusCode?: number | null;
  publicAddressCount?: number;
}

export interface PublicRouteBootstrapVerificationArtifact {
  id: string;
  status: "verified" | "failed";
  checkedAt: string;
  checks: {
    dns: PublicRouteBootstrapVerificationCheck;
    tls: PublicRouteBootstrapVerificationCheck;
    reachability: PublicRouteBootstrapVerificationCheck;
    identity: PublicRouteBootstrapVerificationCheck;
  };
}

export interface PublicRouteBootstrapProof {
  id: string;
  candidateId: string;
  candidateOrigin: string;
  status: "prepared" | "verified";
  preparedAt: string;
  expiresAt: string;
  verifiedAt: string | null;
  verification: PublicRouteBootstrapVerificationArtifact | null;
}

export interface PublicRouteBootstrapProofSnapshot extends PublicRouteCandidateSnapshot {
  proof: PublicRouteBootstrapProof | null;
}

export type OAuthAuthorizationGrantStatus = "pending" | "active" | "inactive" | "revoked";

export interface OAuthAuthorizationGrantSummary {
  id: string;
  clientRegistrationId: string;
  displayLabel: string;
  scope: string;
  resource: string;
  status: OAuthAuthorizationGrantStatus;
  legacy: boolean;
  createdAt: string;
  lastTokenIssuedAt: string | null;
  revokedAt: string | null;
  activeAccessTokenCount: number;
  activeRefreshTokenCount: number;
}

export interface OAuthAuthorizationGrantsResponse {
  ok: true;
  enabled: boolean;
  grants: OAuthAuthorizationGrantSummary[];
}

export interface IntegrationStatusResponse {
  ok: true;
  localCockpitUrl: string;
  publicCockpitUrl: string | null;
  localApiBaseUrl: string;
  publicApiBaseUrl: string | null;
  openapiUrl: string;
  mcp: {
    endpoint: string | null;
    scope: "chatcockpit:mcp";
    oauthStatus: "disabled" | "ready" | "needs-attention";
    oauthReady: boolean;
    authorizedClientCount: number;
    activeAuthorizationGrantCount: number;
    activeAccessTokenCount: number;
    activeRefreshTokenCount: number;
    toolCatalogStatus: "ready";
    toolCount: number;
  };
  machineApi: {
    configured: boolean;
  };
}

export interface JobCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export interface JobSummary extends JobBase {}

export interface ArtifactPreviewState {
  content: string;
  nextOffset: number | null;
  eof: boolean;
}

export type ContinuitySectionKey =
  | "projects"
  | "documents"
  | "tasks"
  | "sessions"
  | "recovery"
  | "handoffs"
  | "evidence"
  | "approvals";

export type ContinuityProjectStatus = "active" | "archived";
export type ContinuityWorkspaceKind = "checkout" | "worktree";
export type ContinuityWorkspaceStatus =
  | "ready"
  | "missing"
  | "blocked"
  | "archived";

export interface ContinuityProjectRecord {
  id: string;
  slug: string;
  displayName: string;
  defaultWorkspaceId: string | null;
  status: ContinuityProjectStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ContinuityWorkspaceRecord {
  id: string;
  projectId: string;
  repoId: string;
  kind: ContinuityWorkspaceKind;
  branch: string | null;
  headCommit: string | null;
  dirty: boolean;
  status: ContinuityWorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ContinuityProjectProjection {
  project: ContinuityProjectRecord;
  workspaces: ContinuityWorkspaceRecord[];
}

export interface ContinuityProjectsResponse {
  ok: true;
  projects: ContinuityProjectProjection[];
}

export type ContinuityTaskStatus =
  | "backlog"
  | "ready"
  | "in-progress"
  | "blocked"
  | "review"
  | "completed"
  | "cancelled";
export type ContinuityTaskPriority = "low" | "normal" | "high" | "critical";
export type ContinuityTaskExecutionPolicy =
  | "planning-required"
  | "planning-optional";
export type ContinuityDevelopmentDocumentKind = "spec" | "plan";
export type ContinuityDevelopmentDocumentStatus =
  | "draft"
  | "ready"
  | "approved"
  | "superseded"
  | "archived";
export type ContinuityPlanningRequirementState =
  | "not-bound"
  | "relation-invalid"
  | "unapproved"
  | "stale"
  | "approved-current";
export type ContinuitySessionMode =
  | "chat-direct"
  | "codex-session"
  | "async-agent";
export type ContinuitySessionStatus =
  | "idle"
  | "running"
  | "waiting-approval"
  | "handoff-ready"
  | "completed"
  | "failed";
export type ContinuityHandoffStatus =
  | "draft"
  | "ready"
  | "accepted"
  | "superseded";
export type ContinuityEvidenceStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "not-run";
export type ContinuityVerificationState =
  | "verified"
  | "incomplete"
  | "missing";

export interface ContinuityDevelopmentDocumentRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  kind: ContinuityDevelopmentDocumentKind;
  title: string;
  status: ContinuityDevelopmentDocumentStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ContinuityDevelopmentDocumentVersionSummary {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  changeSummary: string;
  createdAt: string;
}

export interface ContinuityDevelopmentDocumentVersionRecord
  extends ContinuityDevelopmentDocumentVersionSummary {
  contentMarkdown: string;
}

export interface ContinuityDevelopmentDocumentSummary {
  document: ContinuityDevelopmentDocumentRecord;
  currentVersion: ContinuityDevelopmentDocumentVersionSummary;
}

export interface ContinuityDevelopmentDocumentDetail
  extends ContinuityDevelopmentDocumentSummary {
  currentContent: ContinuityDevelopmentDocumentVersionRecord;
  versions: ContinuityDevelopmentDocumentVersionSummary[];
}

export interface ContinuityDevelopmentDocumentsResponse {
  ok: true;
  documents: ContinuityDevelopmentDocumentSummary[];
}

export interface ContinuityDevelopmentDocumentDetailResponse
  extends ContinuityDevelopmentDocumentDetail {
  ok: true;
}

export interface ContinuityDevelopmentDocumentMutationResponse
  extends ContinuityDevelopmentDocumentDetailResponse {
  replayed: boolean;
}

export interface ContinuityTaskDocumentBindResponse {
  ok: true;
  task: ContinuityTaskRecord;
  spec: ContinuityDevelopmentDocumentSummary | null;
  plan: ContinuityDevelopmentDocumentSummary | null;
  replayed: boolean;
}

export interface ContinuityTaskRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  specId: string | null;
  specVersion: number | null;
  planId: string | null;
  planVersion: number | null;
  parentTaskId: string | null;
  title: string;
  goal: string;
  status: ContinuityTaskStatus;
  priority: ContinuityTaskPriority;
  executionPolicy: ContinuityTaskExecutionPolicy;
  activeSessionId: string | null;
  latestHandoffId: string | null;
  latestEvidenceBundleId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export type ContinuityRuntimeBindingStatus =
  | "active"
  | "superseded"
  | "released"
  | "stale";

export interface ContinuityRuntimeBindingRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  runtimeKind: "codex-app-server" | "tokenpilot-runner";
  externalSessionId: string | null;
  externalRunId: string | null;
  sourceExternalId: string | null;
  externalThreadId: string | null;
  sourceThreadId: string | null;
  relation: "bound" | "resumed" | "forked" | "queued";
  status: ContinuityRuntimeBindingStatus;
  modelProvider: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ContinuitySessionRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  title: string;
  mode: ContinuitySessionMode;
  status: ContinuitySessionStatus;
  activeRuntimeBindingId: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  revision: number;
}

export interface ContinuityWriterLeaseRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  holderType: ContinuitySessionMode;
  holderId: string;
  status: "active" | "released" | "expired" | "revoked";
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  revision: number;
}

export interface ContinuityHandoffRecord {
  id: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  fromMode: ContinuitySessionMode;
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
  diffArtifactId: string | null;
  evidenceBundleId: string | null;
  status: ContinuityHandoffStatus;
  createdAt: string;
  acceptedAt: string | null;
  revision: number;
}

export interface ContinuityEvidenceBundleRecord {
  id: string;
  taskId: string;
  sessionId: string;
  status: "collecting" | "complete" | "incomplete";
  requiredItemCount: number;
  passedItemCount: number;
  failedItemCount: number;
  skippedItemCount: number;
  createdAt: string;
  completedAt: string | null;
  revision: number;
}

export interface ContinuityEvidenceItemRecord {
  id: string;
  bundleId: string;
  kind: string;
  label: string;
  status: ContinuityEvidenceStatus;
  required: boolean;
  command: string | null;
  exitCode: number | null;
  artifactId: string | null;
  summary: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ContinuityRuntimeApprovalRecord {
  id: string;
  runId: string;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  turnId: string;
  itemId: string | null;
  requestMethod: string;
  kind: "command-execution" | "file-change" | "permissions" | "unsupported";
  status: "pending" | "responded" | "resolved" | "cancelled" | "stale";
  publicSummary: Record<string, unknown>;
  decision: Record<string, unknown> | null;
  receivedAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  revision: number;
}

export interface ContinuityPlanningRequirementAssessment {
  kind: ContinuityDevelopmentDocumentKind;
  state: ContinuityPlanningRequirementState;
  documentId: string | null;
  pinnedVersion: number | null;
  currentVersion: number | null;
  status: ContinuityDevelopmentDocumentStatus | null;
}

export interface ContinuityTaskExecutionPolicyAssessment {
  taskId: string;
  policy: ContinuityTaskExecutionPolicy;
  allowed: boolean;
  blockers: string[];
  spec: ContinuityPlanningRequirementAssessment;
  plan: ContinuityPlanningRequirementAssessment;
}

export interface ContinuityTaskCompletionBlocker {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ContinuityWorkspaceRuntimeJobProjection {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  artifacts: JobArtifactSummary[];
}

export interface ContinuityWorkspaceSessionRuntimeProjection {
  sessionId: string;
  binding: ContinuityRuntimeBindingRecord | null;
  job: ContinuityWorkspaceRuntimeJobProjection | null;
}

export interface ContinuityWorkspaceTaskProjection {
  task: ContinuityTaskRecord;
  sessions: ContinuitySessionRecord[];
  runtimes: ContinuityWorkspaceSessionRuntimeProjection[];
  latestHandoff: ContinuityHandoffRecord | null;
  evidence: {
    bundle: ContinuityEvidenceBundleRecord;
    items: ContinuityEvidenceItemRecord[];
    verificationState: ContinuityVerificationState;
  } | null;
  executionPolicy: ContinuityTaskExecutionPolicyAssessment;
  completion: {
    eligible: boolean;
    blockers: ContinuityTaskCompletionBlocker[];
  };
}

export interface ContinuityWorkspaceSnapshot {
  project: ContinuityProjectRecord;
  workspace: ContinuityWorkspaceRecord;
  activeLease: ContinuityWriterLeaseRecord | null;
  readOnly: boolean;
  readOnlyReason: "active-writer" | null;
  git: {
    available: boolean;
    branch: string | null;
    headCommit: string | null;
    dirty: boolean;
    changedPaths: string[];
    unavailableReason: string | null;
  };
  tasks: ContinuityWorkspaceTaskProjection[];
  pendingApprovals: ContinuityRuntimeApprovalRecord[];
}

export type RuntimeRecoveryAction =
  | "resume-bound-codex"
  | "fork-bound-codex"
  | "bind-existing-codex-thread"
  | "continue-via-handoff"
  | "continue-chat-direct"
  | "reconcile-runner-binding";

export type RuntimeRecoveryClassification =
  | "healthy"
  | "recoverable"
  | "binding-missing"
  | "provider-unavailable"
  | "provider-auth-required"
  | "provider-version-unsupported"
  | "provider-protocol-incompatible"
  | "external-runtime-missing"
  | "external-runtime-busy"
  | "external-runtime-identity-mismatch"
  | "writer-conflict"
  | "pending-approval"
  | "active-run"
  | "handoff-required"
  | "blocked";

export interface RuntimeRecoveryCompatibility {
  providerKind: string;
  protocolKind: "native-app-server" | "runner" | "chat-direct" | "acp";
  available: boolean;
  executableSource: "path" | "custom" | "bundled" | "internal" | null;
  executableVersion: string | null;
  minimumSupportedVersion: string | null;
  testedVersionRange: string | null;
  protocolFamily: string | null;
  protocolVersion: string | null;
  schemaFingerprint: string | null;
  compatibilityStatus:
    | "ready"
    | "unavailable"
    | "auth-required"
    | "version-unsupported"
    | "protocol-incompatible"
    | "degraded";
  publicReason: string | null;
  probedAt: string;
}

export interface RuntimeRecoverableExternalSession {
  externalSessionId: string;
  providerKind: string;
  protocolKind: "native-app-server" | "runner" | "chat-direct" | "acp";
  projectId: string | null;
  workspaceId: string | null;
  repoId: string | null;
  status: string;
  preview: string;
  createdAt: number | null;
  updatedAt: number | null;
  recencyAt: number | null;
}

export interface RuntimeExternalSessionInspection
  extends RuntimeRecoverableExternalSession {
  exists: boolean;
  authoritative: boolean;
  busy: boolean;
  identityMatched: boolean;
}

export interface RuntimeRecoveryBlocker {
  code: RuntimeRecoveryClassification;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeRecoveryAttempt {
  id: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  sessionId: string | null;
  sourceBindingId: string | null;
  providerKind: string;
  protocolKind: "native-app-server" | "runner" | "chat-direct" | "acp";
  classification: RuntimeRecoveryClassification;
  assessmentHash: string;
  selectedAction: RuntimeRecoveryAction | null;
  status: "prepared" | "applied" | "blocked" | "failed" | "superseded" | "expired";
  resultingBindingId: string | null;
  publicSummary: Record<string, unknown>;
  compatibility: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  revision: number;
}

export interface RuntimeRecoveryAssessment {
  recoveryId: string;
  classification: RuntimeRecoveryClassification;
  blockers: RuntimeRecoveryBlocker[];
  availableActions: RuntimeRecoveryAction[];
  compatibility: RuntimeRecoveryCompatibility;
  candidates: RuntimeRecoverableExternalSession[];
  externalSession: RuntimeExternalSessionInspection | null;
  assessmentHash: string;
  expiresAt: string;
}

export interface RuntimeRecoveryAssessResponse {
  ok: true;
  attempt: RuntimeRecoveryAttempt;
  assessment: RuntimeRecoveryAssessment;
  replayed: boolean;
}

export interface RuntimeRecoveryExecuteResponse {
  ok: true;
  attempt: RuntimeRecoveryAttempt;
  action: RuntimeRecoveryAction;
  resultingBinding: ContinuityRuntimeBindingRecord | null;
  resultingTaskId: string | null;
  resultingSessionId: string | null;
  externalSessionId: string | null;
  replayed: boolean;
}

export interface ContinuityWorkspaceSnapshotResponse {
  ok: true;
  snapshot: ContinuityWorkspaceSnapshot;
}

export interface ContinuityTaskReviewResponse {
  ok: true;
  task: ContinuityTaskRecord;
  evidenceBundle: ContinuityEvidenceBundleRecord;
  replayed: boolean;
}

export interface ContinuityTaskCompletionResponse {
  ok: true;
  task: ContinuityTaskRecord;
  sessions: ContinuitySessionRecord[];
  handoff: ContinuityHandoffRecord;
  evidenceBundle: ContinuityEvidenceBundleRecord;
  replayed: boolean;
}

export interface ContinuityHandoffMutationResponse {
  ok: true;
  handoff: ContinuityHandoffRecord;
  replayed: boolean;
}

export interface ContinuityHandoffForkResponse
  extends ContinuityHandoffMutationResponse {
  task: ContinuityTaskRecord;
  session: ContinuitySessionRecord;
}

export type RuntimeResourceKind =
  | "skill"
  | "mcp-server"
  | "plugin"
  | "runtime-adapter"
  | "acp-agent";
export type RuntimeResourceScope =
  | "user"
  | "workspace"
  | "runtime"
  | "registry"
  | "unknown";
export type RuntimeResourceSnapshotStatus = "ready" | "partial" | "failed";
export type RuntimeResourceUpdateStatus =
  | "current"
  | "update-available"
  | "unknown"
  | "not-applicable";
export type RuntimeResourceAuthStatus =
  | "ready"
  | "required"
  | "unsupported"
  | "unknown"
  | "not-applicable";
export type RuntimeResourceCompatibilityStatus =
  | "ready"
  | "degraded"
  | "blocked"
  | "unknown";
export type RuntimeResourceSourceKind =
  | "runtime-native"
  | "tokenpilot-local"
  | "acp-registry";
export type RuntimeResourceMutationOperation =
  | "skill.enable"
  | "skill.disable"
  | "plugin.install"
  | "plugin.uninstall";
export type RuntimeResourceMutationApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "stale"
  | "consumed";
export type RuntimeResourceMutationVerificationStatus =
  | "executing"
  | "verified"
  | "failed-external"
  | "failed-verification"
  | "stale";
export type RuntimeResourceMutationActorType =
  | "local-cli"
  | "local-ui"
  | "rest-api"
  | "gpt-actions"
  | "remote-mcp"
  | "runner";

export interface RuntimeResourceMutationEligibility {
  operation: RuntimeResourceMutationOperation;
  eligible: boolean;
  code: string;
  stage: "eligible" | "platform" | "state" | "policy";
  publicReason: string;
}

export interface RuntimeResourceMutationEligibilityEntry {
  resourceId: string;
  snapshotId: string;
  operations: RuntimeResourceMutationEligibility[];
}

export interface RuntimeResourceMutationActor {
  type: RuntimeResourceMutationActorType;
  identityHash: string | null;
}

export interface RuntimeResourceMutationApproval {
  id: string;
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  resourceKind: "skill" | "plugin";
  resourceScope: RuntimeResourceScope;
  beforeSnapshotId: string;
  beforeFingerprint: string;
  requestedState: Record<string, boolean>;
  publicSummary: Record<string, string | boolean>;
  requestedActor: RuntimeResourceMutationActor | null;
  decidedActor: RuntimeResourceMutationActor | null;
  status: RuntimeResourceMutationApprovalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface RuntimeResourceMutationExecution {
  id: string;
  approvalId: string;
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  beforeSnapshotId: string;
  beforeFingerprint: string;
  afterSnapshotId: string | null;
  afterFingerprint: string | null;
  requestedState: Record<string, boolean>;
  observedState: Record<string, string | number | boolean> | null;
  providerMethod: "skills/config/write" | "plugin/install" | "plugin/uninstall";
  verificationStatus: RuntimeResourceMutationVerificationStatus;
  errorCode: string | null;
  executedActor: RuntimeResourceMutationActor | null;
  startedAt: string;
  finishedAt: string | null;
}

export type OperationalActivityKind = "agent-session" | "job";
export type OperationalActivityScope = "workspace" | "repo" | "host";
export type OperationalActivityStatus =
  | "queued"
  | "idle"
  | "running"
  | "waiting-approval"
  | "paused"
  | "handoff-ready"
  | "completed"
  | "failed"
  | "interrupted"
  | "terminated"
  | "stale";

export type OperationalActivityEventKind =
  | "run-started"
  | "run-completed"
  | "run-failed"
  | "run-interrupted"
  | "step-started"
  | "step-completed"
  | "approval-required"
  | "approval-resolved"
  | "approval-rejected"
  | "warning"
  | "error"
  | "activity";

export interface OperationalActivityEventProjection {
  id: string;
  activityId: string;
  source: "runtime";
  sequence: number;
  kind: OperationalActivityEventKind;
  category: "lifecycle" | "approval" | "item" | "warning" | "error" | "other";
  approvalKind: "command-execution" | "file-change" | "permissions" | "unsupported" | null;
  itemType: string | null;
  code: string | null;
  createdAt: string;
}

export interface OperationalActivityRuntimeProjection {
  bindingId: string;
  runtimeKind: "codex-app-server" | "async-runner";
  bindingStatus: "active" | "superseded" | "released" | "stale";
  externalSessionId: string | null;
  externalRunId: string | null;
  externalThreadId: string | null;
  runId: string | null;
  runRevision: number | null;
  turnId: string | null;
  runStatus:
    | "starting"
    | "running"
    | "waiting-approval"
    | "completed"
    | "failed"
    | "interrupted"
    | "stale"
    | null;
}

export interface OperationalActivityProjection {
  id: string;
  kind: OperationalActivityKind;
  scope: OperationalActivityScope;
  status: OperationalActivityStatus;
  title: string;
  targetDeviceId: "local-device";
  projectId: string | null;
  workspaceId: string | null;
  taskId: string | null;
  repoId: string | null;
  agentSessionId: string | null;
  authorizationGrantId: string | null;
  traceId: string | null;
  workerInstanceId: string | null;
  runtime: OperationalActivityRuntimeProjection | null;
  job: {
    id: string;
    type: "pack" | "taskpack" | "codex-run";
    status: "queued" | "running" | "completed" | "failed";
    processState: "running" | "paused" | "terminated" | "completed" | "failed" | null;
    processLabel: string | null;
  } | null;
  directProcessSummary: { total: number; active: number; running: number };
  latestEvent: OperationalActivityEventProjection | null;
  controls: { pause: boolean; resume: boolean; terminate: boolean; interrupt: boolean; hold: false };
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface OperationalActivityEventResponse {
  ok: true;
  event: OperationalActivityEventProjection;
}

export interface OperationalActivityListResponse {
  ok: true;
  activities: OperationalActivityProjection[];
  counts: {
    total: number;
    active: number;
    running: number;
    waitingApproval: number;
    paused: number;
  };
}

export interface DeviceTargetDescriptor {
  id: "local-device";
  kind: "device";
  locality: "local";
  platform: string;
  architecture: string;
}

export interface CapabilityProviderDescriptor {
  id: string;
  providerKind: string;
  protocolKind: string;
  displayName: string;
  compatibilityStatus: "ready" | "degraded" | "unsupported" | "unavailable";
  authStatus: "ready" | "required" | "unknown" | "not-applicable";
  capabilities: string[];
  publicReason: string | null;
}

export interface RuntimeProfileDescriptor extends CapabilityProviderDescriptor {
  executableSource: "bundled" | "path" | "custom" | "registry" | null;
  executableVersion: string | null;
  protocolVersion: string | null;
  homeIdentityHash: string | null;
}

export interface CapabilityProviderManagementExposureTool {
  toolName: string;
  mode: "read" | "mutation";
}

export interface CapabilityProviderManagementDescriptor {
  id: string;
  targetId: "local-device";
  providerKind: string;
  protocolKind: string;
  displayName: string;
  catalogId: string | null;
  supportTier: "managed" | "observed" | "connected" | "catalog-only";
  executorId: string | null;
  detectionStatus:
    | "detected"
    | "not-observed"
    | "not-detected"
    | "unverified"
    | "stale";
  version: string | null;
  protocolVersion: string | null;
  health: "ready" | "degraded" | "unavailable" | "unknown";
  capabilities: string[];
  configurationStatus: "configured" | "provider-native" | "not-configured";
  exposureStatus: "enabled" | "disabled" | "not-applicable";
  exposedTools: CapabilityProviderManagementExposureTool[];
  allowedLifecycleOperations: Array<
    "install" | "update" | "configure" | "start" | "stop" | "restart"
  >;
  desiredState: {
    routerExposure: "enabled" | "disabled" | "not-applicable";
  };
  observedState: {
    detected: boolean | null;
    health: "ready" | "degraded" | "unavailable" | "unknown";
    version: string | null;
    capabilities: string[];
  };
  verification: {
    status: "verified" | "unverified" | "stale";
    observedAt: string | null;
    source: "downstream-mcp-probe" | "runtime-profile" | "provider-catalog";
  };
  publicReason: string | null;
}

export interface CapabilityProviderManagementProjection {
  target: DeviceTargetDescriptor;
  providers: CapabilityProviderManagementDescriptor[];
}

export interface RuntimeResourceDescriptor {
  id: string;
  runtimeProfileId: string;
  kind: RuntimeResourceKind;
  externalId: string;
  displayName: string;
  description: string | null;
  scope: RuntimeResourceScope;
  installed: boolean | null;
  enabled: boolean | null;
  version: string | null;
  availableVersion: string | null;
  updateStatus: RuntimeResourceUpdateStatus;
  authStatus: RuntimeResourceAuthStatus;
  compatibilityStatus: RuntimeResourceCompatibilityStatus;
  sourceKind: RuntimeResourceSourceKind;
  sourceLabel: string;
  capabilities: string[];
  publicReason: string | null;
  fingerprint: string;
}

export interface RuntimeResourceInventoryDiagnostic {
  source: string;
  status: "ready" | "degraded" | "failed";
  code: string | null;
  message: string | null;
}

export interface RuntimeResourceSnapshotItem {
  snapshotId: string;
  resourceId: string;
  kind: RuntimeResourceKind;
  externalId: string;
  displayName: string;
  description: string | null;
  scope: RuntimeResourceScope;
  installed: boolean | null;
  enabled: boolean | null;
  version: string | null;
  availableVersion: string | null;
  updateStatus: RuntimeResourceUpdateStatus;
  authStatus: RuntimeResourceAuthStatus;
  compatibilityStatus: RuntimeResourceCompatibilityStatus;
  sourceKind: RuntimeResourceSourceKind;
  sourceLabel: string;
  capabilities: string[];
  publicReason: string | null;
  fingerprint: string;
}

export interface RuntimeResourceSnapshot {
  id: string;
  runtimeProfileId: string;
  providerKind: string;
  protocolKind: string;
  status: RuntimeResourceSnapshotStatus;
  profile: Record<string, unknown>;
  fingerprint: string;
  capturedAt: string;
  revision: number;
  items: RuntimeResourceSnapshotItem[];
}

export interface RuntimeResourceDiff {
  previousSnapshotId: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

export interface RuntimeResourceProfilesResponse {
  ok: true;
  target: DeviceTargetDescriptor;
  providers: CapabilityProviderDescriptor[];
  profiles: RuntimeProfileDescriptor[];
  management: CapabilityProviderManagementProjection;
}

export interface RuntimeResourceInventoryResponse {
  ok: true;
  snapshot: RuntimeResourceSnapshot;
  profile: RuntimeProfileDescriptor;
  resources: RuntimeResourceDescriptor[];
  mutationWritesEnabled: boolean;
  mutationEligibility: RuntimeResourceMutationEligibilityEntry[];
  diagnostics: RuntimeResourceInventoryDiagnostic[];
  diff: RuntimeResourceDiff;
  replayed: boolean;
}

export interface RuntimeResourceSnapshotResponse {
  ok: true;
  snapshot: RuntimeResourceSnapshot;
}

export interface RuntimeResourceInspectResponse {
  ok: true;
  snapshot: RuntimeResourceSnapshot;
  resource: RuntimeResourceDescriptor;
}

export interface RuntimeResourceMutationApprovalResponse {
  ok: true;
  approval: RuntimeResourceMutationApproval;
  replayed: boolean;
}

export interface RuntimeResourceMutationExecuteResponse {
  ok: true;
  approval: RuntimeResourceMutationApproval;
  execution: RuntimeResourceMutationExecution;
  replayed: boolean;
}

export interface RuntimeResourceMutationActivityResponse {
  ok: true;
  approvals: RuntimeResourceMutationApproval[];
  executions: RuntimeResourceMutationExecution[];
}
