import type {
  CodexSessionBindInput,
  CodexSessionForkInput,
  CodexSessionResumeInput
} from "../contracts/codex-runtime.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  RuntimeBindingRecord
} from "../continuity/types.js";
import type { RuntimeThreadProjection } from "../runtime/codex/runtime-adapter.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";
import { ServiceError } from "./service-error.js";

export interface RuntimeBindingMutationResult {
  binding: RuntimeBindingRecord;
  session: DevelopmentSessionRecord;
  thread: RuntimeThreadProjection;
  replayed: boolean;
}

interface PreparedSession {
  session: DevelopmentSessionRecord;
  workspaceId: string;
  projectId: string;
}

export class RuntimeBindingService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly runtime: RuntimeRouter
  ) {}

  async bind(
    _context: OperationContext,
    input: CodexSessionBindInput
  ): Promise<RuntimeBindingMutationResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeBindingMutationResult, "replayed">
    >("codex.session.bind", input.idempotencyKey, input);
    if (replay) {
      return {
        ...replay.value,
        replayed: true
      };
    }

    const prepared = this.prepareSession(
      input.sessionId,
      input.expectedSessionRevision
    );
    const thread = await this.runtime.readCodexThread({
      threadId: input.threadId,
      includeTurns: false
    });
    this.assertThreadWorkspace(thread, prepared);

    const execution = this.repositories.idempotency.execute(
      "codex.session.bind",
      input.idempotencyKey,
      input,
      () => this.commitBinding(prepared, thread, "bound", null)
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  async resume(
    _context: OperationContext,
    input: CodexSessionResumeInput
  ): Promise<RuntimeBindingMutationResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeBindingMutationResult, "replayed">
    >("codex.session.resume", input.idempotencyKey, input);
    if (replay) {
      return {
        ...replay.value,
        replayed: true
      };
    }

    const prepared = this.prepareSession(
      input.sessionId,
      input.expectedSessionRevision
    );
    const source = await this.runtime.readCodexThread({
      threadId: input.threadId,
      includeTurns: false
    });
    this.assertThreadWorkspace(source, prepared);

    const execution = await this.repositories.idempotency.executeExternalMutation(
      "codex.session.resume",
      input.idempotencyKey,
      input,
      () => this.runtime.resumeCodexThread({ threadId: input.threadId }),
      (thread) => {
        this.assertThreadWorkspace(thread, prepared);
        return this.commitBinding(prepared, thread, "resumed", null);
      }
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  async fork(
    _context: OperationContext,
    input: CodexSessionForkInput
  ): Promise<RuntimeBindingMutationResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeBindingMutationResult, "replayed">
    >("codex.session.fork", input.idempotencyKey, input);
    if (replay) {
      return {
        ...replay.value,
        replayed: true
      };
    }

    const prepared = this.prepareSession(
      input.sessionId,
      input.expectedSessionRevision
    );
    const source = await this.runtime.readCodexThread({
      threadId: input.threadId,
      includeTurns: false
    });
    this.assertThreadWorkspace(source, prepared);

    const execution = await this.repositories.idempotency.executeExternalMutation(
      "codex.session.fork",
      input.idempotencyKey,
      input,
      () =>
        this.runtime.forkCodexThread({
          threadId: input.threadId,
          lastTurnId: input.lastTurnId ?? null
        }),
      (thread) => {
        this.assertThreadWorkspace(thread, prepared);
        if (thread.id === source.id) {
          throw new ServiceError(
            "CODEX_THREAD_RESPONSE_INVALID",
            "Codex App Server fork returned the source thread id"
          );
        }
        return this.commitBinding(prepared, thread, "forked", source.id);
      }
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  private prepareSession(
    sessionId: string,
    expectedRevision: number
  ): PreparedSession {
    const session = this.repositories.sessions.get(sessionId);
    if (session.revision !== expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Development session ${sessionId} revision does not match`,
        {
          details: {
            expectedRevision,
            actualRevision: session.revision
          }
        }
      );
    }
    if (session.mode !== "codex-session") {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Codex runtime bindings require a codex-session development session"
      );
    }
    if (["completed", "failed"].includes(session.status)) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Completed or failed sessions cannot receive a Codex runtime binding"
      );
    }

    const workspace = this.repositories.workspaces.get(session.workspaceId);
    if (workspace.projectId !== session.projectId) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "The development session workspace does not belong to its project"
      );
    }
    return {
      session,
      workspaceId: workspace.id,
      projectId: workspace.projectId
    };
  }

  private assertThreadWorkspace(
    thread: RuntimeThreadProjection,
    prepared: PreparedSession
  ): void {
    if (
      thread.workspaceId !== prepared.workspaceId ||
      thread.projectId !== prepared.projectId
    ) {
      throw new ServiceError(
        "RUNTIME_WORKSPACE_MISMATCH",
        "The Codex thread is not associated with the development session workspace",
        {
          details: {
            threadId: thread.id,
            expectedWorkspaceId: prepared.workspaceId,
            actualWorkspaceId: thread.workspaceId,
            expectedProjectId: prepared.projectId,
            actualProjectId: thread.projectId
          }
        }
      );
    }
  }

  private commitBinding(
    prepared: PreparedSession,
    thread: RuntimeThreadProjection,
    relation: "bound" | "resumed" | "forked",
    sourceThreadId: string | null
  ): Omit<RuntimeBindingMutationResult, "replayed"> {
    const binding = this.repositories.runtimeBindings.replaceActive({
      sessionId: prepared.session.id,
      workspaceId: prepared.workspaceId,
      externalThreadId: thread.id,
      sourceThreadId,
      relation,
      modelProvider: thread.modelProvider
    });
    const session = this.repositories.sessions.bindRuntime(
      prepared.session.id,
      binding.id,
      prepared.session.revision
    );
    return {
      binding,
      session,
      thread
    };
  }
}
