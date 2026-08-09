import assert from "node:assert/strict";

import { ServiceError } from "../src/application/service-error.ts";
import { NativeCodexRecoveryAdapter } from "../src/runtime/recovery/native-codex-recovery-adapter.ts";
import type {
  RuntimeCapabilitySnapshot,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput
} from "../src/runtime/codex/runtime-adapter.ts";

const NOW = 1_786_245_600_000;

function thread(id: string, overrides: Partial<RuntimeThreadProjection> = {}): RuntimeThreadProjection {
  return {
    id,
    preview: `thread:${id}`,
    modelProvider: "openai",
    createdAt: NOW - 1000,
    updatedAt: NOW,
    recencyAt: NOW,
    sourceKind: "cli",
    status: { type: "idle" },
    projectId: "project-a",
    workspaceId: "workspace-a",
    repoId: "repo-a",
    parentThreadId: null,
    agentNickname: null,
    agentRole: null,
    ...overrides
  };
}

class FixtureCodexRuntime {
  readonly calls: string[] = [];
  capabilitiesValue: RuntimeCapabilitySnapshot = {
    available: true,
    runtime: "codex-app-server",
    binarySource: "path",
    binaryVersion: "codex-cli 1.2.3",
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
  threads = [thread("thread-a"), thread("thread-b")];

  async capabilities(): Promise<RuntimeCapabilitySnapshot> {
    this.calls.push("capabilities");
    return this.capabilitiesValue;
  }
  async listCodexThreads(input?: RuntimeThreadListInput): Promise<RuntimeThreadListResult> {
    this.calls.push(`list:${input?.workspaceId ?? "*"}`);
    return { data: this.threads, nextCursor: null, backwardsCursor: null };
  }
  async readCodexThread(input: RuntimeThreadReadInput): Promise<RuntimeThreadProjection> {
    this.calls.push(`read:${input.threadId}`);
    const found = this.threads.find((candidate) => candidate.id === input.threadId);
    if (!found) {
      throw new ServiceError("CODEX_THREAD_RESPONSE_INVALID", "missing thread");
    }
    return found;
  }
  async resumeCodexThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection> {
    this.calls.push(`resume:${input.threadId}`);
    return thread(input.threadId, { status: { type: "resumed" }, updatedAt: NOW + 1000 });
  }
  async forkCodexThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection> {
    this.calls.push(`fork:${input.threadId}`);
    return thread(`${input.threadId}-fork`, {
      parentThreadId: input.threadId,
      updatedAt: NOW + 2000
    });
  }
}

const runtime = new FixtureCodexRuntime();
const adapter = new NativeCodexRecoveryAdapter(runtime, {
  now: () => "2026-08-09T11:00:00.000Z"
});

const compatibility = await adapter.probeCompatibility();
assert.equal(compatibility.compatibilityStatus, "ready");
assert.equal(compatibility.available, true);
assert.equal(compatibility.executableSource, "path");
assert.ok(compatibility.schemaFingerprint);
assert.equal(compatibility.schemaFingerprint?.length, 64);

const candidates = await adapter.listRecoverableSessions({
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a"
});
assert.equal(candidates.length, 2);
assert.deepEqual(
  candidates.map((candidate) => candidate.externalSessionId),
  ["thread-a", "thread-b"]
);
assert.equal(runtime.calls.some((call) => call.startsWith("resume:")), false);
assert.equal(runtime.calls.some((call) => call.startsWith("fork:")), false);

const inspection = await adapter.inspectExternalSession({
  externalSessionId: "thread-a",
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a"
});
assert.equal(inspection.exists, true);
assert.equal(inspection.identityMatched, true);
assert.equal(inspection.authoritative, true);

runtime.threads = [thread("thread-mismatch", { workspaceId: "workspace-other" })];
const mismatch = await adapter.inspectExternalSession({
  externalSessionId: "thread-mismatch",
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a"
});
assert.equal(mismatch.exists, true);
assert.equal(mismatch.identityMatched, false);

runtime.threads = [thread("thread-a")];
const resumed = await adapter.executeRecovery({
  action: "resume-bound-codex",
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a",
  externalSessionId: "thread-a"
});
assert.equal(resumed.relation, "resumed");
assert.equal(resumed.externalSession?.externalSessionId, "thread-a");
assert.equal(resumed.externalSession?.status, "resumed");

const forked = await adapter.executeRecovery({
  action: "fork-bound-codex",
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a",
  sourceExternalSessionId: "thread-a"
});
assert.equal(forked.relation, "forked");
assert.equal(forked.externalSession?.externalSessionId, "thread-a-fork");

runtime.capabilitiesValue = {
  ...runtime.capabilitiesValue,
  stableMethods: ["thread/list", "thread/read"]
};
const incompatible = await adapter.probeCompatibility();
assert.equal(incompatible.compatibilityStatus, "protocol-incompatible");
assert.equal(incompatible.available, false);

runtime.capabilitiesValue = {
  ...runtime.capabilitiesValue,
  available: false,
  stableMethods: [],
  unavailableReason: "CODEX_APP_SERVER_UNAVAILABLE"
};
const unavailable = await adapter.probeCompatibility();
assert.equal(unavailable.compatibilityStatus, "unavailable");
assert.equal(unavailable.available, false);

process.stdout.write("VERIFY_CODEX_RECOVERY_ADAPTER_OK\n");
