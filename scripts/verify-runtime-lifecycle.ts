import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RuntimeLifecycleService,
  type RuntimeLifecycleSupervisorClient
} from "../src/application/runtime-lifecycle-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-runtime-lifecycle-"));
const paths = buildFixturePaths(root);
ensureWorkspaceDirs(paths);
const database = new ContinuityDatabase({
  path: path.join(paths.runtimeDir, "continuity.sqlite")
});
const repositories = buildContinuityRepositories(database);
const project = repositories.projects.create({
  id: "project_runtime_lifecycle",
  slug: "runtime-lifecycle",
  displayName: "Runtime Lifecycle",
  now: "2026-08-27T05:00:00.000Z"
});
const workspace = repositories.workspaces.create({
  id: "workspace_runtime_lifecycle",
  projectId: project.id,
  repoId: "primary",
  privatePath: root,
  kind: "checkout",
  branch: "main",
  status: "ready",
  now: "2026-08-27T05:00:00.000Z"
});
repositories.projects.setDefaultWorkspace(
  project.id,
  workspace.id,
  project.revision,
  "2026-08-27T05:00:00.000Z"
);
const task = repositories.tasks.create({
  id: "task_runtime_lifecycle",
  projectId: project.id,
  workspaceId: workspace.id,
  title: "Restart runtime",
  goal: "Verify governed self-restart",
  status: "in-progress",
  priority: "high",
  now: "2026-08-27T05:00:00.000Z"
});
const session = repositories.sessions.create({
  id: "session_runtime_lifecycle",
  projectId: project.id,
  workspaceId: workspace.id,
  taskId: task.id,
  title: "Runtime lifecycle session",
  mode: "chat-direct",
  status: "running",
  startedAt: "2026-08-27T05:00:00.000Z"
});
repositories.tasks.bindSession(
  task.id,
  session.id,
  task.revision,
  "2026-08-27T05:00:00.000Z"
);
const calls: Array<{ method: string; params: unknown }> = [];
let responseState: "scheduled" | "succeeded" = "scheduled";
const supervisor: RuntimeLifecycleSupervisorClient = {
  async request<T>(method, params) {
    calls.push({ method, params });
    const operationId = (params as { operationId: string }).operationId;
    const requestHash =
      method === "runtime.restart"
        ? (params as { requestHash: string }).requestHash
        : "a".repeat(64);
    return {
      supervisorGeneration: "generation-runtime-lifecycle",
      result: {
        operationId,
        requestHash,
        state: responseState,
        startedAt: responseState === "succeeded" ? "2026-08-27T05:00:01.000Z" : null,
        completedAt: responseState === "succeeded" ? "2026-08-27T05:00:02.000Z" : null,
        errorCode: null
      } as T
    };
  }
};
const service = new RuntimeLifecycleService(paths, repositories, supervisor);
const context = buildOperationContext({
  requestId: "verify-runtime-lifecycle",
  actorType: "remote-mcp",
  publicProjection: true,
  now: "2026-08-27T05:00:00.000Z"
});

await assert.rejects(
  () => service.restart(context, {
    repoId: "primary",
    sessionId: session.id,
    idempotencyKey: "runtime-restart-0001"
  }),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "WRITER_LEASE_REQUIRED"
);
assert.equal(calls.length, 0);

repositories.leases.acquire({
  id: "lease_runtime_lifecycle",
  workspaceId: workspace.id,
  sessionId: session.id,
  holderType: "chat-direct",
  holderId: "runtime-lifecycle-writer",
  expiresAt: "2026-08-27T06:00:00.000Z",
  now: "2026-08-27T05:00:00.000Z"
});
const scheduled = await service.restart(context, {
  repoId: "primary",
  sessionId: session.id,
  idempotencyKey: "runtime-restart-0001"
});
assert.equal(scheduled.state, "scheduled");
assert.match(scheduled.operationId, /^runtime_restart_[a-f0-9]{40}$/);
assert.equal(calls.length, 1);
assert.equal(calls[0]?.method, "runtime.restart");
const scheduledParams = calls[0]?.params as {
  operationId: string;
  requestHash: string;
};
assert.equal(scheduledParams.operationId, scheduled.operationId);
assert.match(scheduledParams.requestHash, /^[a-f0-9]{64}$/);
assert.equal(JSON.stringify(scheduled).includes("requestHash"), false);

const replay = await service.restart(context, {
  repoId: "primary",
  sessionId: session.id,
  idempotencyKey: "runtime-restart-0001"
});
assert.equal(replay.operationId, scheduled.operationId);
assert.equal((calls[1]?.params as { operationId: string }).operationId, scheduled.operationId);
responseState = "succeeded";
const completed = await service.read({ operationId: scheduled.operationId });
assert.equal(completed.state, "succeeded");
assert.equal(completed.completedAt, "2026-08-27T05:00:02.000Z");
assert.equal(calls.at(-1)?.method, "runtime.restart.read");

const invalidSupervisor: RuntimeLifecycleSupervisorClient = {
  async request<T>(_method, params) {
    return {
      supervisorGeneration: "generation-invalid",
      result: {
        operationId: (params as { operationId: string }).operationId,
        requestHash: "not-a-hash",
        state: "succeeded",
        startedAt: null,
        completedAt: null,
        errorCode: null
      } as T
    };
  }
};
const invalidService = new RuntimeLifecycleService(paths, repositories, invalidSupervisor);
await assert.rejects(
  () => invalidService.read({ operationId: scheduled.operationId }),
  (error: unknown) =>
    error instanceof ServiceError && error.code === "RUNTIME_LIFECYCLE_RESPONSE_INVALID"
);
database.close();
fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("VERIFY_RUNTIME_LIFECYCLE_OK\n");
