import fs from "node:fs";

import type {
  ManagedProcessAdapterStatus,
  ManagedProcessInputOptions,
  ManagedProcessReadOptions,
  ManagedProcessStartRequest
} from "../direct/adapters/desktop-commander-managed-process.js";
import { DesktopCommanderManagedProcessError } from "../direct/adapters/desktop-commander-managed-process.js";
import type { TokenPilotPaths } from "../types.js";
import {
  ProcessSupervisorClient,
  ProcessSupervisorClientError
} from "../process-supervisor/client.js";
import type {
  SupervisorOwnedProcess,
  SupervisorProcessMutationResult,
  SupervisorProcessReadResult
} from "../process-supervisor/service.js";
import type { SupervisorTerminalEvent } from "../process-supervisor/event-journal.js";

export interface DurableHostProcessRuntimeSnapshot {
  processId: string;
  status: ManagedProcessAdapterStatus;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  supervisorGeneration: string;
}

export interface DurableHostProcessStartRequest extends ManagedProcessStartRequest {
  workspaceId: string;
  taskId: string;
  sessionId: string;
  writerLeaseId: string;
  executorId: string;
  actionId: string;
  actionHash: string;
}

export interface DurableHostProcessActionOptions {
  actionId: string;
  actionHash: string;
}

export interface DurableHostProcessRefresh {
  supervisorGeneration: string;
  owned: SupervisorOwnedProcess[];
}

function mapClientError(error: unknown): never {
  if (error instanceof ProcessSupervisorClientError) {
    if (
      error.code === "SUPERVISOR_UNAVAILABLE" ||
      error.code === "SUPERVISOR_TIMEOUT" ||
      error.code === "SUPERVISOR_CONNECTION_CLOSED" ||
      error.code === "SUPERVISOR_AUTH_FAILED" ||
      error.code === "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE"
    ) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE",
        "Durable Process Supervisor is unavailable"
      );
    }
    if (
      error.code === "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID" ||
      error.code === "SUPERVISOR_EXECUTOR_UNSUPPORTED" ||
      error.code === "SUPERVISOR_BAD_REQUEST"
    ) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID",
        "Durable managed process request was rejected"
      );
    }
    if (
      error.code === "DESKTOP_COMMANDER_MANAGED_PROCESS_NOT_FOUND" ||
      error.code.includes("NOT_FOUND")
    ) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_NOT_FOUND",
        "Durable managed process runtime was not found"
      );
    }
    if (error.code === "DESKTOP_COMMANDER_MANAGED_PROCESS_TERMINATION_FAILED") {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_TERMINATION_FAILED",
        "Durable managed process termination could not be confirmed"
      );
    }
    throw new DesktopCommanderManagedProcessError(
      "DESKTOP_COMMANDER_MANAGED_PROCESS_RESULT_UNKNOWN",
      "Durable Process Supervisor could not prove the managed process result"
    );
  }
  throw error;
}

export class HostProcessSupervisorClient {
  readonly durable = true as const;
  private readonly client: ProcessSupervisorClient;
  private readonly owned = new Map<string, SupervisorOwnedProcess>();
  private currentGeneration: string | null = null;

  constructor(private readonly paths: TokenPilotPaths) {
    this.client = new ProcessSupervisorClient({ paths });
  }

