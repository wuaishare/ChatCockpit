export type ProjectStatus = "active" | "archived";
export type WorkspaceKind = "checkout" | "worktree";
export type WorkspaceStatus = "ready" | "missing" | "blocked" | "archived";
export type TaskStatus =
  | "backlog"
  | "ready"
  | "in-progress"
  | "blocked"
  | "review"
  | "completed"
  | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "critical";
export type TaskExecutionPolicy = "planning-required" | "planning-optional";
export type DevelopmentDocumentKind = "spec" | "plan";
export type DevelopmentDocumentStatus =
  | "draft"
  | "ready"
  | "approved"
  | "superseded"
  | "archived";
export type SessionMode = "chat-direct" | "codex-session" | "async-agent";
export type SessionStatus =
  | "idle"
  | "running"
  | "waiting-approval"
  | "handoff-ready"
  | "completed"
  | "failed";
export type LeaseStatus = "active" | "released" | "expired" | "revoked";
export type AsyncRunnerRuntimeBindingKind = "tokenpilot-runner" | "async-runner";
export type RuntimeBindingKind = "codex-app-server" | AsyncRunnerRuntimeBindingKind;
export type RuntimeBindingRelation = "bound" | "resumed" | "forked" | "queued";
export type RuntimeBindingStatus = "active" | "superseded" | "released" | "stale";
export type RuntimeRunStatus =
  | "starting"
  | "running"
  | "waiting-approval"
  | "completed"
  | "failed"
  | "interrupted"
  | "stale";
export type RuntimeApprovalKind =
  | "command-execution"
  | "file-change"
  | "permissions"
  | "unsupported";
export type RuntimeApprovalStatus =
  | "pending"
  | "responded"
  | "resolved"
  | "cancelled"
  | "stale";
export type DirectMutationOperation = "files.write" | "files.edit";
export type DirectMutationTargetKind = "workspace" | "pure-host";
export type DirectMutationApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "consumed"
  | "expired";
export type DirectMutationAuditStatus = "succeeded" | "failed" | "unknown";
export type DirectCommandEffect = "read" | "write";
export type DirectCommandTargetKind = DirectMutationTargetKind;
export type DirectCommandApprovalStatus = DirectMutationApprovalStatus;
export type DirectCommandAuditStatus = DirectMutationAuditStatus;
export type DirectProcessStatus =
  | "starting"
  | "running"
  | "exited"
  | "terminated"
  | "failed"
  | "stale";
export type DirectProcessOperation = "start" | "input" | "stop";
export type DirectProcessAuditOperation = DirectProcessOperation | "cleanup";
export type DirectProcessApprovalStatus = DirectMutationApprovalStatus;
export type DirectProcessAuditStatus = DirectMutationAuditStatus;
export type RuntimeRecoveryAttemptStatus =
  | "prepared"
  | "applied"
  | "blocked"
  | "failed"
  | "superseded"
  | "expired";
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
export type RuntimeRecoveryProtocolKind =
  | "native-app-server"
  | "runner"
  | "chat-direct"
  | "acp";
export type RuntimeRecoveryAction =
  | "resume-bound-codex"
  | "fork-bound-codex"
  | "bind-existing-codex-thread"
  | "continue-via-handoff"
  | "continue-chat-direct"
  | "reconcile-runner-binding";
export type RuntimeResourceSnapshotStatus = "ready" | "partial" | "failed";
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
  | "control-plane-local"
  | "acp-registry";
export type RuntimeEventCategory =
  | "lifecycle"
  | "approval"
  | "item"
  | "warning"
  | "error"
  | "other";
export type HandoffMode = SessionMode | "unassigned";
export type HandoffStatus = "draft" | "ready" | "accepted" | "superseded";
export type CodexThreadImportState = "assessed" | "importing" | "ready" | "failed";
export type EvidenceStatus = "passed" | "failed" | "skipped" | "not-run";
export type EvidenceKind =
  | "command"
  | "test"
  | "build"
  | "lint"
  | "typecheck"
  | "diff"
  | "review"
  | "screenshot"
  | "manual";

