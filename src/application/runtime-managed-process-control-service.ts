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

const TERMINATE_OPERATION_NAME = "runtime.managed-process.terminate.v1";
const INPUT_OPERATION_NAME = "runtime.managed-process.input.v1";
const RESIZE_OPERATION_NAME = "runtime.managed-process.resize.v1";

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

export interface RuntimeManagedProcessInputInput {
  processId: string;
  expectedRevision: number;
  input: string;
  closeStdin?: boolean;
  idempotencyKey: string;
}

export interface RuntimeManagedProcessInputResult {
  processId: string;
  expectedRevision: number;
  accepted: true;
  stdinClosed: boolean;
  replayed: boolean;
}

export interface RuntimeManagedProcessResizeInput {
  processId: string;
  expectedRevision: number;
  rows: number;
  cols: number;
  idempotencyKey: string;
}

export interface RuntimeManagedProcessResizeResult {
  processId: string;
  expectedRevision: number;
  resized: true;
  rows: number;
  cols: number;
  replayed: boolean;
}

export interface RuntimeManagedProcessCapabilities {
  input: boolean;
  resize: boolean;
  terminate: boolean;
  tty: boolean;
  terminalSize: { rows: number; cols: number } | null;
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

  capabilities(
    processId: string,
    context?: OperationContext
  ): RuntimeManagedProcessCapabilities {
    let process: DirectProcessSessionRecord;
    try {
      process = this.repositories.directProcessSessions.get(processId);
    } catch {
      return {
        input: false,
        resize: false,
        terminate: false,
        tty: false,
        terminalSize: null
      };
    }
    const active = process.status === "starting" || process.status === "running";
    if (
      !active ||
      process.scope !== "workspace" ||
      !isChatDirectManagedProcessId(process.id)
    ) {
      return {
        input: false,
        resize: false,
        terminate: false,
        tty: false,
        terminalSize: null
      };
    }
    return this.chatDirect.managedProcessCapabilitiesByControlPlane(process.id, context);
  }

  async input(
    context: OperationContext,
    input: RuntimeManagedProcessInputInput
  ): Promise<RuntimeManagedProcessInputResult> {
    this.assertLocalUi(context);
    const execution = await this.repositories.idempotency.executePreparedExternalMutation<
      DirectProcessSessionRecord,
      true,
      Omit<RuntimeManagedProcessInputResult, "replayed">
    >(
      INPUT_OPERATION_NAME,
      input.idempotencyKey,
      input,
      () => this.prepareControl(input, "input"),
      async (process) => {
        await this.chatDirect.inputManagedProcessByControlPlane(
          context,
          process.id,
          input.input,
          input.closeStdin === true
        );
        return true as const;
      },
      (process) => ({
        processId: process.id,
        expectedRevision: process.revision,
        accepted: true as const,
        stdinClosed: input.closeStdin === true
      }),
      undefined,
      context.now
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  async resize(
    context: OperationContext,
    input: RuntimeManagedProcessResizeInput
  ): Promise<RuntimeManagedProcessResizeResult> {
    this.assertLocalUi(context);
    const execution = await this.repositories.idempotency.executePreparedExternalMutation<
      DirectProcessSessionRecord,
      true,
      Omit<RuntimeManagedProcessResizeResult, "replayed">
    >(
      RESIZE_OPERATION_NAME,
      input.idempotencyKey,
      input,
      () => this.prepareControl(input, "resize"),
      async (process) => {
        await this.chatDirect.resizeManagedProcessByControlPlane(
          process.id,
          input.rows,
          input.cols
        );
        return true as const;
      },
      (process) => ({
        processId: process.id,
        expectedRevision: process.revision,
        resized: true as const,
        rows: input.rows,
        cols: input.cols
      }),
      undefined,
      context.now
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  async terminate(
    context: OperationContext,
    input: RuntimeManagedProcessTerminateInput
  ): Promise<RuntimeManagedProcessTerminateResult> {
    this.assertLocalUi(context);
    const execution = await this.repositories.idempotency.executePreparedExternalMutation<
      DirectProcessSessionRecord,
      true,
      Omit<RuntimeManagedProcessTerminateResult, "replayed">
    >(
      TERMINATE_OPERATION_NAME,
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

  private assertLocalUi(context: OperationContext): void {
    if (context.actorType !== "local-ui") {
      throw new ServiceError(
        "RUNTIME_PROCESS_CONTROL_FORBIDDEN",
        "Runtime managed process control requires the local Operator control plane"
      );
    }
  }

  private prepareControl(
    input: { processId: string; expectedRevision: number },
    capability: "input" | "resize" | "terminate"
  ): DirectProcessSessionRecord {
    const process = this.repositories.directProcessSessions.get(input.processId);
    if (process.revision !== input.expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        "Managed process revision changed before control",
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
    const capabilities = this.chatDirect.managedProcessCapabilitiesByControlPlane(process.id);
    if (!capabilities[capability]) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        `Managed process ${capability} control is unavailable`
      );
    }
    return process;
  }

  private prepareTermination(
    input: RuntimeManagedProcessTerminateInput
  ): DirectProcessSessionRecord {
    return this.prepareControl(input, "terminate");
  }
}
