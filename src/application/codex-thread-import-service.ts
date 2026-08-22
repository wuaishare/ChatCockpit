import { createHash } from "node:crypto";

import type {
  CodexThreadImportAssessInput,
  CodexThreadImportContextInput,
  CodexThreadImportExecuteInput
} from "../contracts/codex-thread-import.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  CodexThreadImportRecord,
  DevelopmentSessionRecord,
  HandoffCheckpointRecord,
  TaskRecord
} from "../continuity/types.js";
import type {
  RuntimeThreadContextPage,
  RuntimeThreadProjection
} from "../runtime/codex/runtime-adapter.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeBindingService } from "./runtime-binding-service.js";
import type { RuntimeRouter } from "./runtime-router.js";
import type { SessionService } from "./session-service.js";
import { ServiceError } from "./service-error.js";
import type { TaskService } from "./task-service.js";
import type { HandoffService } from "./handoff-service.js";

const ASSESSMENT_TTL_MS = 10 * 60 * 1000;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;

type WorkspaceMatch = "matched" | "mismatch" | "unregistered";
type ImportAction = "handoff-to-chat-direct";

interface WorkspaceGitSnapshot {
  available: boolean;
  branch: string | null;
  headCommit: string | null;
  dirty: boolean;
  changedPaths: string[];
  unavailableReason: string | null;
}

interface WorkspaceContinuityPort {
  snapshot(
    context: OperationContext,
    input: { workspaceId: string }
  ): { git: WorkspaceGitSnapshot };
}

export interface CodexThreadImportServiceOptions {
  repositories: ContinuityRepositories;
  runtime: RuntimeRouter;
  tasks: TaskService;
  sessions: SessionService;
  runtimeBindings: RuntimeBindingService;
  handoffs: HandoffService;
  workspaceContinuity: WorkspaceContinuityPort;
}

export interface CodexThreadImportAssessmentResult {
  assessmentId: string;
  assessmentHash: string;
  expiresAt: string;
  thread: RuntimeThreadProjection;
  matchedWorkspaceId: string | null;
  requestedWorkspaceId: string;
  workspaceMatch: WorkspaceMatch;
  availableActions: ImportAction[];
  import: CodexThreadImportRecord;
  replayed: boolean;
}

export interface CodexThreadImportExecutionResult {
  import: CodexThreadImportRecord;
  sourceTask: TaskRecord;
  sourceSession: DevelopmentSessionRecord;
  handoff: HandoffCheckpointRecord;
  continuationTask: TaskRecord;
  continuationSession: DevelopmentSessionRecord;
  contextSnapshotId: string;
  context: RuntimeThreadContextPage;
  replayed: boolean;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assessmentHash(
  thread: RuntimeThreadProjection,
  requestedWorkspaceId: string
): string {
  return stableHash({
    sourceThreadId: thread.id,
    requestedWorkspaceId,
    projectId: thread.projectId,
    workspaceId: thread.workspaceId,
    repoId: thread.repoId,
    modelProvider: thread.modelProvider,
    sourceKind: thread.sourceKind,
    status: {
      type: thread.status.type,
      activeFlags: thread.status.activeFlags ? [...thread.status.activeFlags].sort() : []
    },
    parentThreadId: thread.parentThreadId,
    updatedAt: thread.updatedAt,
    recencyAt: thread.recencyAt
  });
}

function expiresAt(now: string): string {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) {
    throw new ServiceError("VALIDATION_ERROR", "Operation time is invalid");
  }
  return new Date(parsed + ASSESSMENT_TTL_MS).toISOString();
}

function safeTitle(prefix: string, value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return `${prefix}${normalized || "Imported Codex thread"}`.slice(0, 240);
}

function validateStoredContext(value: unknown): RuntimeThreadContextPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      "Stored Codex thread context snapshot is invalid"
    );
  }
  const page = value as Partial<RuntimeThreadContextPage>;
  if (
    typeof page.threadId !== "string" ||
    !Array.isArray(page.messages) ||
    typeof page.truncated !== "boolean" ||
    !(page.nextCursor === null || typeof page.nextCursor === "string")
  ) {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      "Stored Codex thread context snapshot is incomplete"
    );
  }
  return value as RuntimeThreadContextPage;
}

