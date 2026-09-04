import { createHash, randomUUID } from "node:crypto";

import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { DirectProcessSessionRecord } from "../continuity/types.js";
import { CHATCOCKPIT_NATIVE_PTY_EXECUTOR_ID } from "../process-supervisor/native-session-terminal.js";
import type {
  NativeSessionTerminalProjection,
  NativeSessionTerminalReadResult
} from "../process-supervisor/native-session-terminal.js";
import {
  ProcessSupervisorClient,
  ProcessSupervisorClientError
} from "../process-supervisor/client.js";
import type { TokenPilotPaths } from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

const TERMINAL_ID_PREFIX = "session_terminal_";

export interface RuntimeSessionTerminalStartInput {
  sessionId: string;
  rows: number;
  cols: number;
  idempotencyKey: string;
}

export interface RuntimeSessionTerminalReadInput {
  terminalId: string;
  cursor?: number;
  limit?: number;
}

export interface RuntimeSessionTerminalControlInput {
  terminalId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface RuntimeSessionTerminalInputInput extends RuntimeSessionTerminalControlInput {
  input: string;
}

export interface RuntimeSessionTerminalResizeInput extends RuntimeSessionTerminalControlInput {
  rows: number;
  cols: number;
}

export interface RuntimeSessionTerminalProjection {
  terminalId: string;
  processRevision: number;
  sessionId: string;
  workspaceId: string;
  repoId: string | null;
  state: NativeSessionTerminalProjection["state"];
  exitCode: number | null;
  rows: number;
  cols: number;
  privatePid: number;
  startedAt: string;
  earliestSequence: number;
  nextSequence: number;
  scrollbackBytes: number;
  scrollbackTruncated: boolean;
  supervisorGeneration: string;
}

export interface RuntimeSessionTerminalReadResult extends RuntimeSessionTerminalProjection {
  chunks: NativeSessionTerminalReadResult["chunks"];
  nextCursor: number;
  cursorTruncated: boolean;
}

export interface RuntimeSessionTerminalListResult {
  terminals: RuntimeSessionTerminalProjection[];
}

export interface RuntimeSessionTerminalClient {
  request<T>(
    method:
      | "terminal.list"
      | "terminal.start"
      | "terminal.read"
      | "terminal.input"
      | "terminal.resize"
      | "terminal.stop",
    params: unknown
  ): Promise<{ supervisorGeneration: string; result: T }>;
}

function actionHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function actionId(kind: string, idempotencyKey: string): string {
  return `session-terminal:${kind}:${idempotencyKey}`;
}

function terminalId(): string {
  return `${TERMINAL_ID_PREFIX}${randomUUID()}`;
}

function terminalRecord(record: DirectProcessSessionRecord): boolean {
  return record.executorId === CHATCOCKPIT_NATIVE_PTY_EXECUTOR_ID;
}

export class RuntimeSessionTerminalService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly client: RuntimeSessionTerminalClient
  ) {}

  static forPaths(
    repositories: ContinuityRepositories,
    paths: TokenPilotPaths
  ): RuntimeSessionTerminalService {
    return new RuntimeSessionTerminalService(
      repositories,
      new ProcessSupervisorClient({ paths })
    );
  }

  async list(
    context: OperationContext,
    sessionId?: string
  ): Promise<RuntimeSessionTerminalListResult> {
    this.assertLocalUi(context);
    let response: {
      supervisorGeneration: string;
      result: { terminals: NativeSessionTerminalProjection[] };
    };
    try {
      response = await this.client.request<{ terminals: NativeSessionTerminalProjection[] }>(
        "terminal.list",
        {}
      );
    } catch (error) {
      throw this.mapSupervisorError(error, "SESSION_TERMINAL_LIST_FAILED");
    }

    const terminals: RuntimeSessionTerminalProjection[] = [];
    for (const terminal of response.result.terminals) {
      if (sessionId && terminal.sessionId !== sessionId) continue;
      let record: DirectProcessSessionRecord;
      try {
        record = this.repositories.directProcessSessions.get(terminal.terminalId);
      } catch {
        continue;
      }
      if (!terminalRecord(record)) continue;
      terminals.push(this.project(record, terminal, response.supervisorGeneration));
    }
    terminals.sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt) || left.terminalId.localeCompare(right.terminalId)
    );
    return { terminals };
  }

  async start(
    context: OperationContext,
    input: RuntimeSessionTerminalStartInput
  ): Promise<RuntimeSessionTerminalProjection> {
    this.assertLocalUi(context);
    const session = this.repositories.sessions.get(input.sessionId);
    if (session.mode !== "chat-direct") {
      throw new ServiceError(
        "SESSION_TERMINAL_MODE_UNSUPPORTED",
        "Persistent session terminal is currently available only for chat-direct sessions"
      );
    }
    if (session.status === "completed" || session.status === "failed") {
      throw new ServiceError(
        "SESSION_TERMINAL_SESSION_CLOSED",
        "Development session is already terminal"
      );
    }
    const workspace = this.repositories.workspaces.getPrivate(session.workspaceId);
    if (workspace.status !== "ready") {
      throw new ServiceError(
        "SESSION_TERMINAL_WORKSPACE_UNAVAILABLE",
        "Development workspace is not ready"
      );
    }
    const lease = this.repositories.leases.getActive(workspace.id);
    const now = context.now ?? new Date().toISOString();
    if (
      !lease ||
      lease.sessionId !== session.id ||
      lease.holderType !== "chat-direct" ||
      lease.holderId !== session.id ||
      lease.expiresAt <= now
    ) {
      throw new ServiceError(
        "SESSION_TERMINAL_WRITER_LEASE_REQUIRED",
        "Persistent session terminal requires the active chat-direct writer lease"
      );
    }

    const activeRecords = this.repositories.directProcessSessions
      .list({ sessionId: session.id })
      .filter(
        (record) =>
          terminalRecord(record) &&
          (record.status === "starting" || record.status === "running")
      );
    if (activeRecords.length > 1) {
      throw new ServiceError(
        "SESSION_TERMINAL_IDENTITY_CONFLICT",
        "Development session has multiple active terminal identities"
      );
    }
    if (activeRecords.length === 1) {
      const recovered = await this.recoverExisting(activeRecords[0]!, now);
      if (recovered) return recovered;
    }

    const id = terminalId();
    const immutableStart = {
      terminalId: id,
      workspaceId: workspace.id,
      taskId: session.taskId,
      sessionId: session.id,
      writerLeaseId: lease.id,
      cwd: workspace.privatePath,
      rows: input.rows,
      cols: input.cols
    };
    const starting = this.repositories.directProcessSessions.createStarting({
      id,
      scope: "workspace",
      rootId: workspace.id,
      workdir: ".",
      command: "Interactive session shell",
      commandHash: actionHash({
        kind: "chatcockpit-native-session-terminal",
        workspaceId: workspace.id,
        sessionId: session.id
      }),
      executorId: CHATCOCKPIT_NATIVE_PTY_EXECUTOR_ID,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      sessionId: session.id,
      writerLeaseId: lease.id,
      coreWriterAuthorityId: null,
      hostAuthorityId: null,
      now
    });

    try {
      const response = await this.client.request<NativeSessionTerminalProjection>(
        "terminal.start",
        {
          ...immutableStart,
          actionId: actionId("start", input.idempotencyKey),
          actionHash: actionHash(immutableStart)
        }
      );
      const running = this.repositories.directProcessSessions.attachStarted({
        id,
        privatePid: response.result.privatePid,
        expectedRevision: starting.revision
      });
      this.repositories.directProcessRuntimeOwnership.attach({
        processId: id,
        supervisorGeneration: response.supervisorGeneration,
        now
      });
      return this.project(running, response.result, response.supervisorGeneration);
    } catch (error) {
      const cleanupImmutable = { terminalId: id };
      await this.client.request<NativeSessionTerminalProjection>(
        "terminal.stop",
        {
          ...cleanupImmutable,
          actionId: actionId("cleanup", input.idempotencyKey),
          actionHash: actionHash(cleanupImmutable)
        }
      ).catch(() => undefined);
      const current = this.repositories.directProcessSessions.get(id);
      if (current.status === "starting" || current.status === "running") {
        this.repositories.directProcessSessions.markStale({
          id,
          reason: "SESSION_TERMINAL_START_FAILED",
          expectedRevision: current.revision,
          now
        });
      }
      this.releaseRuntimeOwnership(id);
      throw this.mapSupervisorError(error, "SESSION_TERMINAL_START_FAILED");
    }
  }

  async read(
    context: OperationContext,
    input: RuntimeSessionTerminalReadInput
  ): Promise<RuntimeSessionTerminalReadResult> {
    this.assertLocalUi(context);
    const record = this.requireTerminalRecord(input.terminalId);
    try {
      const response = await this.client.request<NativeSessionTerminalReadResult>(
        "terminal.read",
        {
          terminalId: input.terminalId,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit })
        }
      );
      const synchronized = this.synchronizeTerminalRecord(
        record,
        response.result,
        response.supervisorGeneration,
        context.now
      );
      return {
        ...this.project(synchronized, response.result, response.supervisorGeneration),
        chunks: response.result.chunks,
        nextCursor: response.result.nextCursor,
        cursorTruncated: response.result.cursorTruncated
      };
    } catch (error) {
      throw this.mapSupervisorError(error, "SESSION_TERMINAL_READ_FAILED");
    }
  }

  async input(
    context: OperationContext,
    input: RuntimeSessionTerminalInputInput
  ): Promise<RuntimeSessionTerminalProjection> {
    this.assertLocalUi(context);
    const record = this.prepareControl(input);
    const immutable = {
      terminalId: record.id,
      input: input.input
    };
    try {
      const response = await this.client.request<NativeSessionTerminalProjection>(
        "terminal.input",
        {
          ...immutable,
          actionId: actionId("input", input.idempotencyKey),
          actionHash: actionHash(immutable)
        }
      );
      return this.project(record, response.result, response.supervisorGeneration);
    } catch (error) {
      throw this.mapSupervisorError(error, "SESSION_TERMINAL_INPUT_FAILED");
    }
  }

  async resize(
    context: OperationContext,
    input: RuntimeSessionTerminalResizeInput
  ): Promise<RuntimeSessionTerminalProjection> {
    this.assertLocalUi(context);
    const record = this.prepareControl(input);
    const immutable = {
      terminalId: record.id,
      rows: input.rows,
      cols: input.cols
    };
    try {
      const response = await this.client.request<NativeSessionTerminalProjection>(
        "terminal.resize",
        {
          ...immutable,
          actionId: actionId("resize", input.idempotencyKey),
          actionHash: actionHash(immutable)
        }
      );
      return this.project(record, response.result, response.supervisorGeneration);
    } catch (error) {
      throw this.mapSupervisorError(error, "SESSION_TERMINAL_RESIZE_FAILED");
    }
  }

  async stop(
    context: OperationContext,
    input: RuntimeSessionTerminalControlInput
  ): Promise<RuntimeSessionTerminalProjection> {
    this.assertLocalUi(context);
    const record = this.prepareControl(input);
    const immutable = { terminalId: record.id };
    try {
      const response = await this.client.request<NativeSessionTerminalProjection>(
        "terminal.stop",
        {
          ...immutable,
          actionId: actionId("stop", input.idempotencyKey),
          actionHash: actionHash(immutable)
        }
      );
      const completed = this.repositories.directProcessSessions.complete({
        id: record.id,
        status: "terminated",
        exitCode: response.result.exitCode,
        expectedRevision: record.revision,
        now: context.now
      });
      this.releaseRuntimeOwnership(record.id, response.supervisorGeneration);
      return this.project(completed, response.result, response.supervisorGeneration);
    } catch (error) {
      throw this.mapSupervisorError(error, "SESSION_TERMINAL_STOP_FAILED");
    }
  }

  private async recoverExisting(
    record: DirectProcessSessionRecord,
    now: string
  ): Promise<RuntimeSessionTerminalProjection | null> {
    let response: {
      supervisorGeneration: string;
      result: { terminals: NativeSessionTerminalProjection[] };
    };
    try {
      response = await this.client.request<{ terminals: NativeSessionTerminalProjection[] }>(
        "terminal.list",
        {}
      );
    } catch (error) {
      throw this.mapSupervisorError(error, "SESSION_TERMINAL_RECOVERY_FAILED");
    }
    const retained = response.result.terminals.find(
      (terminal) => terminal.terminalId === record.id
    );
    if (!retained) {
      this.repositories.directProcessSessions.markStale({
        id: record.id,
        reason: "SESSION_TERMINAL_RUNTIME_MISSING",
        expectedRevision: record.revision,
        now
      });
      this.releaseRuntimeOwnership(record.id);
      return null;
    }
    const synchronized = this.synchronizeTerminalRecord(
      record,
      retained,
      response.supervisorGeneration,
      now
    );
    if (retained.state !== "running") {
      return null;
    }
    return this.project(synchronized, retained, response.supervisorGeneration);
  }

  private synchronizeTerminalRecord(
    record: DirectProcessSessionRecord,
    terminal: NativeSessionTerminalProjection,
    supervisorGeneration: string,
    now?: string
  ): DirectProcessSessionRecord {
    let synchronized = record;
    if (record.status === "starting" && terminal.state === "running") {
      synchronized = this.repositories.directProcessSessions.attachStarted({
        id: record.id,
        privatePid: terminal.privatePid,
        expectedRevision: record.revision
      });
    } else if (
      (record.status === "starting" || record.status === "running") &&
      terminal.state !== "running"
    ) {
      synchronized = this.repositories.directProcessSessions.complete({
        id: record.id,
        status:
          terminal.state === "terminated"
            ? "terminated"
            : terminal.state === "failed"
              ? "failed"
              : "exited",
        exitCode: terminal.exitCode,
        expectedRevision: record.revision,
        now
      });
    }

    if (terminal.state === "running") {
      const ownership = this.repositories.directProcessRuntimeOwnership.get(record.id);
      if (!ownership) {
        this.repositories.directProcessRuntimeOwnership.attach({
          processId: record.id,
          supervisorGeneration,
          now
        });
      } else if (ownership.supervisorGeneration === supervisorGeneration) {
        this.repositories.directProcessRuntimeOwnership.touch({
          processId: record.id,
          supervisorGeneration,
          expectedRevision: ownership.revision,
          now
        });
      } else {
        this.repositories.directProcessRuntimeOwnership.release({
          processId: record.id,
          supervisorGeneration: ownership.supervisorGeneration,
          expectedRevision: ownership.revision
        });
        this.repositories.directProcessRuntimeOwnership.attach({
          processId: record.id,
          supervisorGeneration,
          now
        });
      }
    } else {
      this.releaseRuntimeOwnership(record.id, supervisorGeneration);
    }
    return synchronized;
  }

  private prepareControl(input: {
    terminalId: string;
    expectedRevision: number;
  }): DirectProcessSessionRecord {
    const record = this.requireTerminalRecord(input.terminalId);
    if (record.revision !== input.expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        "Session terminal revision changed before control"
      );
    }
    if (record.status !== "starting" && record.status !== "running") {
      throw new ServiceError(
        "SESSION_TERMINAL_NOT_ACTIVE",
        "Session terminal is no longer active"
      );
    }
    return record;
  }

  private requireTerminalRecord(terminalIdValue: string): DirectProcessSessionRecord {
    const record = this.repositories.directProcessSessions.get(terminalIdValue);
    if (!terminalRecord(record)) {
      throw new ServiceError(
        "SESSION_TERMINAL_UNSUPPORTED",
        "Runtime identity is not a ChatCockpit native session terminal"
      );
    }
    return record;
  }

  private releaseRuntimeOwnership(
    processId: string,
    expectedGeneration?: string
  ): void {
    const ownership = this.repositories.directProcessRuntimeOwnership.get(processId);
    if (!ownership) return;
    if (expectedGeneration && ownership.supervisorGeneration !== expectedGeneration) return;
    this.repositories.directProcessRuntimeOwnership.release({
      processId,
      supervisorGeneration: ownership.supervisorGeneration,
      expectedRevision: ownership.revision
    });
  }

  private project(
    record: DirectProcessSessionRecord,
    terminal: NativeSessionTerminalProjection,
    supervisorGeneration: string
  ): RuntimeSessionTerminalProjection {
    return {
      terminalId: record.id,
      processRevision: record.revision,
      sessionId: record.sessionId ?? terminal.sessionId,
      workspaceId: record.workspaceId ?? terminal.workspaceId,
      repoId: record.repoId,
      state: terminal.state,
      exitCode: terminal.exitCode,
      rows: terminal.rows,
      cols: terminal.cols,
      privatePid: terminal.privatePid,
      startedAt: terminal.startedAt,
      earliestSequence: terminal.earliestSequence,
      nextSequence: terminal.nextSequence,
      scrollbackBytes: terminal.scrollbackBytes,
      scrollbackTruncated: terminal.scrollbackTruncated,
      supervisorGeneration
    };
  }

  private assertLocalUi(context: OperationContext): void {
    if (context.actorType !== "local-ui") {
      throw new ServiceError(
        "SESSION_TERMINAL_CONTROL_FORBIDDEN",
        "Persistent session terminal requires the local Operator control plane"
      );
    }
  }

  private mapSupervisorError(error: unknown, fallbackCode: string): ServiceError {
    if (error instanceof ServiceError) return error;
    if (error instanceof ProcessSupervisorClientError) {
      return new ServiceError(error.code, "Persistent session terminal operation failed");
    }
    return new ServiceError(fallbackCode, "Persistent session terminal operation failed");
  }
}
