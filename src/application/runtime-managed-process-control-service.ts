import { isChatDirectManagedProcessId } from "../core/managed-workspace-process.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { DirectProcessSessionRecord } from "../continuity/types.js";
import type { ChatDirectService } from "./chat-direct-service.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import type {
  RuntimeStandaloneProcessChunk,
  RuntimeStandaloneProcessSnapshot
} from "../runtime/codex/runtime-adapter.js";

const OPERATION_NAME = "runtime.managed-process.terminate.v1";

export interface RuntimeManagedProcessTerminateInput {
  processId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface RuntimeManagedProcessTerminateResult {
  processId: string;
  expectedRevision: number;
  terminationRequested: true;
  replayed: boolean;
}

export interface RuntimeManagedProcessOutputInput {
  processId: string;
  cursor?: number;
  limit?: number;
}

export interface RuntimeManagedProcessOutputResult {
  processId: string;
  sessionId: string | null;
  state: RuntimeStandaloneProcessSnapshot["state"];
  exitCode: number | null;
  errorCode: string | null;
  chunks: RuntimeStandaloneProcessChunk[];
  nextCursor: number;
  retained: true;
}

export class RuntimeManagedProcessControlService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly chatDirect: ChatDirectService
  ) {}

  async readOutput(
    context: OperationContext,
    input: RuntimeManagedProcessOutputInput
  ): Promise<RuntimeManagedProcessOutputResult> {
    if (context.actorType !== "local-ui") {
      throw new ServiceError(
        "RUNTIME_PROCESS_OUTPUT_FORBIDDEN",
        "Runtime managed process output requires the local Operator control plane"
      );
    }
    const process = this.repositories.directProcessSessions.get(input.processId);
    if (
      process.scope !== "workspace" ||
      !isChatDirectManagedProcessId(process.id)
    ) {
      throw new ServiceError(
        "RUNTIME_PROCESS_OUTPUT_UNSUPPORTED",
        "This managed process is not owned by the Chat Direct workspace runtime"
      );
    }
    const snapshot = await this.chatDirect.readManagedProcessByControlPlane(
      process.id,
      input.cursor ?? 0,
      input.limit ?? 100
    );
    return {
      processId: process.id,
      sessionId: process.sessionId,
      state: snapshot.state,
      exitCode: snapshot.exitCode,
      errorCode: snapshot.errorCode,
      chunks: snapshot.chunks,
      nextCursor: snapshot.nextCursor,
      retained: true
    };
  }

  async terminate(
    context: OperationContext,
    input: RuntimeManagedProcessTerminateInput
  ): Promise<RuntimeManagedProcessTerminateResult> {
    if (context.actorType !== "local-ui") {
      throw new ServiceError(
        "RUNTIME_PROCESS_CONTROL_FORBIDDEN",
        "Runtime managed process control requires the local Operator control plane"
      );
    }
    const execution = await this.repositories.idempotency.executePreparedExternalMutation<
      DirectProcessSessionRecord,
      true,
      Omit<RuntimeManagedProcessTerminateResult, "replayed">
    >(
      OPERATION_NAME,
      input.idempotencyKey,
      input,
      () => this.prepareTermination(input),
      async (process) => {
        await this.chatDirect.terminateManagedProcessByControlPlane(process.id);
        return true as const;
      },
      (process) => ({
        processId: process.id,
        expectedRevision: process.revision,
        terminationRequested: true as const
      }),
      undefined,
      context.now
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  private prepareTermination(
    input: RuntimeManagedProcessTerminateInput
  ): DirectProcessSessionRecord {
    const process = this.repositories.directProcessSessions.get(input.processId);
    if (process.revision !== input.expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        "Managed process revision changed before termination",
        {
          details: {
            processId: process.id,
            expectedRevision: input.expectedRevision,
            actualRevision: process.revision
          }
        }
      );
    }
    if (
      process.scope !== "workspace" ||
      !isChatDirectManagedProcessId(process.id)
    ) {
      throw new ServiceError(
        "RUNTIME_PROCESS_CONTROL_UNSUPPORTED",
        "This managed process is not controlled by the Chat Direct workspace runtime"
      );
    }
    if (process.status !== "starting" && process.status !== "running") {
      throw new ServiceError(
        "RUNTIME_PROCESS_NOT_ACTIVE",
        "Managed process is no longer active"
      );
    }
    return process;
  }
}
