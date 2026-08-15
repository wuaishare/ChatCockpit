import { z } from "zod";

import {
  DesktopCommanderManagedProcessError,
  type ManagedProcessAdapterSnapshot,
  type ManagedProcessInputOptions,
  type ManagedProcessReadOptions,
  type ManagedProcessStartRequest
} from "../direct/adapters/desktop-commander-managed-process.js";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../direct/adapters/desktop-commander.js";
import type { ProcessSupervisorMethod } from "./protocol.js";
import type {
  SupervisorTerminalEvent,
  SupervisorTerminalEventKind
} from "./event-journal.js";

const MAX_ACTION_RECEIPTS = 512;
const MAX_TRANSIENT_INPUT_BYTES = 8 * 1024;

const processIdSchema = z.string().regex(/^host_process_[A-Za-z0-9_-]+$/);
const actionIdSchema = z.string().min(1).max(200);
const actionHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const startSchema = z.object({
  processId: processIdSchema,
  workspaceId: z.string().min(1).max(200),
  taskId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  writerLeaseId: z.string().min(1).max(200),
  executorId: z.string().min(1).max(200),
  actionId: actionIdSchema,
  actionHash: actionHashSchema,
  cwd: z.string().min(1).max(4096),
  command: z.string().min(1).max(1000),
  args: z.array(z.string().max(4096)).max(128),
  startupTimeoutMs: z.number().int().positive().max(120_000)
});

const readSchema = z.object({
  processId: processIdSchema,
  offset: z.number().int().nonnegative().optional(),
  length: z.number().int().positive().max(10_000).optional(),
  waitMs: z.number().int().nonnegative().max(120_000).optional()
});

const inputSchema = z
  .object({
    processId: processIdSchema,
    actionId: actionIdSchema,
    actionHash: actionHashSchema,
    input: z.string(),
    timeoutMs: z.number().int().positive().max(120_000),
    waitForPrompt: z.boolean()
  })
  .superRefine((value, context) => {
    if (Buffer.byteLength(value.input, "utf8") > MAX_TRANSIENT_INPUT_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input"],
        message: "Managed process input exceeds the bounded transient input size"
      });
    }
  });

const stopSchema = z.object({
  processId: processIdSchema,
  actionId: actionIdSchema,
  actionHash: actionHashSchema
});

const eventAckSchema = z.object({
  eventIds: z.array(z.string().min(1).max(200)).max(1000)
});

export class ProcessSupervisorRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProcessSupervisorRuntimeError";
  }
}

