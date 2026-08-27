import { randomUUID } from "node:crypto";

import { continuityDatabasePath } from "../continuity/database.js";
import { createDeviceRuntimeLifecycleAdapter } from "../devices/device-runtime-lifecycle-adapter.js";
import { DesktopCommanderManagedProcessSupervisor } from "../direct/adapters/desktop-commander-managed-process.js";
import { getDownstreamMcpExecutorsConfigPath } from "../direct/downstream-mcp-config.js";
import type { TokenPilotPaths } from "../types.js";
import { ProcessSupervisorEventJournal } from "./event-journal.js";
import { createProcessSupervisorManagedProcessClientFactory } from "./downstream-containment.js";
import { ProcessSupervisorLeaseAuthorityReader } from "./lease-authority-reader.js";
import { ProcessSupervisorIpcServer } from "./server.js";
import {
  ProcessSupervisorRuntimeService,
  type ProcessSupervisorAuthorityReader,
  type ProcessSupervisorEventStore,
  type ProcessSupervisorManagedAdapter,
  type ProcessSupervisorRuntimeLifecycleAdapter
} from "./service.js";
import {
  ensureProcessSupervisorRuntime,
  removeProcessSupervisorPid,
  removeProcessSupervisorToken,
  rotateProcessSupervisorToken,
  writeProcessSupervisorPid,
  writeProcessSupervisorStatus
} from "./runtime-files.js";
import { PROCESS_SUPERVISOR_PROTOCOL_VERSION } from "./protocol.js";

interface ClosableAuthorityReader extends ProcessSupervisorAuthorityReader {
  close?(): void;
}

export interface ProcessSupervisorDaemonOptions {
  adapter?: ProcessSupervisorManagedAdapter;
  authorityReader?: ClosableAuthorityReader;
  eventJournal?: ProcessSupervisorEventStore;
  runtimeLifecycle?: ProcessSupervisorRuntimeLifecycleAdapter;
  generationFactory?: () => string;
  heartbeatIntervalMs?: number;
  watchdogIntervalMs?: number;
}

export class ProcessSupervisorDaemon {
  private runtimeService: ProcessSupervisorRuntimeService | null = null;
  private ipcServer: ProcessSupervisorIpcServer | null = null;
  private authorityReader: ClosableAuthorityReader | null = null;
  private ownsAuthorityReader = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private startedAt: string | null = null;
  private currentGeneration: string | null = null;
  private started = false;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly options: ProcessSupervisorDaemonOptions = {}
  ) {}

  get generation(): string | null {
    return this.currentGeneration;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    ensureProcessSupervisorRuntime(this.paths);
    const generation =
      this.options.generationFactory?.() ?? `supervisor_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const authToken = rotateProcessSupervisorToken(this.paths);
    writeProcessSupervisorPid(this.paths, process.pid);
    this.currentGeneration = generation;
    this.startedAt = startedAt;
    this.writeStatus("starting");

    try {
      const adapter =
        this.options.adapter ??
        new DesktopCommanderManagedProcessSupervisor(
          this.paths.runtimeDir,
          getDownstreamMcpExecutorsConfigPath(),
          createProcessSupervisorManagedProcessClientFactory()
        );
      const authorityReader =
        this.options.authorityReader ??
        new ProcessSupervisorLeaseAuthorityReader(
          continuityDatabasePath(this.paths.runtimeDir)
        );
      this.authorityReader = authorityReader;
      this.ownsAuthorityReader = this.options.authorityReader === undefined;
      const eventJournal =
        this.options.eventJournal ?? new ProcessSupervisorEventJournal(this.paths);
      const runtimeService = new ProcessSupervisorRuntimeService({
        generation,
        adapter,
        authorityReader,
        eventJournal,
        runtimeLifecycle:
          this.options.runtimeLifecycle ?? createDeviceRuntimeLifecycleAdapter(this.paths)
      });
      const ipcServer = new ProcessSupervisorIpcServer({
        paths: this.paths,
        generation,
        authToken,
        handler: (method, params) => runtimeService.handle(method, params)
      });
      this.runtimeService = runtimeService;
      this.ipcServer = ipcServer;
      await ipcServer.start();
      runtimeService.startWatchdog(this.options.watchdogIntervalMs ?? 15_000);
      this.heartbeatTimer = setInterval(() => {
        this.writeStatus("ready");
      }, this.options.heartbeatIntervalMs ?? 3_000);
      this.heartbeatTimer.unref();
      this.started = true;
      this.writeStatus("ready");
    } catch (error) {
      await this.cleanupAfterFailedStart();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (
      !this.started &&
      !this.runtimeService &&
      !this.ipcServer &&
      !this.currentGeneration
    ) {
      return;
    }
    this.writeStatus("stopping");
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.runtimeService?.stopWatchdog();

    const ipcServer = this.ipcServer;
    this.ipcServer = null;
    if (ipcServer) {
      await ipcServer.close();
    }

    const runtimeService = this.runtimeService;
    this.runtimeService = null;
    if (runtimeService) {
      await runtimeService.closeAll();
    }

    if (this.ownsAuthorityReader) {
      this.authorityReader?.close?.();
    }
    this.authorityReader = null;
    this.ownsAuthorityReader = false;
    removeProcessSupervisorToken(this.paths);
    removeProcessSupervisorPid(this.paths);
    this.started = false;
  }

  private writeStatus(state: "starting" | "ready" | "stopping"): void {
    if (!this.currentGeneration || !this.startedAt) {
      return;
    }
    writeProcessSupervisorStatus(this.paths, {
      generation: this.currentGeneration,
      startedAt: this.startedAt,
      heartbeatAt: new Date().toISOString(),
      state,
      ownedProcessCount: this.runtimeService?.listOwned().length ?? 0,
      protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION
    });
  }

  private async cleanupAfterFailedStart(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.runtimeService?.stopWatchdog();
    try {
      await this.ipcServer?.close();
    } catch {
      // Preserve the original startup failure.
    }
    this.ipcServer = null;
    try {
      await this.runtimeService?.closeAll();
    } catch {
      // Preserve the original startup failure.
    }
    this.runtimeService = null;
    if (this.ownsAuthorityReader) {
      try {
        this.authorityReader?.close?.();
      } catch {
        // Preserve the original startup failure.
      }
    }
    this.authorityReader = null;
    this.ownsAuthorityReader = false;
    removeProcessSupervisorToken(this.paths);
    removeProcessSupervisorPid(this.paths);
    this.started = false;
  }
}

export async function runProcessSupervisorUntilSignal(
  paths: TokenPilotPaths
): Promise<void> {
  const daemon = new ProcessSupervisorDaemon(paths);
  await daemon.start();
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    const stop = () => {
      if (stopping) {
        return;
      }
      stopping = true;
      void daemon.close().then(resolve, reject);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
