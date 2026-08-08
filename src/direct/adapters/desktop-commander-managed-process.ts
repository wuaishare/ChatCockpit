import {
  DESKTOP_COMMANDER_EXECUTOR_ID,
  DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL,
  DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL,
  DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
  DESKTOP_COMMANDER_START_PROCESS_TOOL
} from "./desktop-commander.js";
import {
  boundDesktopCommanderOutput,
  buildDesktopCommanderCommandSource,
  cleanDesktopCommanderProcessOutput,
  parseDesktopCommanderExitCode,
  parseDesktopCommanderPid,
  projectDesktopCommanderToolResult
} from "./desktop-commander-process.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpStdioExecutorConfig
} from "../downstream-mcp-config.js";
import { DownstreamMcpStdioClient } from "../downstream-mcp-stdio-client.js";
import { DownstreamMcpCapabilityStore } from "../downstream-mcp-snapshot.js";
import type { DownstreamMcpClient } from "../downstream-mcp-types.js";

const DEFAULT_READ_TIMEOUT_MS = 250;
const DEFAULT_OUTPUT_LINES = 1_000;

export type ManagedProcessAdapterStatus =
  | "running"
  | "exited"
  | "terminated"
  | "unknown";

export type DesktopCommanderManagedProcessErrorCode =
  | "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE"
  | "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID"
  | "DESKTOP_COMMANDER_MANAGED_PROCESS_NOT_FOUND"
  | "DESKTOP_COMMANDER_MANAGED_PROCESS_RESULT_UNKNOWN"
  | "DESKTOP_COMMANDER_MANAGED_PROCESS_TERMINATION_FAILED";

export class DesktopCommanderManagedProcessError extends Error {
  constructor(
    readonly code: DesktopCommanderManagedProcessErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DesktopCommanderManagedProcessError";
  }
}

export interface ManagedProcessStartRequest {
  processId: string;
  cwd: string;
  command: string;
  args: string[];
  startupTimeoutMs: number;
}

export interface ManagedProcessReadOptions {
  offset?: number;
  length?: number;
  waitMs?: number;
}

export interface ManagedProcessInputOptions {
  input: string;
  timeoutMs: number;
  waitForPrompt: boolean;
}

export interface ManagedProcessAdapterSnapshot {
  processId: string;
  privatePid: number;
  status: ManagedProcessAdapterStatus;
  exitCode: number | null;
  output: string;
  truncated: boolean;
}

export type ManagedProcessClientFactory = (
  executor: DownstreamMcpStdioExecutorConfig
) => DownstreamMcpClient;

interface ManagedProcessRuntime {
  processId: string;
  privatePid: number;
  client: DownstreamMcpClient;
}

function defaultClientFactory(
  executor: DownstreamMcpStdioExecutorConfig
): DownstreamMcpClient {
  return new DownstreamMcpStdioClient({
    command: executor.transport.command,
    args: executor.transport.args,
    ...(executor.transport.cwd ? { cwd: executor.transport.cwd } : {}),
    env: {
      ...process.env,
      ...(executor.transport.env ?? {})
    },
    timeoutMs: executor.transport.timeoutMs,
    maxBufferBytes: executor.transport.maxBufferBytes,
    maxStderrBytes: executor.transport.maxStderrBytes
  });
}

function initialProcessOutput(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^Process started with PID\s+\d+/i.test(line.trim()))
    .filter((line) => !/^Initial output:\s*$/i.test(line.trim()))
    .join("\n")
    .trim();
}

export class DesktopCommanderManagedProcessSupervisor {
  private readonly snapshotStore: DownstreamMcpCapabilityStore;
  private readonly runtimes = new Map<string, ManagedProcessRuntime>();

  constructor(
    runtimeDir: string,
    private readonly configPath?: string,
    private readonly clientFactory: ManagedProcessClientFactory = defaultClientFactory
  ) {
    this.snapshotStore = new DownstreamMcpCapabilityStore(runtimeDir);
  }

