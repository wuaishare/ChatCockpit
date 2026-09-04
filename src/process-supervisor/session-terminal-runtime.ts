import { createHash } from "node:crypto";

import { z } from "zod";

import type { ProcessSupervisorMethod } from "./protocol.js";
import {
  CHATCOCKPIT_NATIVE_PTY_EXECUTOR_ID,
  NativeSessionTerminalSupervisor,
  type NativeSessionTerminalProjection,
  type NativeSessionTerminalReadResult
} from "./native-session-terminal.js";
import {
  ProcessSupervisorRuntimeError,
  type ProcessSupervisorAuthorityReader,
  type ProcessSupervisorEventStore,
  type SupervisorWorkspaceOwnedProcess
} from "./service.js";

const MAX_ACTION_RECEIPTS = 512;
const terminalIdSchema = z.string().regex(/^session_terminal_[A-Za-z0-9_-]{1,160}$/);
const actionIdSchema = z.string().min(1).max(200);
const actionHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const startSchema = z.object({
  terminalId: terminalIdSchema,
  workspaceId: z.string().min(1).max(200),
  taskId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  writerLeaseId: z.string().min(1).max(200),
  cwd: z.string().min(1).max(4096),
  rows: z.number().int().min(1).max(500),
  cols: z.number().int().min(1).max(1_000),
  actionId: actionIdSchema,
  actionHash: actionHashSchema
});

const terminalReadSchema = z.object({
  terminalId: terminalIdSchema,
  cursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(200).optional()
});

const inputSchema = z.object({
  terminalId: terminalIdSchema,
  input: z.string().max(32_768),
  actionId: actionIdSchema,
  actionHash: actionHashSchema
});

const resizeSchema = z.object({
  terminalId: terminalIdSchema,
  rows: z.number().int().min(1).max(500),
  cols: z.number().int().min(1).max(1_000),
  actionId: actionIdSchema,
  actionHash: actionHashSchema
});

const stopSchema = z.object({
  terminalId: terminalIdSchema,
  actionId: actionIdSchema,
  actionHash: actionHashSchema
});

export const SESSION_TERMINAL_SUPERVISOR_METHODS = [
  "terminal.list",
  "terminal.start",
  "terminal.read",
  "terminal.input",
  "terminal.resize",
  "terminal.stop"
] as const satisfies readonly ProcessSupervisorMethod[];

export type SessionTerminalSupervisorMethod =
  (typeof SESSION_TERMINAL_SUPERVISOR_METHODS)[number];

export function isSessionTerminalSupervisorMethod(
  method: ProcessSupervisorMethod
): method is SessionTerminalSupervisorMethod {
  return (SESSION_TERMINAL_SUPERVISOR_METHODS as readonly string[]).includes(method);
}

export interface SessionTerminalActionReceipt {
  actionId: string;
  terminalId: string;
  kind: "start" | "input" | "resize" | "stop";
  actionHash: string;
  projection: NativeSessionTerminalProjection;
  createdAt: string;
}

export interface ProcessSupervisorSessionTerminalRuntimeOptions {
  generation: string;
  terminals?: NativeSessionTerminalSupervisor;
  authorityReader: ProcessSupervisorAuthorityReader;
  eventJournal?: ProcessSupervisorEventStore;
  now?: () => string;
}

function terminalOwnedProcess(
  input: {
    terminalId: string;
    workspaceId: string;
    taskId: string;
    sessionId: string;
    writerLeaseId: string;
    actionId: string;
    actionHash: string;
    startedAt: string;
  }
): SupervisorWorkspaceOwnedProcess {
  return {
    scope: "workspace",
    processId: input.terminalId,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    writerLeaseId: input.writerLeaseId,
    executorId: CHATCOCKPIT_NATIVE_PTY_EXECUTOR_ID,
    startActionId: input.actionId,
    startActionHash: input.actionHash,
    startedAt: input.startedAt
  };
}

function terminalReasonHash(reasonCode: string): string {
  return createHash("sha256").update(reasonCode).digest("hex").slice(0, 16);
}

