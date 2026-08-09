export type JobType = "pack" | "taskpack" | "codex-run";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobProcessState = "running" | "paused" | "terminated" | "completed" | "failed";

export interface JobProcessInfo {
  state: JobProcessState;
  updatedAt: string;
  label: string;
}

export interface HealthResponse {
  ok: boolean;
  mode: string;
  authRequired: boolean;
  exposed: boolean;
  publicBaseUrl: string | null;
  openapiUrl: string;
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
  ok: boolean;
  jobId: string;
  action: "pause" | "resume" | "terminate";
  state: string;
  message: string;
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

export interface RuntimeProfileDescriptor {
  id: string;
  providerKind: string;
  protocolKind: string;
  displayName: string;
  executableSource: "bundled" | "path" | "custom" | "registry" | null;
  executableVersion: string | null;
  protocolVersion: string | null;
  compatibilityStatus: "ready" | "degraded" | "unsupported" | "unavailable";
  homeIdentityHash: string | null;
  authStatus: "ready" | "required" | "unknown" | "not-applicable";
  capabilities: string[];
  publicReason: string | null;
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
  profiles: RuntimeProfileDescriptor[];
}

export interface RuntimeResourceInventoryResponse {
  ok: true;
  snapshot: RuntimeResourceSnapshot;
  profile: RuntimeProfileDescriptor;
  resources: RuntimeResourceDescriptor[];
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