export function normalizeCodexThreadReference(input: string): string {
  const value = input.trim();
  let threadId = value;
  if (value.startsWith("codex:")) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ServiceError(
        "CODEX_THREAD_REFERENCE_INVALID",
        "Codex thread reference is invalid"
      );
    }
    if (
      parsed.protocol !== "codex:" ||
      parsed.hostname !== "threads" ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.startsWith("/")
    ) {
      throw new ServiceError(
        "CODEX_THREAD_REFERENCE_INVALID",
        "Codex thread reference must use codex://threads/<thread-id>"
      );
    }
    try {
      threadId = decodeURIComponent(parsed.pathname.slice(1));
    } catch {
      throw new ServiceError(
        "CODEX_THREAD_REFERENCE_INVALID",
        "Codex thread reference contains invalid encoding"
      );
    }
  } else if (value.includes("://")) {
    throw new ServiceError(
      "CODEX_THREAD_REFERENCE_INVALID",
      "Only codex:// thread references or raw thread ids are accepted"
    );
  }

  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new ServiceError(
      "CODEX_THREAD_REFERENCE_INVALID",
      "Codex thread id is invalid"
    );
  }
  return threadId;
}

export class CodexThreadImportService {
  private readonly repositories: ContinuityRepositories;
  private readonly runtime: RuntimeRouter;
  private readonly tasks: TaskService;
  private readonly sessions: SessionService;
  private readonly runtimeBindings: RuntimeBindingService;
  private readonly handoffs: HandoffService;
  private readonly workspaceContinuity: WorkspaceContinuityPort;

  constructor(options: CodexThreadImportServiceOptions) {
    this.repositories = options.repositories;
    this.runtime = options.runtime;
    this.tasks = options.tasks;
    this.sessions = options.sessions;
    this.runtimeBindings = options.runtimeBindings;
    this.handoffs = options.handoffs;
    this.workspaceContinuity = options.workspaceContinuity;
  }

