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

export interface TaskRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  specId: string | null;
  planId: string | null;
  parentTaskId: string | null;
  title: string;
  goal: string;
  status: TaskStatus;
  priority: TaskPriority;
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
