import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../src/application/service-error.ts";
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
} from "../src/runtime/codex/runtime-adapter.ts";
import {
  runCodexRuntimeRecoveryLiveProof,
  type CodexRecoveryLiveIdentity
} from "./probe-codex-runtime-recovery-live.ts";
import {
  createHermeticGitFixtureEnv,
  initializeGitFixture
} from "./test-support/git.ts";

class FixtureCodingRuntimeAdapter implements CodingRuntimeAdapter {
  private readonly threads = new Map<string, RuntimeThreadProjection>();
  private forkSequence = 0;

  constructor(private readonly identity: CodexRecoveryLiveIdentity) {
    this.threads.set(
      "fixture-thread-source",
      this.thread("fixture-thread-source", null)
    );
  }

  async capabilities(): Promise<RuntimeCapabilitySnapshot> {
    return {
      available: true,
      runtime: "codex-app-server",
      binarySource: "configured",
      binaryVersion: "codex-cli fixture-recovery",
      protocolFamily: "app-server-v2",
      serverProtocolVersion: "2.0",
      stableMethods: [
        "thread/list",
        "thread/read",
        "thread/resume",
        "thread/fork",
        "turn/start",
        "turn/interrupt"
      ],
      experimentalApiEnabled: false,
      standaloneExecution: null
    };
  }

  async listThreads(_input?: RuntimeThreadListInput): Promise<RuntimeThreadListResult> {
    return {
      data: [...this.threads.values()].map((entry) => ({ ...entry })),
      nextCursor: null,
      backwardsCursor: null
    };
  }

  async readThread(input: RuntimeThreadReadInput): Promise<RuntimeThreadProjection> {
    const thread = this.threads.get(input.threadId);
    if (!thread) {
      throw new ServiceError(
        "CODEX_THREAD_RESPONSE_INVALID",
        "Fixture Codex thread does not exist"
      );
    }
    return { ...thread };
  }

  async resumeThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection> {
    const current = await this.readThread({ threadId: input.threadId });
    const resumed = {
      ...current,
      status: { type: "idle" },
      updatedAt: (current.updatedAt ?? 0) + 1,
      recencyAt: (current.recencyAt ?? 0) + 1
    };
    this.threads.set(resumed.id, resumed);
    return { ...resumed };
  }

  async forkThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection> {
    const source = await this.readThread({ threadId: input.threadId });
    const id = `${source.id}-fork-${++this.forkSequence}`;
    const fork = this.thread(id, source.id);
    this.threads.set(id, fork);
    return { ...fork };
  }

  async startTurn(_input: RuntimeTurnStartInput): Promise<RuntimeTurnProjection> {
    throw new Error("Recovery live harness must never call turn/start");
  }

  async interruptTurn(_input: RuntimeTurnInterruptInput): Promise<void> {
    throw new Error("not used");
  }

  async readStandaloneFile(_filePath: string): Promise<RuntimeStandaloneFileReadResult> {
    throw new Error("not used");
  }

  async writeStandaloneFile(_filePath: string, _dataBase64: string): Promise<void> {
    throw new Error("not used");
  }

  async listStandaloneDirectory(
    _directoryPath: string
  ): Promise<RuntimeStandaloneDirectoryEntry[]> {
    throw new Error("not used");
  }

  async executeStandaloneCommand(_input: {
    command: string[];
    cwd: string;
    timeoutMs: number;
    outputBytesCap: number;
    readOnly: boolean;
  }): Promise<RuntimeStandaloneCommandResult> {
    throw new Error("not used");
  }

  async respondToServerRequest(
    _requestKey: string,
    _result: Record<string, unknown>
  ): Promise<void> {
    throw new Error("not used");
  }

  async rejectServerRequest(
    _requestKey: string,
    _code: number,
    _message: string
  ): Promise<void> {
    throw new Error("not used");
  }

  setEventSink(_sink: RuntimeEventSink | null): void {}

  async close(): Promise<void> {}

  private thread(id: string, parentThreadId: string | null): RuntimeThreadProjection {
    return {
      id,
      preview: `fixture ${id}`,
      modelProvider: "openai",
      createdAt: 10,
      updatedAt: 20 + this.forkSequence,
      recencyAt: 20 + this.forkSequence,
      sourceKind: "fixture",
      status: { type: "idle" },
      projectId: this.identity.projectId,
      workspaceId: this.identity.workspaceId,
      repoId: this.identity.repoId,
      parentThreadId,
      agentNickname: null,
      agentRole: null
    };
  }
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "tp-codex-recovery-harness-"));
const workspaceRoot = path.join(sandbox, "workspace");
const gitEnv = createHermeticGitFixtureEnv(path.join(sandbox, "git-env"));
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, "README.md"), "recovery harness\n", "utf8");
initializeGitFixture(
  workspaceRoot,
  {
    email: "chatcockpit@example.invalid",
    name: "ChatCockpit Test"
  },
  gitEnv
);

try {
  const summary = await runCodexRuntimeRecoveryLiveProof({
    workspaceRoot,
    createAdapter: (_repositories, identity) =>
      new FixtureCodingRuntimeAdapter(identity)
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.providerKind, "codex");
  assert.equal(summary.protocolKind, "native-app-server");
  assert.equal(summary.compatibilityDriftRejected, true);
  assert.equal(summary.externalMissingWasNotFaked, true);
  assert.equal(summary.turnStartObserved, false);
  assert.notEqual(summary.forkedThreadId, summary.resumedThreadId);
  assert.equal(summary.fallbackMode, "chat-direct");

  process.stdout.write("VERIFY_CODEX_RUNTIME_RECOVERY_LIVE_HARNESS_OK\n");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