export class ProcessSupervisorSessionTerminalRuntime {
  private readonly terminals: NativeSessionTerminalSupervisor;
  private readonly owned = new Map<string, SupervisorWorkspaceOwnedProcess>();
  private readonly receipts = new Map<string, SessionTerminalActionReceipt>();
  private readonly now: () => string;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ProcessSupervisorSessionTerminalRuntimeOptions) {
    this.terminals = options.terminals ?? new NativeSessionTerminalSupervisor();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  listOwned(): SupervisorWorkspaceOwnedProcess[] {
    return [...this.owned.values()].map((entry) => ({ ...entry }));
  }

  listTerminals(): NativeSessionTerminalProjection[] {
    return this.terminals.list();
  }

  startWatchdog(intervalMs = 15_000): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      void this.reconcileAuthorityOnce();
    }, intervalMs);
    this.watchdogTimer.unref();
  }

  stopWatchdog(): void {
    if (!this.watchdogTimer) return;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  async reconcileAuthorityOnce(now = this.now()): Promise<void> {
    for (const owned of this.listOwned()) {
      let projection: NativeSessionTerminalProjection;
      try {
        projection = this.terminals.get(owned.processId);
      } catch {
        this.owned.delete(owned.processId);
        this.appendEvent(
          owned.processId,
          "runtime-failure",
          "unknown",
          null,
          "TERMINAL_RUNTIME_MISSING",
          now
        );
        continue;
      }
      if (projection.state !== "running") {
        this.owned.delete(owned.processId);
        this.appendEvent(
          owned.processId,
          projection.state === "failed"
            ? "runtime-failure"
            : projection.state === "terminated"
              ? "explicit-stop"
              : "natural-exit",
          projection.state === "failed"
            ? "failed"
            : projection.state === "terminated"
              ? "terminated"
              : "exited",
          projection.exitCode,
          projection.state === "failed"
            ? "TERMINAL_FAILED"
            : projection.state === "terminated"
              ? "TERMINAL_STOPPED"
              : "TERMINAL_EXITED",
          now
        );
        continue;
      }
      const authority = this.options.authorityReader.check(owned, now);
      if (!authority.valid) {
        this.terminals.stop(owned.processId);
        this.owned.delete(owned.processId);
        this.appendEvent(
          owned.processId,
          "lease-revoked",
          "terminated",
          null,
          `TERMINAL_AUTHORITY_${terminalReasonHash(authority.reasonCode)}`,
          now
        );
      }
    }
  }

  start(params: unknown): NativeSessionTerminalProjection {
    const request = this.parse(startSchema, params, "terminal.start");
    const replay = this.resolveReplay(
      request.actionId,
      request.actionHash,
      request.terminalId,
      "start"
    );
    if (replay) return replay;
    if (this.owned.has(request.terminalId) || this.terminals.has(request.terminalId)) {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_CONFLICT",
        "Session terminal id is already retained by this Process Supervisor generation"
      );
    }
    const startedAt = this.now();
    for (const owned of this.listOwned()) {
      let retained: NativeSessionTerminalProjection;
      try {
        retained = this.terminals.get(owned.processId);
      } catch {
        this.owned.delete(owned.processId);
        this.appendEvent(
          owned.processId,
          "runtime-failure",
          "unknown",
          null,
          "TERMINAL_RUNTIME_MISSING",
          startedAt
        );
        continue;
      }
      if (retained.state === "running") {
        if (owned.sessionId === request.sessionId) {
          throw new ProcessSupervisorRuntimeError(
            "SESSION_TERMINAL_CONFLICT",
            "Development session already owns a retained terminal"
          );
        }
        continue;
      }
      this.owned.delete(owned.processId);
      this.appendEvent(
        owned.processId,
        retained.state === "failed"
          ? "runtime-failure"
          : retained.state === "terminated"
            ? "explicit-stop"
            : "natural-exit",
        retained.state === "failed"
          ? "failed"
          : retained.state === "terminated"
            ? "terminated"
            : "exited",
        retained.exitCode,
        retained.state === "failed"
          ? "TERMINAL_FAILED"
          : retained.state === "terminated"
            ? "TERMINAL_STOPPED"
            : "TERMINAL_EXITED",
        startedAt
      );
    }
    const owned = terminalOwnedProcess({ ...request, startedAt });
    this.assertWriterAuthority(owned, startedAt);
    let projection: NativeSessionTerminalProjection;
    try {
      projection = this.terminals.start({
        terminalId: request.terminalId,
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        sessionId: request.sessionId,
        writerLeaseId: request.writerLeaseId,
        cwd: request.cwd,
        rows: request.rows,
        cols: request.cols,
        now: startedAt
      });
    } catch {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_START_FAILED",
        "Native session terminal could not be started"
      );
    }
    this.owned.set(request.terminalId, owned);
    this.storeReceipt({
      actionId: request.actionId,
      terminalId: request.terminalId,
      kind: "start",
      actionHash: request.actionHash,
      projection,
      createdAt: startedAt
    });
    return projection;
  }

  read(params: unknown): NativeSessionTerminalReadResult {
    const request = this.parse(terminalReadSchema, params, "terminal.read");
    try {
      return this.terminals.read(request.terminalId, request.cursor, request.limit);
    } catch {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_NOT_FOUND",
        "Session terminal is outside this Process Supervisor retention window"
      );
    }
  }

  input(params: unknown): NativeSessionTerminalProjection {
    const request = this.parse(inputSchema, params, "terminal.input");
    const replay = this.resolveReplay(
      request.actionId,
      request.actionHash,
      request.terminalId,
      "input"
    );
    if (replay) return replay;
    const owned = this.requireOwned(request.terminalId);
    this.assertWriterAuthority(owned, this.now());
    let projection: NativeSessionTerminalProjection;
    try {
      projection = this.terminals.input(request.terminalId, request.input);
    } catch {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_INPUT_FAILED",
        "Session terminal input could not be applied"
      );
    }
    this.storeReceipt({
      actionId: request.actionId,
      terminalId: request.terminalId,
      kind: "input",
      actionHash: request.actionHash,
      projection,
      createdAt: this.now()
    });
    return projection;
  }

  resize(params: unknown): NativeSessionTerminalProjection {
    const request = this.parse(resizeSchema, params, "terminal.resize");
    const replay = this.resolveReplay(
      request.actionId,
      request.actionHash,
      request.terminalId,
      "resize"
    );
    if (replay) return replay;
    const owned = this.requireOwned(request.terminalId);
    this.assertWriterAuthority(owned, this.now());
    let projection: NativeSessionTerminalProjection;
    try {
      projection = this.terminals.resize(request.terminalId, request.rows, request.cols);
    } catch {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_RESIZE_FAILED",
        "Session terminal size could not be applied"
      );
    }
    this.storeReceipt({
      actionId: request.actionId,
      terminalId: request.terminalId,
      kind: "resize",
      actionHash: request.actionHash,
      projection,
      createdAt: this.now()
    });
    return projection;
  }

  stop(params: unknown): NativeSessionTerminalProjection {
    const request = this.parse(stopSchema, params, "terminal.stop");
    const replay = this.resolveReplay(
      request.actionId,
      request.actionHash,
      request.terminalId,
      "stop"
    );
    if (replay) return replay;
    this.requireOwned(request.terminalId);
    let projection: NativeSessionTerminalProjection;
    try {
      projection = this.terminals.stop(request.terminalId);
    } catch {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_STOP_FAILED",
        "Session terminal stop could not be requested"
      );
    }
    this.owned.delete(request.terminalId);
    this.appendEvent(
      request.terminalId,
      "explicit-stop",
      "terminated",
      projection.exitCode,
      "TERMINAL_STOP_REQUESTED",
      this.now()
    );
    this.storeReceipt({
      actionId: request.actionId,
      terminalId: request.terminalId,
      kind: "stop",
      actionHash: request.actionHash,
      projection,
      createdAt: this.now()
    });
    return projection;
  }

  closeAll(): void {
    this.stopWatchdog();
    for (const owned of this.listOwned()) {
      try {
        this.terminals.stop(owned.processId);
      } catch {
        // Best effort during supervisor shutdown.
      }
    }
    this.owned.clear();
    this.terminals.disposeAll();
  }

  handle(method: SessionTerminalSupervisorMethod, params: unknown): unknown {
    switch (method) {
      case "terminal.list":
        return { terminals: this.listTerminals() };
      case "terminal.start":
        return this.start(params);
      case "terminal.read":
        return this.read(params);
      case "terminal.input":
        return this.input(params);
      case "terminal.resize":
        return this.resize(params);
      case "terminal.stop":
        return this.stop(params);
    }
  }

  private assertWriterAuthority(owned: SupervisorWorkspaceOwnedProcess, now: string): void {
    const authority = this.options.authorityReader.check(owned, now);
    if (!authority.valid) {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_WRITER_AUTHORITY_REQUIRED",
        "Session terminal input requires the original active development-session writer authority"
      );
    }
  }

  private requireOwned(terminalId: string): SupervisorWorkspaceOwnedProcess {
    const owned = this.owned.get(terminalId);
    if (!owned) {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_NOT_FOUND",
        "Session terminal is not owned by this Process Supervisor generation"
      );
    }
    return owned;
  }

  private resolveReplay(
    actionId: string,
    actionHash: string,
    terminalId: string,
    kind: SessionTerminalActionReceipt["kind"]
  ): NativeSessionTerminalProjection | null {
    const receipt = this.receipts.get(actionId);
    if (!receipt) return null;
    if (
      receipt.actionHash !== actionHash ||
      receipt.terminalId !== terminalId ||
      receipt.kind !== kind
    ) {
      throw new ProcessSupervisorRuntimeError(
        "SESSION_TERMINAL_ACTION_CONFLICT",
        "Session terminal action id was already used with different immutable input"
      );
    }
    return { ...receipt.projection };
  }

  private storeReceipt(receipt: SessionTerminalActionReceipt): void {
    this.receipts.set(receipt.actionId, {
      ...receipt,
      projection: { ...receipt.projection }
    });
    while (this.receipts.size > MAX_ACTION_RECEIPTS) {
      const oldest = this.receipts.keys().next().value as string | undefined;
      if (!oldest) break;
      this.receipts.delete(oldest);
    }
  }

  private appendEvent(
    processId: string,
    kind: "natural-exit" | "lease-revoked" | "runtime-failure" | "explicit-stop",
    status: "exited" | "terminated" | "failed" | "unknown",
    exitCode: number | null,
    reasonCode: string,
    occurredAt: string
  ): void {
    this.options.eventJournal?.append({
      supervisorGeneration: this.options.generation,
      processId,
      kind,
      status,
      exitCode,
      reasonCode,
      occurredAt
    });
  }

  private parse<T>(schema: z.ZodType<T>, params: unknown, operation: string): T {
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_BAD_REQUEST",
        `Process Supervisor ${operation} request failed validation`
      );
    }
    return parsed.data;
  }
}