  assertReady(): DownstreamMcpStdioExecutorConfig {
    const config = loadDownstreamMcpExecutorsConfig(this.configPath);
    const executor = config.executors.find(
      (candidate) => candidate.id === DESKTOP_COMMANDER_EXECUTOR_ID
    );
    if (!executor) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE",
        "Desktop Commander executor is not configured"
      );
    }

    const configuredMapping = executor.mappings.find(
      (mapping) =>
        mapping.capability === "shell.exec" &&
        mapping.toolName === DESKTOP_COMMANDER_START_PROCESS_TOOL &&
        mapping.scopes.includes("host") &&
        mapping.access.includes("write")
    );
    if (!configuredMapping) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE",
        "Desktop Commander does not configure the managed Host Process mapping"
      );
    }

    const snapshot = this.snapshotStore.read(DESKTOP_COMMANDER_EXECUTOR_ID);
    const verifiedMapping = snapshot?.mappings.find(
      (mapping) =>
        mapping.status === "verified" &&
        mapping.capability === "shell.exec" &&
        mapping.toolName === DESKTOP_COMMANDER_START_PROCESS_TOOL &&
        mapping.scopes.includes("host") &&
        mapping.access.includes("write")
    );
    if (!snapshot || snapshot.health === "unavailable" || !verifiedMapping) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE",
        "Desktop Commander managed Host Process mapping is not verified"
      );
    }

    for (const toolName of [
      DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
      DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL,
      DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL
    ]) {
      if (!snapshot.toolsObserved.includes(toolName)) {
        throw new DesktopCommanderManagedProcessError(
          "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE",
          `Desktop Commander managed-process dependency ${toolName} is unavailable`
        );
      }
    }
    return executor;
  }

  has(processId: string): boolean {
    return this.runtimes.has(processId);
  }

  activeProcessIds(): string[] {
    return [...this.runtimes.keys()];
  }

  async start(
    request: ManagedProcessStartRequest
  ): Promise<ManagedProcessAdapterSnapshot> {
    if (this.runtimes.has(request.processId)) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID",
        "Managed Host Process id is already active"
      );
    }
    const executor = this.assertReady();
    const client = this.clientFactory(executor);
    let privatePid: number | null = null;
    try {
      const started = projectDesktopCommanderToolResult(
        await client.callTool(DESKTOP_COMMANDER_START_PROCESS_TOOL, {
          command: buildDesktopCommanderCommandSource({
            cwd: request.cwd,
            command: request.command,
            args: request.args
          }),
          timeout_ms: request.startupTimeoutMs,
          shell: "/bin/zsh",
          origin: "llm"
        })
      );
      if (started.isError) {
        throw new DesktopCommanderManagedProcessError(
          "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID",
          "Desktop Commander start_process reported an error"
        );
      }
      privatePid = parseDesktopCommanderPid(started.text);
      this.runtimes.set(request.processId, {
        processId: request.processId,
        privatePid,
        client
      });

      const initial = boundDesktopCommanderOutput(
        initialProcessOutput(started.text)
      );
      const observed = await this.read(request.processId, {
        offset: 0,
        length: DEFAULT_OUTPUT_LINES,
        waitMs: DEFAULT_READ_TIMEOUT_MS
      });
      if (!initial.output || observed.output.includes(initial.output)) {
        return observed;
      }
      const combined = boundDesktopCommanderOutput(
        [initial.output, observed.output].filter(Boolean).join("\n")
      );
      return {
        ...observed,
        output: combined.output,
        truncated: initial.truncated || observed.truncated || combined.truncated
      };
    } catch (error) {
      if (privatePid !== null) {
        try {
          await client.callTool(DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL, {
            pid: privatePid
          });
        } catch {
          // Best-effort cleanup while preserving the original start failure.
        }
      }
      this.runtimes.delete(request.processId);
      await client.close();
      throw error;
    }
  }

  async read(
    processId: string,
    options: ManagedProcessReadOptions = {}
  ): Promise<ManagedProcessAdapterSnapshot> {
    const runtime = this.requireRuntime(processId);
    const result = projectDesktopCommanderToolResult(
      await runtime.client.callTool(DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL, {
        pid: runtime.privatePid,
        timeout_ms: options.waitMs ?? DEFAULT_READ_TIMEOUT_MS,
        offset: options.offset ?? 0,
        length: options.length ?? DEFAULT_OUTPUT_LINES
      })
    );
    if (result.isError) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_RESULT_UNKNOWN",
        "Desktop Commander could not read the managed process state"
      );
    }
    return this.projectSnapshot(runtime, result.text, "exited");
  }

  async input(
    processId: string,
    options: ManagedProcessInputOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    const runtime = this.requireRuntime(processId);
    const result = projectDesktopCommanderToolResult(
      await runtime.client.callTool(DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL, {
        pid: runtime.privatePid,
        input: options.input,
        timeout_ms: options.timeoutMs,
        wait_for_prompt: options.waitForPrompt,
        verbose_timing: false
      })
    );
    if (result.isError) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_RESULT_UNKNOWN",
        "Desktop Commander could not interact with the managed process"
      );
    }
    return this.projectSnapshot(runtime, result.text, "exited");
  }

  async stop(processId: string): Promise<ManagedProcessAdapterSnapshot> {
    const runtime = this.requireRuntime(processId);
    const terminated = projectDesktopCommanderToolResult(
      await runtime.client.callTool(DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL, {
        pid: runtime.privatePid
      })
    );
    if (terminated.isError) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_TERMINATION_FAILED",
        "Desktop Commander could not terminate the managed process"
      );
    }

    try {
      const finalRead = projectDesktopCommanderToolResult(
        await runtime.client.callTool(DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL, {
          pid: runtime.privatePid,
          timeout_ms: DEFAULT_READ_TIMEOUT_MS,
          offset: 0,
          length: DEFAULT_OUTPUT_LINES
        })
      );
      if (finalRead.isError) {
        return await this.finishUnknown(runtime, terminated.text);
      }
      const exitCode = parseDesktopCommanderExitCode(finalRead.text);
      if (exitCode === null) {
        return await this.finishUnknown(runtime, finalRead.text);
      }
      const projected = boundDesktopCommanderOutput(
        cleanDesktopCommanderProcessOutput(finalRead.text)
      );
      await this.releaseRuntime(runtime.processId);
      return {
        processId: runtime.processId,
        privatePid: runtime.privatePid,
        status: "terminated",
        exitCode,
        output: projected.output,
        truncated: projected.truncated
      };
    } catch {
      return await this.finishUnknown(runtime, terminated.text);
    }
  }

  async close(processId: string): Promise<void> {
    const runtime = this.runtimes.get(processId);
    if (!runtime) {
      return;
    }
    await this.releaseRuntime(processId);
  }

  async closeAll(): Promise<ManagedProcessAdapterSnapshot[]> {
    const results: ManagedProcessAdapterSnapshot[] = [];
    for (const processId of [...this.runtimes.keys()]) {
      try {
        results.push(await this.stop(processId));
      } catch {
        const runtime = this.runtimes.get(processId);
        if (runtime) {
          results.push({
            processId,
            privatePid: runtime.privatePid,
            status: "unknown",
            exitCode: null,
            output: "",
            truncated: false
          });
          await this.releaseRuntime(processId);
        }
      }
    }
    return results;
  }

  private requireRuntime(processId: string): ManagedProcessRuntime {
    const runtime = this.runtimes.get(processId);
    if (!runtime) {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_NOT_FOUND",
        "Managed Host Process runtime is not active"
      );
    }
    return runtime;
  }

  private async projectSnapshot(
    runtime: ManagedProcessRuntime,
    rawText: string,
    terminalStatus: "exited"
  ): Promise<ManagedProcessAdapterSnapshot> {
    const exitCode = parseDesktopCommanderExitCode(rawText);
    const projected = boundDesktopCommanderOutput(
      cleanDesktopCommanderProcessOutput(rawText)
    );
    if (exitCode === null) {
      return {
        processId: runtime.processId,
        privatePid: runtime.privatePid,
        status: "running",
        exitCode: null,
        output: projected.output,
        truncated: projected.truncated
      };
    }
    await this.releaseRuntime(runtime.processId);
    return {
      processId: runtime.processId,
      privatePid: runtime.privatePid,
      status: terminalStatus,
      exitCode,
      output: projected.output,
      truncated: projected.truncated
    };
  }

  private async finishUnknown(
    runtime: ManagedProcessRuntime,
    rawText: string
  ): Promise<ManagedProcessAdapterSnapshot> {
    const projected = boundDesktopCommanderOutput(
      cleanDesktopCommanderProcessOutput(rawText)
    );
    await this.releaseRuntime(runtime.processId);
    return {
      processId: runtime.processId,
      privatePid: runtime.privatePid,
      status: "unknown",
      exitCode: null,
      output: projected.output,
      truncated: projected.truncated
    };
  }

  private async releaseRuntime(processId: string): Promise<void> {
    const runtime = this.runtimes.get(processId);
    if (!runtime) {
      return;
    }
    this.runtimes.delete(processId);
    await runtime.client.close();
  }
}