export interface ProcessSupervisorManagedAdapter {
  assertReady(): unknown;
  has(processId: string): boolean;
  activeProcessIds(): string[];
  start(request: ManagedProcessStartRequest): Promise<ManagedProcessAdapterSnapshot>;
  observe(
    processId: string,
    options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot>;
  read(
    processId: string,
    options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot>;
  input(
    processId: string,
    options: ManagedProcessInputOptions
  ): Promise<ManagedProcessAdapterSnapshot>;
  stop(processId: string): Promise<ManagedProcessAdapterSnapshot>;
  close(processId: string): Promise<void>;
  closeAll(): Promise<ManagedProcessAdapterSnapshot[]>;
}

export interface ProcessSupervisorAuthorityReader {
  check(
    process: SupervisorOwnedProcess,
    now?: string
  ): { valid: true; reasonCode: null } | { valid: false; reasonCode: string };
}

export interface ProcessSupervisorEventStore {
  append(
    input: Omit<SupervisorTerminalEvent, "eventId"> & { eventId?: string }
  ): SupervisorTerminalEvent;
  list(): SupervisorTerminalEvent[];
  ack(eventIds: string[]): number;
}

export interface SupervisorOwnedProcess {
  processId: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  writerLeaseId: string;
  executorId: string;
  startActionId: string;
  startActionHash: string;
  startedAt: string;
}

export interface SupervisorProcessMutationResult {
  processId: string;
  status: ManagedProcessAdapterSnapshot["status"];
  exitCode: number | null;
  truncated: boolean;
}

export interface SupervisorProcessReadResult extends SupervisorProcessMutationResult {
  output: string;
}

export interface SupervisorActionReceipt {
  actionId: string;
  processId: string;
  kind: "start" | "input" | "stop";
  actionHash: string;
  status: "applied" | "failed" | "unknown";
  errorCode: string | null;
  createdAt: string;
  result: SupervisorProcessMutationResult | null;
}

function safeMutationResult(
  snapshot: ManagedProcessAdapterSnapshot
): SupervisorProcessMutationResult {
  return {
    processId: snapshot.processId,
    status: snapshot.status,
    exitCode: snapshot.exitCode,
    truncated: snapshot.truncated
  };
}

function safeReadResult(
  snapshot: ManagedProcessAdapterSnapshot
): SupervisorProcessReadResult {
  return {
    ...safeMutationResult(snapshot),
    output: snapshot.output
  };
}

function mapAdapterError(error: unknown): ProcessSupervisorRuntimeError {
  if (error instanceof ProcessSupervisorRuntimeError) {
    return error;
  }
  if (error instanceof DesktopCommanderManagedProcessError) {
    return new ProcessSupervisorRuntimeError(error.code, error.message);
  }
  return new ProcessSupervisorRuntimeError(
    "SUPERVISOR_RUNTIME_FAILED",
    "Managed process runtime operation failed"
  );
}

export class ProcessSupervisorRuntimeService {
  private readonly owned = new Map<string, SupervisorOwnedProcess>();
  private readonly receipts = new Map<string, SupervisorActionReceipt>();
  private readonly activeProcessActions = new Map<string, number>();
  private readonly now: () => string;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      generation: string;
      adapter: ProcessSupervisorManagedAdapter;
      authorityReader?: ProcessSupervisorAuthorityReader;
      eventJournal?: ProcessSupervisorEventStore;
      now?: () => string;
    }
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  generation(): string {
    return this.options.generation;
  }

  listOwned(): SupervisorOwnedProcess[] {
    return [...this.owned.values()].map((entry) => ({ ...entry }));
  }

  snapshotActionReceipts(): SupervisorActionReceipt[] {
    return [...this.receipts.values()].map((receipt) => ({
      ...receipt,
      result: receipt.result ? { ...receipt.result } : null
    }));
  }

  startWatchdog(intervalMs = 15_000): void {
    if (this.watchdogTimer) {
      return;
    }
    this.watchdogTimer = setInterval(() => {
      void this.reconcileAuthorityOnce();
    }, intervalMs);
    this.watchdogTimer.unref();
  }

  stopWatchdog(): void {
    if (!this.watchdogTimer) {
      return;
    }
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  async reconcileAuthorityOnce(now = this.now()): Promise<void> {
    const authorityReader = this.options.authorityReader;
    if (!authorityReader) {
      return;
    }
    for (const process of this.listOwned()) {
      if ((this.activeProcessActions.get(process.processId) ?? 0) > 0) {
        continue;
      }
      const authority = authorityReader.check(process, now);
      if (!authority.valid) {
        if (!this.options.adapter.has(process.processId)) {
          this.owned.delete(process.processId);
          this.appendEvent({
            processId: process.processId,
            kind: "runtime-failure",
            status: "unknown",
            exitCode: null,
            reasonCode: "RUNTIME_UNAVAILABLE",
            occurredAt: now
          });
          continue;
        }
        try {
          await this.options.adapter.close(process.processId);
          this.owned.delete(process.processId);
          this.appendEvent({
            processId: process.processId,
            kind: "lease-revoked",
            status: "unknown",
            exitCode: null,
            reasonCode: authority.reasonCode,
            occurredAt: now
          });
        } catch {
          this.appendEvent({
            processId: process.processId,
            kind: "runtime-failure",
            status: "unknown",
            exitCode: null,
            reasonCode: `${authority.reasonCode}_CONTAINMENT_FAILED`,
            occurredAt: now
          });
        }
        continue;
      }

      if (!this.options.adapter.has(process.processId)) {
        this.owned.delete(process.processId);
        this.appendEvent({
          processId: process.processId,
          kind: "runtime-failure",
          status: "unknown",
          exitCode: null,
          reasonCode: "RUNTIME_UNAVAILABLE",
          occurredAt: now
        });
        continue;
      }

      try {
        const observed = await this.options.adapter.observe(process.processId, {
          waitMs: 50
        });
        if (observed.status !== "running") {
          this.owned.delete(process.processId);
          this.appendTerminalSnapshot(observed, "natural-exit", "PROCESS_EXITED", now);
        }
      } catch {
        // A transient read failure must not consume pending output or silently revoke ownership.
        // The next watchdog cycle will retry; explicit authority loss still terminates immediately.
      }
    }
  }

  async start(params: unknown): Promise<SupervisorProcessMutationResult> {
    const request = this.parse(startSchema, params, "start");
    if (request.executorId !== DESKTOP_COMMANDER_EXECUTOR_ID) {
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_EXECUTOR_UNSUPPORTED",
        "Managed process executor is not supported by this Process Supervisor"
      );
    }
    const replay = this.resolveReplay(
      request.actionId,
      request.actionHash,
      request.processId,
      "start"
    );
    if (replay) {
      return replay;
    }
    if (this.owned.has(request.processId) || this.options.adapter.has(request.processId)) {
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_PROCESS_CONFLICT",
        "Managed process id is already owned by this Process Supervisor"
      );
    }

    this.options.adapter.assertReady();
    try {
      const snapshot = await this.options.adapter.start({
        processId: request.processId,
        cwd: request.cwd,
        command: request.command,
        args: request.args,
        startupTimeoutMs: request.startupTimeoutMs
      });
      const result = safeMutationResult(snapshot);
      if (snapshot.status === "running") {
        this.owned.set(request.processId, {
          processId: request.processId,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          sessionId: request.sessionId,
          writerLeaseId: request.writerLeaseId,
          executorId: request.executorId,
          startActionId: request.actionId,
          startActionHash: request.actionHash,
          startedAt: this.now()
        });
      } else {
        this.appendTerminalSnapshot(
          snapshot,
          "natural-exit",
          "PROCESS_EXITED_DURING_START",
          this.now()
        );
      }
      this.storeReceipt({
        actionId: request.actionId,
        processId: request.processId,
        kind: "start",
        actionHash: request.actionHash,
        status: snapshot.status === "unknown" ? "unknown" : "applied",
        errorCode: null,
        createdAt: this.now(),
        result
      });
      return result;
    } catch (error) {
      const mapped = mapAdapterError(error);
      this.storeReceipt({
        actionId: request.actionId,
        processId: request.processId,
        kind: "start",
        actionHash: request.actionHash,
        status: "failed",
        errorCode: mapped.code,
        createdAt: this.now(),
        result: null
      });
      throw mapped;
    }
  }

