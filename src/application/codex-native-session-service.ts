import type {
  CodexNativeThreadForkInput,
  CodexNativeThreadResumeInput,
  CodexNativeThreadStartInput
} from "../contracts/codex-runtime.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  RuntimeCodexAccountStatus,
  RuntimeThreadProjection
} from "../runtime/codex/runtime-adapter.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";
import { ServiceError } from "./service-error.js";

export interface CodexNativeThreadMutationResult {
  thread: RuntimeThreadProjection;
  replayed: boolean;
}

export class CodexNativeSessionService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly runtime: RuntimeRouter
  ) {}

  async start(
    _context: OperationContext,
    input: CodexNativeThreadStartInput
  ): Promise<CodexNativeThreadMutationResult> {
    const workspace = this.repositories.workspaces.get(input.workspaceId);
    if (workspace.status !== "ready") {
      throw new ServiceError(
        "WORKSPACE_NOT_READY",
        "Codex native session requires a ready ChatCockpit workspace"
      );
    }
    const project = this.repositories.projects.get(workspace.projectId);
    const requestedName = (
      input.name?.trim() || `ChatCockpit · ${project.displayName}`
    ).slice(0, 120);
    const result = await this.repositories.idempotency.executeExternalMutation(
      "codex-native.thread.start",
      input.idempotencyKey,
      { workspaceId: workspace.id, name: requestedName },
      () =>
        this.runtime.startCodexThread({
          workspaceId: workspace.id,
          name: requestedName
        }),
      (thread) => {
        this.assertThreadWorkspace(thread, workspace.id, workspace.projectId);
        return { thread };
      }
    );
    return { ...result.value, replayed: result.replayed };
  }

  async resume(
    _context: OperationContext,
    input: CodexNativeThreadResumeInput
  ): Promise<CodexNativeThreadMutationResult> {
    const workspace = this.repositories.workspaces.get(input.workspaceId);
    const result = await this.repositories.idempotency.executeExternalMutation(
      "codex-native.thread.resume",
      input.idempotencyKey,
      { workspaceId: workspace.id, threadId: input.threadId },
      async () => {
        const current = await this.runtime.readCodexThread({
          threadId: input.threadId,
          includeTurns: false
        });
        this.assertThreadWorkspace(current, workspace.id, workspace.projectId);
        const resumed = await this.runtime.resumeCodexThread({
          threadId: input.threadId
        });
        if (resumed.id !== input.threadId) {
          throw new ServiceError(
            "CODEX_THREAD_RESPONSE_INVALID",
            "Codex native resume returned a different thread id"
          );
        }
        return resumed;
      },
      (thread) => {
        this.assertThreadWorkspace(thread, workspace.id, workspace.projectId);
        return { thread };
      }
    );
    return { ...result.value, replayed: result.replayed };
  }

  async fork(
    _context: OperationContext,
    input: CodexNativeThreadForkInput
  ): Promise<CodexNativeThreadMutationResult> {
    const workspace = this.repositories.workspaces.get(input.workspaceId);
    const result = await this.repositories.idempotency.executeExternalMutation(
      "codex-native.thread.fork",
      input.idempotencyKey,
      {
        workspaceId: workspace.id,
        threadId: input.threadId,
        lastTurnId: input.lastTurnId ?? null
      },
      async () => {
        const current = await this.runtime.readCodexThread({
          threadId: input.threadId,
          includeTurns: false
        });
        this.assertThreadWorkspace(current, workspace.id, workspace.projectId);
        return this.runtime.forkCodexThread({
          threadId: input.threadId,
          lastTurnId: input.lastTurnId ?? null
        });
      },
      (thread) => {
        this.assertThreadWorkspace(thread, workspace.id, workspace.projectId);
        if (thread.id === input.threadId) {
          throw new ServiceError(
            "CODEX_THREAD_RESPONSE_INVALID",
            "Codex native fork did not create a distinct thread"
          );
        }
        return { thread };
      }
    );
    return { ...result.value, replayed: result.replayed };
  }

  accountStatus(_context: OperationContext): Promise<RuntimeCodexAccountStatus> {
    return this.runtime.readCodexAccountStatus();
  }

  private assertThreadWorkspace(
    thread: RuntimeThreadProjection,
    workspaceId: string,
    projectId: string
  ): void {
    if (!thread.workspaceId || !thread.projectId) {
      throw new ServiceError(
        "CODEX_THREAD_WORKSPACE_UNREGISTERED",
        "Codex thread is not associated with a registered ChatCockpit workspace"
      );
    }
    if (thread.workspaceId !== workspaceId || thread.projectId !== projectId) {
      throw new ServiceError(
        "RUNTIME_WORKSPACE_MISMATCH",
        "Codex thread belongs to a different ChatCockpit workspace"
      );
    }
  }
}
