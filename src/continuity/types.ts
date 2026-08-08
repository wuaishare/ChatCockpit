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
export type RuntimeBindingKind = "codex-app-server" | "tokenpilot-runner";
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
export type RuntimeEventCategory =
  | "lifecycle"
  | "approval"
  | "item"
  | "warning"
  | "error"
  | "other";
export type HandoffMode = SessionMode | "unassigned";
export type HandoffStatus = "draft" | "ready" | "accepted" | "superseded";
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
  runtimeKind: "tokenpilot-runner";
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