export interface ProjectRecord {
  id: string;
  slug: string;
  displayName: string;
  defaultWorkspaceId: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface WorkspaceRecord {
  id: string;
  projectId: string;
  repoId: string;
  kind: WorkspaceKind;
  branch: string | null;
  headCommit: string | null;
  dirty: boolean;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface PrivateWorkspaceRecord extends WorkspaceRecord {
  privatePath: string;
}

export interface DevelopmentDocumentRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  kind: DevelopmentDocumentKind;
  title: string;
  status: DevelopmentDocumentStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface DevelopmentDocumentVersionRecord {
  id: string;
  documentId: string;
  version: number;
  contentMarkdown: string;
  contentHash: string;
  changeSummary: string;
  createdAt: string;
}

export interface TaskRecord {
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
  status: TaskStatus;
  priority: TaskPriority;
  executionPolicy: TaskExecutionPolicy;
  activeSessionId: string | null;
  latestHandoffId: string | null;
  latestEvidenceBundleId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface DevelopmentSessionRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  activeRuntimeBindingId: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  revision: number;
}

interface RuntimeBindingBaseRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  runtimeKind: RuntimeBindingKind;
  externalSessionId: string | null;
  externalRunId: string | null;
  sourceExternalId: string | null;
  externalThreadId: string | null;
  sourceThreadId: string | null;
  relation: RuntimeBindingRelation;
  status: RuntimeBindingStatus;
  modelProvider: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface CodexRuntimeBindingRecord extends RuntimeBindingBaseRecord {
  runtimeKind: "codex-app-server";
  externalSessionId: string;
  externalRunId: null;
  externalThreadId: string;
  relation: "bound" | "resumed" | "forked";
}

export interface RunnerRuntimeBindingRecord extends RuntimeBindingBaseRecord {
  runtimeKind: AsyncRunnerRuntimeBindingKind;
  externalSessionId: null;
  externalRunId: string;
  externalThreadId: null;
  sourceThreadId: null;
  relation: "queued";
}

export type RuntimeBindingRecord =
  | CodexRuntimeBindingRecord
  | RunnerRuntimeBindingRecord;

export interface RuntimeRunRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  runtimeBindingId: string;
  threadId: string;
  externalTurnId: string | null;
  status: RuntimeRunStatus;
  inputHash: string;
  inputLength: number;
  handoffId: string;
  evidenceBundleId: string;
  writerLeaseId: string;
  modelLoopOwner: "codex";
  approvalPolicy: "on-request";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  revision: number;
}

export interface RuntimeApprovalRecord {
  id: string;
  runId: string;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  turnId: string;
  itemId: string | null;
  requestMethod: string;
  kind: RuntimeApprovalKind;
  status: RuntimeApprovalStatus;
  publicSummary: Record<string, unknown>;
  decision: Record<string, unknown> | null;
  receivedAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  revision: number;
}

export interface DirectMutationApprovalRecord {
  id: string;
  operation: DirectMutationOperation;
  rootId: string;
  relativePath: string;
  mutationHash: string;
  executorId: string;
  scope: "host";
  targetKind: DirectMutationTargetKind;
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
  status: DirectMutationApprovalStatus;
  publicSummary: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface DirectMutationAuditRecord {
  id: string;
  operation: DirectMutationOperation;
  rootId: string;
  relativePath: string;
  beforeHash: string | null;
  afterHash: string | null;
  executorId: string;
  approvalId: string;
  status: DirectMutationAuditStatus;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface DirectCommandApprovalRecord {
  id: string;
  rootId: string;
  workdir: string;
  command: string;
  args: string[];
  commandHash: string;
  effect: DirectCommandEffect;
  timeoutMs: number;
  executorId: string;
  targetKind: DirectCommandTargetKind;
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
  status: DirectCommandApprovalStatus;
  publicSummary: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface DirectCommandAuditRecord {
  id: string;
  rootId: string;
  workdir: string;
  commandHash: string;
  effect: DirectCommandEffect;
  executorId: string;
  approvalId: string;
  exitCode: number | null;
  timedOut: boolean;
  status: DirectCommandAuditStatus;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface DirectProcessSessionRecord {
  id: string;
  rootId: string;
  workdir: string;
  command: string;
  commandHash: string;
  executorId: string;
  workspaceId: string;
  repoId: string;
  sessionId: string;
  writerLeaseId: string;
  privatePid: number | null;
  status: DirectProcessStatus;
  exitCode: number | null;
  staleReason: string | null;
  evidenceBundleId: string | null;
  startedAt: string;
  completedAt: string | null;
  revision: number;
}

export interface DirectProcessRuntimeOwnershipRecord {
  processId: string;
  supervisorGeneration: string;
  attachedAt: string;
  lastSeenAt: string;
  revision: number;
}

export interface DirectProcessApprovalRecord {
  id: string;
  operation: DirectProcessOperation;
  processId: string | null;
  actionHash: string;
  rootId: string | null;
  workdir: string | null;
  command: string | null;
  workspaceId: string;
  repoId: string;
  sessionId: string;
  writerLeaseId: string | null;
  executorId: string;
  inputHash: string | null;
  inputBytes: number | null;
  status: DirectProcessApprovalStatus;
  publicSummary: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  revision: number;
}

export interface DirectProcessAuditRecord {
  id: string;
  operation: DirectProcessAuditOperation;
  processId: string;
  actionHash: string;
  approvalId: string | null;
  status: DirectProcessAuditStatus;
  errorCode: string | null;
  terminalReason: string | null;
  exitCode: number | null;
  outputBytes: number;
  outputTruncated: boolean;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface RuntimeRecoveryAttemptRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  sessionId: string | null;
  sourceBindingId: string | null;
  providerKind: string;
  protocolKind: RuntimeRecoveryProtocolKind;
  classification: RuntimeRecoveryClassification;
  assessmentHash: string;
  selectedAction: RuntimeRecoveryAction | null;
  status: RuntimeRecoveryAttemptStatus;
  resultingBindingId: string | null;
  publicSummary: Record<string, unknown>;
  compatibility: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  revision: number;
}

export interface RuntimeResourceItemRecord {
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

export interface RuntimeResourceSnapshotRecord {
  id: string;
  runtimeProfileId: string;
  providerKind: string;
  protocolKind: string;
  status: RuntimeResourceSnapshotStatus;
  profile: Record<string, unknown>;
  fingerprint: string;
  capturedAt: string;
  revision: number;
  items: RuntimeResourceItemRecord[];
}

export interface RuntimeEventRecord {
  sequence: number;
  id: string;
  runId: string | null;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  turnId: string | null;
  itemId: string | null;
  method: string;
  category: RuntimeEventCategory;
  publicPayload: Record<string, unknown>;
  createdAt: string;
}

export interface WriterLeaseRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  holderType: SessionMode;
  holderId: string;
  status: LeaseStatus;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  revision: number;
}

export interface CodexThreadImportRecord {
  id: string;
  sourceThreadId: string;
  projectId: string;
  workspaceId: string;
  state: CodexThreadImportState;
  assessmentHash: string;
  expiresAt: string;
  sourceTaskId: string | null;
  sourceSessionId: string | null;
  handoffId: string | null;
  continuationTaskId: string | null;
  continuationSessionId: string | null;
  contextTruncated: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface HandoffCheckpointRecord {
  id: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  fromMode: SessionMode;
  toMode: HandoffMode;
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
  status: HandoffStatus;
  createdAt: string;
  acceptedAt: string | null;
  revision: number;
}

export interface EvidenceBundleRecord {
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

export interface EvidenceItemRecord {
  id: string;
  bundleId: string;
  kind: EvidenceKind;
  label: string;
  status: EvidenceStatus;
  required: boolean;
  command: string | null;
  exitCode: number | null;
  artifactId: string | null;
  summary: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface MutationControl {
  expectedRevision: number;
  idempotencyKey: string;
}