  async assess(
    context: OperationContext,
    input: CodexThreadImportAssessInput
  ): Promise<CodexThreadImportAssessmentResult> {
    const threadId = normalizeCodexThreadReference(input.threadRef);
    const idempotencyInput = {
      workspaceId: input.workspaceId,
      threadId
    };
    const replay = this.repositories.idempotency.replay<
      Omit<CodexThreadImportAssessmentResult, "replayed">
    >("codex-thread-import.assess", input.idempotencyKey, idempotencyInput);
    if (replay) {
      return { ...replay.value, replayed: true };
    }

    const requestedWorkspace = this.repositories.workspaces.get(input.workspaceId);
    const thread = await this.runtime.readCodexThread({
      threadId,
      includeTurns: false
    });
    const match = this.workspaceMatch(thread, requestedWorkspace.id);
    if (match === "unregistered") {
      throw new ServiceError(
        "CODEX_THREAD_WORKSPACE_UNREGISTERED",
        "Codex thread is not associated with a registered ChatCockpit workspace"
      );
    }
    if (match === "mismatch") {
      throw new ServiceError(
        "CODEX_THREAD_WORKSPACE_MISMATCH",
        "Codex thread belongs to a different registered workspace",
        {
          details: {
            requestedWorkspaceId: requestedWorkspace.id,
            actualWorkspaceId: thread.workspaceId
          }
        }
      );
    }
    if (thread.projectId !== requestedWorkspace.projectId) {
      throw new ServiceError(
        "CODEX_THREAD_WORKSPACE_MISMATCH",
        "Codex thread project does not match the requested workspace"
      );
    }

    const hash = assessmentHash(thread, requestedWorkspace.id);
    const expiry = expiresAt(context.now);
    const execution = this.repositories.idempotency.execute(
      "codex-thread-import.assess",
      input.idempotencyKey,
      idempotencyInput,
      () => {
        const existing = this.repositories.codexThreadImports.findBySourceThreadWorkspace(
          thread.id,
          requestedWorkspace.id
        );
        let importRecord: CodexThreadImportRecord;
        if (!existing) {
          importRecord = this.repositories.codexThreadImports.createAssessment({
            sourceThreadId: thread.id,
            projectId: requestedWorkspace.projectId,
            workspaceId: requestedWorkspace.id,
            assessmentHash: hash,
            expiresAt: expiry,
            now: context.now
          });
        } else if (existing.state === "ready") {
          throw new ServiceError(
            "CODEX_THREAD_IMPORT_ALREADY_IMPORTED",
            "Codex thread is already imported into this workspace",
            { details: { importId: existing.id } }
          );
        } else if (existing.state === "importing") {
          throw new ServiceError(
            "CODEX_THREAD_IMPORT_IN_PROGRESS",
            "Codex thread import is already in progress",
            { details: { importId: existing.id } }
          );
        } else {
          importRecord = this.repositories.codexThreadImports.refreshAssessment({
            id: existing.id,
            assessmentHash: hash,
            expiresAt: expiry,
            expectedRevision: existing.revision,
            now: context.now
          });
        }

        return {
          assessmentId: importRecord.id,
          assessmentHash: hash,
          expiresAt: expiry,
          thread,
          matchedWorkspaceId: thread.workspaceId,
          requestedWorkspaceId: requestedWorkspace.id,
          workspaceMatch: "matched" as const,
          availableActions: ["handoff-to-chat-direct" as const],
          import: importRecord
        };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  async execute(
    context: OperationContext,
    input: CodexThreadImportExecuteInput
  ): Promise<CodexThreadImportExecutionResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<CodexThreadImportExecutionResult, "replayed">
    >("codex-thread-import.execute", input.idempotencyKey, input);
    if (replay) {
      return { ...replay.value, replayed: true };
    }

    let importRecord = this.repositories.codexThreadImports.get(input.importId);
    if (importRecord.assessmentHash !== input.assessmentHash) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STALE",
        "Codex thread import assessment hash no longer matches"
      );
    }
    if (importRecord.expiresAt <= context.now && importRecord.state === "assessed") {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_EXPIRED",
        "Codex thread import assessment expired"
      );
    }
    if (
      importRecord.state !== "importing" &&
      importRecord.state !== "ready" &&
      importRecord.revision !== input.expectedRevision
    ) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Codex thread import ${importRecord.id} revision does not match`,
        {
          details: {
            expectedRevision: input.expectedRevision,
            actualRevision: importRecord.revision
          }
        }
      );
    }

    const currentThread = await this.runtime.readCodexThread({
      threadId: importRecord.sourceThreadId,
      includeTurns: false
    });
    this.assertExecutionThread(currentThread, importRecord);
    if (assessmentHash(currentThread, importRecord.workspaceId) !== input.assessmentHash) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STALE",
        "Codex thread changed after the import assessment"
      );
    }

    if (importRecord.state === "ready") {
      const ready = this.buildExecutionResult(importRecord);
      const stored = this.repositories.idempotency.execute(
        "codex-thread-import.execute",
        input.idempotencyKey,
        input,
        () => ready,
        context.now
      );
      return { ...stored.value, replayed: stored.replayed };
    }

    if (importRecord.state !== "importing") {
      importRecord = this.repositories.codexThreadImports.beginExecution({
        id: importRecord.id,
        expectedRevision: input.expectedRevision,
        assessmentHash: input.assessmentHash,
        now: context.now
      });
    }

    try {
      const source = await this.ensureSource(context, importRecord, currentThread);
      importRecord = source.importRecord;

      await this.ensureBinding(context, importRecord, source.sourceSession);

      const contextPage = await this.runtime.readCodexThreadContext({
        threadId: importRecord.sourceThreadId,
        limit: 40
      });
      this.assertContextWorkspace(contextPage, importRecord);

      const handoffResult = this.ensureHandoff(
        context,
        importRecord,
        currentThread,
        source.sourceTask,
        source.sourceSession,
        contextPage
      );
      importRecord = handoffResult.importRecord;

      const continuation = this.ensureContinuation(
        context,
        importRecord,
        handoffResult.handoff,
        source.sourceTask
      );
      importRecord = continuation.importRecord;

      if (importRecord.state !== "ready") {
        importRecord = this.repositories.codexThreadImports.markReady({
          id: importRecord.id,
          context: contextPage,
          contextTruncated: contextPage.truncated,
          expectedRevision: importRecord.revision,
          now: context.now
        });
      }

      const completed = this.buildExecutionResult(importRecord, contextPage);
      const stored = this.repositories.idempotency.execute(
        "codex-thread-import.execute",
        input.idempotencyKey,
        input,
        () => completed,
        context.now
      );
      return { ...stored.value, replayed: stored.replayed };
    } catch (error) {
      const current = this.repositories.codexThreadImports.get(importRecord.id);
      if (current.state === "importing") {
        try {
          this.repositories.codexThreadImports.markFailed({
            id: current.id,
            expectedRevision: current.revision,
            now: context.now
          });
        } catch {
          // Preserve the original failure. A later retry can reconcile durable relations.
        }
      }
      throw error;
    }
  }

  get(_context: OperationContext, importId: string): CodexThreadImportRecord {
    return this.repositories.codexThreadImports.get(importId);
  }

  async readContext(
    _context: OperationContext,
    input: CodexThreadImportContextInput
  ): Promise<RuntimeThreadContextPage> {
    const importRecord = this.repositories.codexThreadImports.get(input.importId);
    if (importRecord.state !== "ready") {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_NOT_READY",
        "Codex thread context is available only after import completes"
      );
    }

    if (!input.cursor) {
      const stored = this.repositories.codexThreadImports.readContext(importRecord.id);
      if (stored === null) {
        throw new ServiceError(
          "CODEX_THREAD_IMPORT_CONTEXT_MISSING",
          "Codex thread import has no stored context snapshot"
        );
      }
      return validateStoredContext(stored);
    }

    const page = await this.runtime.readCodexThreadContext({
      threadId: importRecord.sourceThreadId,
      cursor: input.cursor,
      limit: input.limit
    });
    this.assertContextWorkspace(page, importRecord);
    return page;
  }

  private workspaceMatch(
    thread: RuntimeThreadProjection,
    requestedWorkspaceId: string
  ): WorkspaceMatch {
    if (!thread.workspaceId || !thread.projectId || !thread.repoId) {
      return "unregistered";
    }
    return thread.workspaceId === requestedWorkspaceId ? "matched" : "mismatch";
  }

  private assertExecutionThread(
    thread: RuntimeThreadProjection,
    importRecord: CodexThreadImportRecord
  ): void {
    if (!thread.workspaceId || !thread.projectId || !thread.repoId) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STALE",
        "Codex thread is no longer associated with a registered workspace"
      );
    }
    if (
      thread.workspaceId !== importRecord.workspaceId ||
      thread.projectId !== importRecord.projectId ||
      thread.id !== importRecord.sourceThreadId
    ) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STALE",
        "Codex thread workspace identity changed after assessment"
      );
    }
  }

  private assertContextWorkspace(
    page: RuntimeThreadContextPage,
    importRecord: CodexThreadImportRecord
  ): void {
    if (
      page.threadId !== importRecord.sourceThreadId ||
      page.workspaceId !== importRecord.workspaceId ||
      page.projectId !== importRecord.projectId
    ) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STALE",
        "Codex thread context no longer matches the imported workspace"
      );
    }
  }

  private async ensureSource(
    context: OperationContext,
    importRecord: CodexThreadImportRecord,
    thread: RuntimeThreadProjection
  ): Promise<{
    importRecord: CodexThreadImportRecord;
    sourceTask: TaskRecord;
    sourceSession: DevelopmentSessionRecord;
  }> {
    let current = importRecord;
    const sourceTask = current.sourceTaskId
      ? this.repositories.tasks.get(current.sourceTaskId)
      : this.tasks.create(context, {
          projectId: current.projectId,
          workspaceId: current.workspaceId,
          specId: null,
          planId: null,
          parentTaskId: null,
          title: safeTitle("Imported Codex · ", thread.preview),
          goal: "Continue an explicitly imported Codex thread through Chat Direct without starting another Codex turn.",
          priority: "normal",
          executionPolicy: "planning-optional",
          idempotencyKey: `${current.id}:source-task`
        }).task;

    let sourceSession: DevelopmentSessionRecord;
    if (current.sourceSessionId) {
      sourceSession = this.repositories.sessions.get(current.sourceSessionId);
    } else {
      const refreshedTask = this.repositories.tasks.get(sourceTask.id);
      if (refreshedTask.activeSessionId) {
        const candidate = this.repositories.sessions.get(refreshedTask.activeSessionId);
        if (candidate.mode !== "codex-session") {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Imported source task already has a non-Codex active session"
          );
        }
        sourceSession = candidate;
      } else {
        sourceSession = this.sessions.start(context, {
          taskId: sourceTask.id,
          title: safeTitle("Imported Codex session · ", thread.preview),
          mode: "codex-session",
          expectedTaskRevision: refreshedTask.revision,
          idempotencyKey: `${current.id}:source-session`
        }).session;
      }
    }

    if (!current.sourceTaskId || !current.sourceSessionId) {
      current = this.repositories.codexThreadImports.recordSource({
        id: current.id,
        sourceTaskId: sourceTask.id,
        sourceSessionId: sourceSession.id,
        expectedRevision: current.revision,
        now: context.now
      });
    }
    return { importRecord: current, sourceTask, sourceSession };
  }

  private async ensureBinding(
    context: OperationContext,
    importRecord: CodexThreadImportRecord,
    sourceSession: DevelopmentSessionRecord
  ): Promise<void> {
    const existing = this.repositories.runtimeBindings.findActiveBySession(sourceSession.id);
    if (existing) {
      if (
        existing.runtimeKind !== "codex-app-server" ||
        existing.externalThreadId !== importRecord.sourceThreadId
      ) {
        throw new ServiceError(
          "CONTINUITY_RELATION_INVALID",
          "Imported Codex source session already has a different active runtime binding"
        );
      }
      return;
    }

    const currentSession = this.repositories.sessions.get(sourceSession.id);
    await this.runtimeBindings.bind(context, {
      sessionId: currentSession.id,
      threadId: importRecord.sourceThreadId,
      expectedSessionRevision: currentSession.revision,
      idempotencyKey: `${importRecord.id}:binding`
    });
  }

  private ensureHandoff(
    context: OperationContext,
    importRecord: CodexThreadImportRecord,
    thread: RuntimeThreadProjection,
    sourceTask: TaskRecord,
    sourceSession: DevelopmentSessionRecord,
    contextPage: RuntimeThreadContextPage
  ): { importRecord: CodexThreadImportRecord; handoff: HandoffCheckpointRecord } {
    let current = importRecord;
    let handoff: HandoffCheckpointRecord | null = current.handoffId
      ? this.repositories.handoffs.get(current.handoffId)
      : null;

    if (!handoff) {
      const task = this.repositories.tasks.get(sourceTask.id);
      if (task.latestHandoffId) {
        const candidate = this.repositories.handoffs.get(task.latestHandoffId);
        if (
          candidate.sessionId === sourceSession.id &&
          candidate.toMode === "chat-direct" &&
          ["ready", "accepted"].includes(candidate.status)
        ) {
          handoff = candidate;
        }
      }
    }

    if (!handoff) {
      const git = this.workspaceContinuity.snapshot(context, {
        workspaceId: current.workspaceId
      }).git;
      const risks: string[] = [];
      if (contextPage.truncated) {
        risks.push("Imported conversation context is truncated; read additional context pages before making assumptions.");
      }
      if (!git.available) {
        risks.push("Git status was unavailable during import; verify workspace state before writing.");
      }
      const task = this.repositories.tasks.get(sourceTask.id);
      handoff = this.handoffs.prepare(context, {
        taskId: sourceTask.id,
        sessionId: sourceSession.id,
        toMode: "chat-direct",
        goal: "Continue the imported Codex work in Chat Direct using the same governed workspace.",
        completedItems: [
          "Imported the existing Codex thread as read-only runtime provenance.",
          "Captured a bounded visible conversation context snapshot."
        ],
        pendingItems: [
          "Review the imported context and current workspace state, then continue the unfinished task in Chat Direct."
        ],
        changedFiles: git.available ? git.changedPaths.slice(0, 500) : [],
        risks,
        nextAction: "Read the imported context and workspace snapshot before continuing mutations through ChatCockpit.",
        gitHead: git.available ? git.headCommit : null,
        gitBranch: git.available ? git.branch : null,
        gitDirty: git.available ? git.dirty : true,
        diffArtifactId: null,
        evidenceBundleId: null,
        expectedTaskRevision: task.revision,
        idempotencyKey: `${current.id}:handoff`
      }).handoff;
    }

    if (!current.handoffId) {
      current = this.repositories.codexThreadImports.recordHandoff({
        id: current.id,
        handoffId: handoff.id,
        expectedRevision: current.revision,
        now: context.now
      });
    }
    return { importRecord: current, handoff };
  }

  private ensureContinuation(
    context: OperationContext,
    importRecord: CodexThreadImportRecord,
    handoff: HandoffCheckpointRecord,
    sourceTask: TaskRecord
  ): {
    importRecord: CodexThreadImportRecord;
    continuationTask: TaskRecord;
    continuationSession: DevelopmentSessionRecord;
  } {
    let current = importRecord;
    if (current.continuationTaskId && current.continuationSessionId) {
      return {
        importRecord: current,
        continuationTask: this.repositories.tasks.get(current.continuationTaskId),
        continuationSession: this.repositories.sessions.get(current.continuationSessionId)
      };
    }

    const currentHandoff = this.repositories.handoffs.get(handoff.id);
    const expectedRevision =
      currentHandoff.status === "accepted"
        ? Math.max(1, currentHandoff.revision - 1)
        : currentHandoff.revision;
    const forked = this.handoffs.fork(context, {
      handoffId: currentHandoff.id,
      expectedRevision,
      title: safeTitle("Chat Direct continuation · ", sourceTask.title),
      sessionTitle: safeTitle("Chat Direct · ", sourceTask.title),
      mode: "chat-direct",
      idempotencyKey: `${current.id}:continuation`
    });

    if (!current.continuationTaskId || !current.continuationSessionId) {
      current = this.repositories.codexThreadImports.recordContinuation({
        id: current.id,
        continuationTaskId: forked.task.id,
        continuationSessionId: forked.session.id,
        expectedRevision: current.revision,
        now: context.now
      });
    }
    return {
      importRecord: current,
      continuationTask: forked.task,
      continuationSession: forked.session
    };
  }

  private buildExecutionResult(
    importRecord: CodexThreadImportRecord,
    contextPage?: RuntimeThreadContextPage
  ): Omit<CodexThreadImportExecutionResult, "replayed"> {
    if (
      !importRecord.sourceTaskId ||
      !importRecord.sourceSessionId ||
      !importRecord.handoffId ||
      !importRecord.continuationTaskId ||
      !importRecord.continuationSessionId
    ) {
      throw new ServiceError(
        "CODEX_THREAD_IMPORT_STATE_INVALID",
        "Codex thread import is missing durable continuation identities"
      );
    }
    const storedContext =
      contextPage ?? validateStoredContext(this.repositories.codexThreadImports.readContext(importRecord.id));
    return {
      import: importRecord,
      sourceTask: this.repositories.tasks.get(importRecord.sourceTaskId),
      sourceSession: this.repositories.sessions.get(importRecord.sourceSessionId),
      handoff: this.repositories.handoffs.get(importRecord.handoffId),
      continuationTask: this.repositories.tasks.get(importRecord.continuationTaskId),
      continuationSession: this.repositories.sessions.get(importRecord.continuationSessionId),
      contextSnapshotId: importRecord.id,
      context: storedContext
    };
  }
}
