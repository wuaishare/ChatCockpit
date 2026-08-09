import assert from "node:assert/strict";

import { ServiceError } from "../src/application/service-error.ts";
import { ChatDirectRecoveryAdapter } from "../src/runtime/recovery/chat-direct-recovery-adapter.ts";
import {
  RunnerRecoveryAdapter,
  type RunnerRecoveryJobProjection,
  type RunnerRecoverySource
} from "../src/runtime/recovery/runner-recovery-adapter.ts";
import { RuntimeRecoveryAdapterRegistry } from "../src/runtime/recovery/runtime-recovery-adapter-registry.ts";

const jobs: RunnerRecoveryJobProjection[] = [
  {
    jobId: "job-a",
    projectId: "project-a",
    workspaceId: "workspace-a",
    repoId: "repo-a",
    taskId: "task-a",
    sessionId: "session-a",
    bindingId: "binding-a",
    status: "completed",
    title: "Async recovery fixture",
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: "2026-08-09T10:10:00.000Z"
  }
];

class FixtureRunnerSource implements RunnerRecoverySource {
  reconcileCalls = 0;
  createCalls = 0;
  retryCalls = 0;

  list(): RunnerRecoveryJobProjection[] {
    return jobs.map((job) => ({ ...job }));
  }

  inspect(jobId: string): RunnerRecoveryJobProjection | null {
    const job = jobs.find((candidate) => candidate.jobId === jobId);
    return job ? { ...job } : null;
  }

  async reconcile(jobId: string): Promise<RunnerRecoveryJobProjection> {
    this.reconcileCalls += 1;
    const job = this.inspect(jobId);
    if (!job) throw new Error("missing fixture job");
    return job;
  }
}

const runnerSource = new FixtureRunnerSource();
const runner = new RunnerRecoveryAdapter(runnerSource, {
  now: () => "2026-08-09T11:00:00.000Z"
});
const chatDirect = new ChatDirectRecoveryAdapter({
  now: () => "2026-08-09T11:00:00.000Z"
});
const registry = new RuntimeRecoveryAdapterRegistry([runner, chatDirect]);

const runnerCompatibility = await runner.probeCompatibility();
assert.equal(runnerCompatibility.compatibilityStatus, "ready");
assert.equal(runnerCompatibility.protocolKind, "runner");

const runnerSessions = await runner.listRecoverableSessions({
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a"
});
assert.equal(runnerSessions.length, 1);
assert.equal(runnerSessions[0]?.externalSessionId, "job-a");

const inspected = await runner.inspectExternalSession({
  externalSessionId: "job-a",
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a"
});
assert.equal(inspected.exists, true);
assert.equal(inspected.identityMatched, true);
assert.equal(inspected.status, "completed");

const reconciled = await runner.executeRecovery({
  action: "reconcile-runner-binding",
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a",
  externalSessionId: "job-a"
});
assert.equal(reconciled.relation, "reconciled");
assert.equal(runnerSource.reconcileCalls, 1);
assert.equal(runnerSource.createCalls, 0);
assert.equal(runnerSource.retryCalls, 0);

const chatCompatibility = await chatDirect.probeCompatibility();
assert.equal(chatCompatibility.compatibilityStatus, "ready");
assert.equal(chatCompatibility.executableSource, "internal");
assert.deepEqual(
  await chatDirect.listRecoverableSessions({
    projectId: "project-a",
    workspaceId: "workspace-a",
    repoId: "repo-a"
  }),
  []
);
await assert.rejects(
  () =>
    chatDirect.inspectExternalSession({
      externalSessionId: "fake-chat-session",
      projectId: "project-a",
      workspaceId: "workspace-a",
      repoId: "repo-a"
    }),
  (error: unknown) =>
    error instanceof ServiceError &&
    error.code === "RECOVERY_EXTERNAL_SESSION_UNSUPPORTED"
);
const continued = await chatDirect.executeRecovery({
  action: "continue-chat-direct",
  projectId: "project-a",
  workspaceId: "workspace-a",
  repoId: "repo-a"
});
assert.equal(continued.relation, "continued");
assert.equal(continued.externalSession, null);

assert.equal(registry.get("runner"), runner);
assert.equal(registry.get("chat-direct"), chatDirect);
assert.throws(
  () => registry.get("unknown-provider"),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "RECOVERY_PROVIDER_UNAVAILABLE"
);

process.stdout.write("VERIFY_RUNTIME_RECOVERY_ADAPTERS_OK\n");
