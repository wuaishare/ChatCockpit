import assert from "node:assert/strict";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const NOW = "2026-08-09T06:50:00.000Z";

const database = new ContinuityDatabase({ path: ":memory:" });
try {
  const repositories = buildContinuityRepositories(database);

  assert.equal(database.schemaVersion(), 13);
  assert.ok(repositories.directProcessRuntimeOwnership);

  const project = repositories.projects.create({
    id: "project_durable_process",
    slug: "durable-process",
    displayName: "Durable Process",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_durable_process",
    projectId: project.id,
    repoId: "durable-process-fixture",
    privatePath: process.cwd(),
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_durable_process",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Durable Process Fixture",
    goal: "Verify supervisor runtime ownership persistence",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_durable_process",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Durable Process Session",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  const lease = repositories.leases.acquire({
    id: "lease_durable_process",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: "2026-08-09T07:20:00.000Z",
    now: NOW
  });
  const managedReservation = repositories.directProcessSessions.createStarting({
    id: "host_process_durable_managed",
    rootId: "workspace-root",
    workdir: ".",
    command: "node",
    commandHash: "0".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  const managed = repositories.directProcessSessions.attachManaged({
    id: managedReservation.id,
    expectedRevision: managedReservation.revision
  });
  assert.equal(managed.status, "running");
  assert.equal(managed.privatePid, null);

  repositories.directProcessSessions.createRunning({
    id: "host_process_durable_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "node",
    commandHash: "1".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 4242,
    now: NOW
  });

  const attached = repositories.directProcessRuntimeOwnership.attach({
    processId: "host_process_durable_fixture",
    supervisorGeneration: "generation-a",
    now: NOW
  });
  assert.equal(attached.processId, "host_process_durable_fixture");
  assert.equal(attached.supervisorGeneration, "generation-a");
  assert.equal(attached.revision, 1);
  assert.equal("privatePid" in attached, false);

  const seen = repositories.directProcessRuntimeOwnership.touch({
    processId: attached.processId,
    supervisorGeneration: attached.supervisorGeneration,
    expectedRevision: attached.revision,
    now: "2026-08-09T06:51:00.000Z"
  });
  assert.equal(seen.revision, 2);
  assert.equal(seen.lastSeenAt, "2026-08-09T06:51:00.000Z");

  const replay = repositories.directProcessRuntimeOwnership.attach({
    processId: attached.processId,
    supervisorGeneration: attached.supervisorGeneration,
    now: "2026-08-09T06:52:00.000Z"
  });
  assert.equal(replay.processId, attached.processId);
  assert.equal(replay.supervisorGeneration, attached.supervisorGeneration);

  assert.throws(
    () =>
      repositories.directProcessRuntimeOwnership.attach({
        processId: attached.processId,
        supervisorGeneration: "generation-b",
        now: NOW
      }),
    /generation|ownership|already/i
  );

  const released = repositories.directProcessRuntimeOwnership.release({
    processId: attached.processId,
    supervisorGeneration: attached.supervisorGeneration,
    expectedRevision: replay.revision
  });
  assert.equal(released, true);
  assert.equal(
    repositories.directProcessRuntimeOwnership.get(attached.processId),
    null
  );

  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  process.stdout.write("VERIFY_DURABLE_HOST_PROCESS_OK\n");
} finally {
  database.close();
}