  async read(params: unknown): Promise<SupervisorProcessReadResult> {
    const request = this.parse(readSchema, params, "read");
    this.requireOwned(request.processId);
    if (!this.options.adapter.has(request.processId)) {
      this.owned.delete(request.processId);
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_PROCESS_NOT_FOUND",
        "Managed process runtime is no longer owned by this Process Supervisor"
      );
    }
    try {
      const snapshot = await this.withActiveProcessAction(request.processId, () =>
        this.options.adapter.read(request.processId, {
          ...(request.offset === undefined ? {} : { offset: request.offset }),
          ...(request.length === undefined ? {} : { length: request.length }),
          ...(request.waitMs === undefined ? {} : { waitMs: request.waitMs })
        })
      );
      if (snapshot.status !== "running") {
        this.owned.delete(request.processId);
        this.appendTerminalSnapshot(
          snapshot,
          "natural-exit",
          "PROCESS_EXITED",
          this.now()
        );
      }
      return safeReadResult(snapshot);
    } catch (error) {
      throw mapAdapterError(error);
    }
  }

  async input(params: unknown): Promise<SupervisorProcessMutationResult> {
    const request = this.parse(inputSchema, params, "input");
    this.requireOwned(request.processId);
    const replay = this.resolveReplay(
      request.actionId,
      request.actionHash,
      request.processId,
      "input"
    );
    if (replay) {
      return replay;
    }
    if (!this.options.adapter.has(request.processId)) {
      this.owned.delete(request.processId);
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_PROCESS_NOT_FOUND",
        "Managed process runtime is no longer owned by this Process Supervisor"
      );
    }
    try {
      const snapshot = await this.withActiveProcessAction(request.processId, () =>
        this.options.adapter.input(request.processId, {
          input: request.input,
          timeoutMs: request.timeoutMs,
          waitForPrompt: request.waitForPrompt
        })
      );
      const result = safeMutationResult(snapshot);
      if (snapshot.status !== "running") {
        this.owned.delete(request.processId);
        this.appendTerminalSnapshot(
          snapshot,
          "natural-exit",
          "PROCESS_EXITED_AFTER_INPUT",
          this.now()
        );
      }
      this.storeReceipt({
        actionId: request.actionId,
        processId: request.processId,
        kind: "input",
        actionHash: request.actionHash,
        status: snapshot.status === "unknown" ? "unknown" : "applied",
        errorCode: null,
        createdAt: this.now(),
        result
      });
      return result;
    } catch (error) {
      const mapped = mapAdapterError(error);
      this.storeReceipt({
        actionId: request.actionId,
        processId: request.processId,
        kind: "input",
        actionHash: request.actionHash,
        status: "failed",
        errorCode: mapped.code,
        createdAt: this.now(),
        result: null
      });
      throw mapped;
    }
  }

  async stop(params: unknown): Promise<SupervisorProcessMutationResult> {
    const request = this.parse(stopSchema, params, "stop");
    const replay = this.resolveReplay(
      request.actionId,
      request.actionHash,
      request.processId,
      "stop"
    );
    if (replay) {
      return replay;
    }
    this.requireOwned(request.processId);
    if (!this.options.adapter.has(request.processId)) {
      this.owned.delete(request.processId);
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_PROCESS_NOT_FOUND",
        "Managed process runtime is no longer owned by this Process Supervisor"
      );
    }
    try {
      const snapshot = await this.withActiveProcessAction(
        request.processId,
        () => this.options.adapter.stop(request.processId)
      );
      this.owned.delete(request.processId);
      const result = safeMutationResult(snapshot);
      this.appendTerminalSnapshot(
        snapshot,
        "explicit-stop",
        "EXPLICIT_STOP",
        this.now()
      );
      this.storeReceipt({
        actionId: request.actionId,
        processId: request.processId,
        kind: "stop",
        actionHash: request.actionHash,
        status: snapshot.status === "unknown" ? "unknown" : "applied",
        errorCode: null,
        createdAt: this.now(),
        result
      });
      return result;
    } catch (error) {
      const mapped = mapAdapterError(error);
      this.storeReceipt({
        actionId: request.actionId,
        processId: request.processId,
        kind: "stop",
        actionHash: request.actionHash,
        status: "failed",
        errorCode: mapped.code,
        createdAt: this.now(),
        result: null
      });
      throw mapped;
    }
  }

  private async withActiveProcessAction<T>(
    processId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    this.activeProcessActions.set(
      processId,
      (this.activeProcessActions.get(processId) ?? 0) + 1
    );
    try {
      return await operation();
    } finally {
      const remaining = (this.activeProcessActions.get(processId) ?? 1) - 1;
      if (remaining <= 0) {
        this.activeProcessActions.delete(processId);
      } else {
        this.activeProcessActions.set(processId, remaining);
      }
    }
  }

  async closeAll(): Promise<SupervisorProcessMutationResult[]> {
    this.stopWatchdog();
    const snapshots = await this.options.adapter.closeAll();
    this.owned.clear();
    return snapshots.map(safeMutationResult);
  }

  async handle(method: ProcessSupervisorMethod, params: unknown): Promise<unknown> {
    switch (method) {
      case "health":
        return {
          state: "ready",
          protocolVersion: 1,
          ownedProcessCount: this.owned.size
        };
      case "owned.list":
        return { processes: this.listOwned() };
      case "process.start":
        return await this.start(params);
      case "process.read":
        return await this.read(params);
      case "process.input":
        return await this.input(params);
      case "process.stop":
        return await this.stop(params);
      case "events.list":
        return { events: this.options.eventJournal?.list() ?? [] };
      case "events.ack": {
        const request = this.parse(eventAckSchema, params, "events.ack");
        return {
          acknowledged: this.options.eventJournal?.ack(request.eventIds) ?? 0
        };
      }
    }
  }

  private appendTerminalSnapshot(
    snapshot: ManagedProcessAdapterSnapshot,
    kind: SupervisorTerminalEventKind,
    reasonCode: string,
    occurredAt: string
  ): void {
    if (snapshot.status === "running") {
      return;
    }
    this.appendEvent({
      processId: snapshot.processId,
      kind,
      status:
        snapshot.status === "exited"
          ? "exited"
          : snapshot.status === "terminated"
            ? "terminated"
            : "unknown",
      exitCode: snapshot.exitCode,
      reasonCode,
      occurredAt
    });
  }

  private appendEvent(input: {
    processId: string;
    kind: SupervisorTerminalEventKind;
    status: "exited" | "terminated" | "failed" | "unknown";
    exitCode: number | null;
    reasonCode: string;
    occurredAt: string;
  }): void {
    this.options.eventJournal?.append({
      supervisorGeneration: this.options.generation,
      ...input
    });
  }

  private requireOwned(processId: string): SupervisorOwnedProcess {
    const owned = this.owned.get(processId);
    if (!owned) {
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_PROCESS_NOT_FOUND",
        "Managed process is not owned by this Process Supervisor"
      );
    }
    return owned;
  }

  private resolveReplay(
    actionId: string,
    actionHash: string,
    processId: string,
    kind: SupervisorActionReceipt["kind"]
  ): SupervisorProcessMutationResult | null {
    const existing = this.receipts.get(actionId);
    if (!existing) {
      return null;
    }
    if (
      existing.actionHash !== actionHash ||
      existing.processId !== processId ||
      existing.kind !== kind
    ) {
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_ACTION_CONFLICT",
        "Process Supervisor action id was replayed with different intent"
      );
    }
    if (existing.result) {
      return { ...existing.result };
    }
    throw new ProcessSupervisorRuntimeError(
      existing.errorCode ?? "SUPERVISOR_ACTION_FAILED",
      "Process Supervisor action already reached a terminal failure"
    );
  }

  private storeReceipt(receipt: SupervisorActionReceipt): void {
    this.receipts.set(receipt.actionId, receipt);
    while (this.receipts.size > MAX_ACTION_RECEIPTS) {
      const oldest = this.receipts.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.receipts.delete(oldest);
    }
  }

  private parse<T extends z.ZodTypeAny>(
    schema: T,
    params: unknown,
    operation: string
  ): z.infer<T> {
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      throw new ProcessSupervisorRuntimeError(
        "SUPERVISOR_BAD_REQUEST",
        `Managed process ${operation} request failed validation`
      );
    }
    return parsed.data;
  }
}
