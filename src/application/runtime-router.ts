import { ServiceError } from "./service-error.js";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeCodexAccountStatus,
  RuntimeEventSink,
  RuntimeMcpServerProjection,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection,
  RuntimeStandaloneCommandResult,
  RuntimeStandaloneDirectoryEntry,
  RuntimeStandaloneFileReadResult,
  RuntimeStandaloneProcessSnapshot,
  RuntimeStandaloneProcessStartResult,
  RuntimeThreadContextInput,
  RuntimeThreadContextPage,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput,
  RuntimeThreadStartInput,
  RuntimeTurnInterruptInput,
  RuntimeTurnProjection,
  RuntimeTurnStartInput
} from "../runtime/codex/runtime-adapter.js";

export class RuntimeRouter {
  constructor(private readonly codex: CodingRuntimeAdapter) {}

  capabilities(): Promise<RuntimeCapabilitySnapshot> {
    return this.codex.capabilities();
  }

  listCodexThreads(
    input?: RuntimeThreadListInput
  ): Promise<RuntimeThreadListResult> {
    return this.codex.listThreads(input);
  }

  readCodexThread(
    input: RuntimeThreadReadInput
  ): Promise<RuntimeThreadProjection> {
    return this.codex.readThread(input);
  }

  readCodexThreadContext(
    input: RuntimeThreadContextInput
  ): Promise<RuntimeThreadContextPage> {
    return this.codex.readThreadContext(input);
  }

  startCodexThread(
    input: RuntimeThreadStartInput
  ): Promise<RuntimeThreadProjection> {
    return this.codex.startThread(input);
  }

  resumeCodexThread(
    input: RuntimeThreadResumeInput
  ): Promise<RuntimeThreadProjection> {
    return this.codex.resumeThread(input);
  }

  forkCodexThread(
    input: RuntimeThreadForkInput
  ): Promise<RuntimeThreadProjection> {
    return this.codex.forkThread(input);
  }

  startCodexTurn(input: RuntimeTurnStartInput): Promise<RuntimeTurnProjection> {
    return this.codex.startTurn(input);
  }

  interruptCodexTurn(input: RuntimeTurnInterruptInput): Promise<void> {
    return this.codex.interruptTurn(input);
  }

  readCodexAccountStatus(): Promise<RuntimeCodexAccountStatus> {
    return this.codex.readAccountStatus();
  }

  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]> {
    if (!this.codex.listSkills) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Codex resource skill inventory is unavailable"
      );
    }
    return this.codex.listSkills(input);
  }

  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]> {
    if (!this.codex.listMcpServers) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Codex MCP server inventory is unavailable"
      );
    }
    return this.codex.listMcpServers();
  }

  listCodexPlugins(
    input?: RuntimePluginListInput
  ): Promise<RuntimePluginProjection[]> {
    if (!this.codex.listPlugins) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Codex plugin inventory is unavailable"
      );
    }
    return this.codex.listPlugins(input);
  }

  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary> {
    if (!this.codex.readResourceConfigSummary) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Codex resource config summary is unavailable"
      );
    }
    return this.codex.readResourceConfigSummary();
  }

  readStandaloneFile(path: string): Promise<RuntimeStandaloneFileReadResult> {
    return this.codex.readStandaloneFile(path);
  }

  writeStandaloneFile(path: string, dataBase64: string): Promise<void> {
    return this.codex.writeStandaloneFile(path, dataBase64);
  }

  listStandaloneDirectory(
    path: string
  ): Promise<RuntimeStandaloneDirectoryEntry[]> {
    return this.codex.listStandaloneDirectory(path);
  }

  executeStandaloneCommand(input: {
    command: string[];
    cwd: string;
    timeoutMs: number;
    outputBytesCap: number;
    readOnly: boolean;
  }): Promise<RuntimeStandaloneCommandResult> {
    return this.codex.executeStandaloneCommand(input);
  }

  startStandaloneProcess(input: {
    command: string[];
    cwd: string;
    readOnly: boolean;
    allowStdin: boolean;
    networkAccess: boolean;
  }): Promise<RuntimeStandaloneProcessStartResult> {
    if (!this.codex.startStandaloneProcess) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Managed standalone process execution is unavailable"
      );
    }
    return this.codex.startStandaloneProcess(input);
  }

  readStandaloneProcess(
    processId: string,
    cursor = 0,
    limit = 100
  ): Promise<RuntimeStandaloneProcessSnapshot> {
    if (!this.codex.readStandaloneProcess) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Managed standalone process inspection is unavailable"
      );
    }
    return this.codex.readStandaloneProcess(processId, cursor, limit);
  }

  waitStandaloneProcess(
    processId: string
  ): Promise<RuntimeStandaloneProcessSnapshot> {
    if (!this.codex.waitStandaloneProcess) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Managed standalone process completion is unavailable"
      );
    }
    return this.codex.waitStandaloneProcess(processId);
  }

  writeStandaloneProcess(
    processId: string,
    input: string,
    closeStdin = false
  ): Promise<void> {
    if (!this.codex.writeStandaloneProcess) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Managed standalone process stdin is unavailable"
      );
    }
    return this.codex.writeStandaloneProcess(processId, input, closeStdin);
  }

  terminateStandaloneProcess(processId: string): Promise<void> {
    if (!this.codex.terminateStandaloneProcess) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Managed standalone process termination is unavailable"
      );
    }
    return this.codex.terminateStandaloneProcess(processId);
  }

  respondToCodexServerRequest(
    requestKey: string,
    result: Record<string, unknown>
  ): Promise<void> {
    return this.codex.respondToServerRequest(requestKey, result);
  }

  rejectCodexServerRequest(
    requestKey: string,
    code: number,
    message: string
  ): Promise<void> {
    return this.codex.rejectServerRequest(requestKey, code, message);
  }

  setEventSink(sink: RuntimeEventSink | null): void {
    this.codex.setEventSink(sink);
  }

  close(): Promise<void> {
    return this.codex.close();
  }
}
