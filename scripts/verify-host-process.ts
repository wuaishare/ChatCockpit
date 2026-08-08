import assert from "node:assert/strict";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const NOW = "2026-08-09T00:30:00.000Z";
const EXPIRES = "2026-08-09T00:35:00.000Z";
const LATER = "2026-08-09T00:40:00.000Z";

const database = new ContinuityDatabase({ path: ":memory:" });

try {
  const repositories = buildContinuityRepositories(database);
  assert.equal(database.schemaVersion(), 10);
  assert.ok(repositories.directProcessSessions);
  assert.ok(repositories.directProcessApprovals);
  assert.ok(repositories.directProcessAudit);

  const project = repositories.projects.create({
    id: "project_host_process",
    slug: "host-process",
    displayName: "Host Process",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_host_process",
    projectId: project.id,
    repoId: "host-process-fixture",
    privatePath: process.cwd(),
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_host_process",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Host Process Fixture",
    goal: "Verify Host Process persistence",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_host_process",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Host Process Session",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  const lease = repositories.leases.acquire({
    id: "lease_host_process",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: "2026-08-09T01:00:00.000Z",
    now: NOW
  });

  const startApproval = repositories.directProcessApprovals.create({
    id: "process_approval_start",
    operation: "start",
    actionHash: "a".repeat(64),
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    publicSummary: { operation: "start", command: "npm", argsCount: 1 },
    expiresAt: EXPIRES,
    now: NOW
  });
  assert.equal(startApproval.status, "pending");
  const approvedStart = repositories.directProcessApprovals.decide({
    id: startApproval.id,
    decision: "approved",
    expectedRevision: startApproval.revision,
    now: NOW
  });
  assert.equal(approvedStart.status, "approved");
  const consumedStart = repositories.directProcessApprovals.consume({
    id: approvedStart.id,
    expectedRevision: approvedStart.revision,
    now: NOW
  });
  assert.equal(consumedStart.status, "consumed");

  const deniedApproval = repositories.directProcessApprovals.create({
    id: "process_approval_denied",
    operation: "start",
    actionHash: "b".repeat(64),
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    publicSummary: { operation: "start" },
    expiresAt: EXPIRES,
    now: NOW
  });
  const denied = repositories.directProcessApprovals.decide({
    id: deniedApproval.id,
    decision: "denied",
    expectedRevision: deniedApproval.revision,
    now: NOW
  });
  assert.equal(denied.status, "denied");

  const expiringApproval = repositories.directProcessApprovals.create({
    id: "process_approval_expired",
    operation: "start",
    actionHash: "c".repeat(64),
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    publicSummary: { operation: "start" },
    expiresAt: EXPIRES,
    now: NOW
  });
  const approvedExpiring = repositories.directProcessApprovals.decide({
    id: expiringApproval.id,
    decision: "approved",
    expectedRevision: expiringApproval.revision,
    now: NOW
  });
  assert.equal(approvedExpiring.status, "approved");
  assert.equal(
    repositories.directProcessApprovals.expireIfNeeded(
      approvedExpiring.id,
      LATER
    ).status,
    "expired"
  );

  const running = repositories.directProcessSessions.createRunning({
    id: "host_process_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    commandHash: "d".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 4242,
    now: NOW
  });
  assert.equal(running.status, "running");
  assert.equal(running.privatePid, 4242);
  assert.equal(
    repositories.directProcessSessions.countRunning({
      workspaceId: workspace.id
    }),
    1
  );
  assert.equal(
    repositories.directProcessSessions.list({ sessionId: session.id }).length,
    1
  );

  const inputApproval = repositories.directProcessApprovals.create({
    id: "process_approval_input",
    operation: "input",
    processId: running.id,
    actionHash: "e".repeat(64),
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    inputHash: "f".repeat(64),
    inputBytes: 7,
    publicSummary: { operation: "input", inputBytes: 7 },
    expiresAt: EXPIRES,
    now: NOW
  });
  assert.equal(inputApproval.inputHash, "f".repeat(64));
  assert.equal(inputApproval.inputBytes, 7);
  assert.doesNotMatch(JSON.stringify(inputApproval), /secret-input-value/);

  const completed = repositories.directProcessSessions.complete({
    id: running.id,
    status: "exited",
    exitCode: 0,
    expectedRevision: running.revision,
    now: LATER
  });
  assert.equal(completed.status, "exited");
  assert.equal(completed.exitCode, 0);
  assert.equal(completed.completedAt, LATER);

  const staleCandidate = repositories.directProcessSessions.createRunning({
    id: "host_process_stale_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    commandHash: "1".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 4343,
    now: NOW
  });
  const stale = repositories.directProcessSessions.markStale({
    id: staleCandidate.id,
    reason: "CONTROL_PLANE_RESTART",
    expectedRevision: staleCandidate.revision,
    now: LATER
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.staleReason, "CONTROL_PLANE_RESTART");
  assert.equal(repositories.directProcessSessions.countRunning(), 0);

  const externalAudit = repositories.directProcessAudit.create({
    id: "process_audit_external",
    operation: "input",
    processId: running.id,
    actionHash: inputApproval.actionHash,
    approvalId: inputApproval.id,
    status: "succeeded",
    outputBytes: 12,
    outputTruncated: false,
    startedAt: NOW,
    completedAt: LATER,
    now: LATER
  });
  assert.equal(externalAudit.approvalId, inputApproval.id);
  assert.equal(externalAudit.outputBytes, 12);

  const cleanupAudit = repositories.directProcessAudit.create({
    id: "process_audit_cleanup",
    operation: "cleanup",
    processId: stale.id,
    actionHash: "2".repeat(64),
    approvalId: null,
    status: "unknown",
    terminalReason: "CONTROL_PLANE_RESTART",
    startedAt: NOW,
    completedAt: LATER,
    now: LATER
  });
  assert.equal(cleanupAudit.approvalId, null);
  assert.equal(cleanupAudit.terminalReason, "CONTROL_PLANE_RESTART");
  assert.equal(repositories.directProcessAudit.listByProcess(stale.id).length, 1);
  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);

  process.stdout.write("VERIFY_HOST_PROCESS_OK\n");
} finally {
  database.close();
}
