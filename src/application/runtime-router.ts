import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeEventSink,
  RuntimeStandaloneCommandResult,
  RuntimeStandaloneDirectoryEntry,
  RuntimeStandaloneFileReadResult,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput,
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