  assertReady(): unknown {
    if (
      !fs.existsSync(this.paths.processSupervisorSocketPath) ||
      !fs.existsSync(this.paths.processSupervisorTokenPath)
    ) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE",
        "Durable Process Supervisor is not ready"
      );
    }
    return { durable: true };
  }

  has(processId: string): boolean {
    return this.owned.has(processId);
  }

  activeProcessIds(): string[] {
    return [...this.owned.keys()];
  }

  generation(): string | null {
    return this.currentGeneration;
  }

  async refresh(): Promise<DurableHostProcessRefresh> {
    try {
      const health = await this.client.request<{ state: string }>("health", {});
      if (health.result.state !== "ready") {
        throw new ProcessSupervisorClientError(
          "SUPERVISOR_UNAVAILABLE",
          "Process Supervisor is not ready"
        );
      }
      const listed = await this.client.request<{ processes: SupervisorOwnedProcess[] }>(
        "owned.list",
        {}
      );
      if (listed.supervisorGeneration !== health.supervisorGeneration) {
        throw new ProcessSupervisorClientError(
          "SUPERVISOR_PROTOCOL_ERROR",
          "Process Supervisor generation changed during refresh"
        );
      }
      this.currentGeneration = health.supervisorGeneration;
      this.owned.clear();
      for (const process of listed.result.processes) {
        this.owned.set(process.processId, { ...process });
      }
      return {
        supervisorGeneration: health.supervisorGeneration,
        owned: [...this.owned.values()].map((entry) => ({ ...entry }))
      };
    } catch (error) {
      mapClientError(error);
    }
  }

  async start(
    request: ManagedProcessStartRequest | DurableHostProcessStartRequest
  ): Promise<DurableHostProcessRuntimeSnapshot> {
    if (
      !("workspaceId" in request) ||
      !("taskId" in request) ||
      !("sessionId" in request) ||
      !("writerLeaseId" in request) ||
      !("executorId" in request) ||
      !("actionId" in request) ||
      !("actionHash" in request)
    ) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID",
        "Durable managed process start is missing governance identity"
      );
    }
    const durableRequest = request as DurableHostProcessStartRequest;
    try {
      const response = await this.client.request<SupervisorProcessMutationResult>(
        "process.start",
        durableRequest
      );
      this.currentGeneration = response.supervisorGeneration;
      if (response.result.status === "running") {
        this.owned.set(durableRequest.processId, {
          processId: durableRequest.processId,
          workspaceId: durableRequest.workspaceId,
          taskId: durableRequest.taskId,
          sessionId: durableRequest.sessionId,
          writerLeaseId: durableRequest.writerLeaseId,
          executorId: durableRequest.executorId,
          startActionId: durableRequest.actionId,
          startActionHash: durableRequest.actionHash,
          startedAt: new Date().toISOString()
        });
      }
      return this.projectMutation(response.result, response.supervisorGeneration);
    } catch (error) {
      mapClientError(error);
    }
  }

  async read(
    processId: string,
    options: ManagedProcessReadOptions = {}
  ): Promise<DurableHostProcessRuntimeSnapshot> {
    try {
      const response = await this.client.request<SupervisorProcessReadResult>(
        "process.read",
        { processId, ...options }
      );
      this.currentGeneration = response.supervisorGeneration;
      if (response.result.status !== "running") {
        this.owned.delete(processId);
      }
      return {
        processId: response.result.processId,
        status: response.result.status,
        exitCode: response.result.exitCode,
        output: response.result.output,
        truncated: response.result.truncated,
        supervisorGeneration: response.supervisorGeneration
      };
    } catch (error) {
      mapClientError(error);
    }
  }

  async input(
    processId: string,
    options: ManagedProcessInputOptions & Partial<DurableHostProcessActionOptions>
  ): Promise<DurableHostProcessRuntimeSnapshot> {
    if (!options.actionId || !options.actionHash) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID",
        "Durable managed process input is missing exact action identity"
      );
    }
    try {
      const response = await this.client.request<SupervisorProcessMutationResult>(
        "process.input",
        { processId, ...options }
      );
      this.currentGeneration = response.supervisorGeneration;
      if (response.result.status !== "running") {
        this.owned.delete(processId);
      }
      return this.projectMutation(response.result, response.supervisorGeneration);
    } catch (error) {
      mapClientError(error);
    }
  }

  async stop(
    processId: string,
    options?: DurableHostProcessActionOptions
  ): Promise<DurableHostProcessRuntimeSnapshot> {
    try {
      const action = options ?? {
        actionId: `internal-stop:${processId}`,
        actionHash: "0".repeat(64)
      };
      const response = await this.client.request<SupervisorProcessMutationResult>(
        "process.stop",
        { processId, ...action }
      );
      this.currentGeneration = response.supervisorGeneration;
      this.owned.delete(processId);
      return this.projectMutation(response.result, response.supervisorGeneration);
    } catch (error) {
      mapClientError(error);
    }
  }

  async listEvents(): Promise<{
    supervisorGeneration: string;
    events: SupervisorTerminalEvent[];
  }> {
    try {
      const response = await this.client.request<{ events: SupervisorTerminalEvent[] }>(
        "events.list",
        {}
      );
      return {
        supervisorGeneration: response.supervisorGeneration,
        events: response.result.events
      };
    } catch (error) {
      mapClientError(error);
    }
  }

  async ackEvents(eventIds: string[]): Promise<number> {
    try {
      const response = await this.client.request<{ acknowledged: number }>(
        "events.ack",
        { eventIds }
      );
      return response.result.acknowledged;
    } catch (error) {
      mapClientError(error);
    }
  }

  async closeClient(): Promise<void> {
    // Per-request Unix socket connections have no persistent Control Plane connection to close.
  }

  async closeAll(): Promise<DurableHostProcessRuntimeSnapshot[]> {
    throw new DesktopCommanderManagedProcessError(
      "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID",
      "Control Plane cannot close all Durable Process Supervisor runtimes"
    );
  }

  private projectMutation(
    result: SupervisorProcessMutationResult,
    supervisorGeneration: string
  ): DurableHostProcessRuntimeSnapshot {
    return {
      processId: result.processId,
      status: result.status,
      exitCode: result.exitCode,
      output: "",
      truncated: result.truncated,
      supervisorGeneration
    };
  }
}
