import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { RuntimeSessionTerminalService } from "../src/application/runtime-session-terminal-service.ts";
import { reconcileInterruptedChatDirectProcesses } from "../src/application/chat-direct-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { ProcessSupervisorDaemon } from "../src/process-supervisor/index.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const NOW = "2026-09-05T03:30:00.000Z";
const LEASE_EXPIRES_AT = "2099-01-01T00:00:00.000Z";

function context(requestId: string) {
  return {
    requestId,
    actorType: "local-ui" as const,
    actorId: "owner",
    authorizationGrantId: null,
    publicProjection: false,
    now: NOW
  };
}

async function waitForMarker(
  service: RuntimeSessionTerminalService,
  terminalId: string,
  cursor: number,
  marker: string
): Promise<{ cursor: number; output: string }> {
  const deadline = Date.now() + 5_000;
  let nextCursor = cursor;
  let output = "";
  while (Date.now() < deadline) {
    const result = await service.read(
      context(`read-${marker}-${nextCursor}`),
      { terminalId, cursor: nextCursor, limit: 200 }
    );
    nextCursor = result.nextCursor;
    output += result.chunks.map((chunk) => chunk.content).join("");
    if (output.includes(marker)) {
      return { cursor: nextCursor, output };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${marker}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-session-terminal-restart-"));
const workspaceRoot = path.join(root, "workspace");
fs.mkdirSync(workspaceRoot, { recursive: true });
const paths = buildFixturePaths(workspaceRoot);
ensureWorkspaceDirs(paths);

let daemon: ProcessSupervisorDaemon | null = null;
let database1: ContinuityDatabase | null = null;
let database2: ContinuityDatabase | null = null;
try {
  const seedDatabase = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const seed = buildContinuityRepositories(seedDatabase);
  const project = seed.projects.create({
    id: "project_session_terminal_restart",
    slug: "session-terminal-restart",
    displayName: "Session Terminal Restart Proof",
    now: NOW
  });
  const workspace = seed.workspaces.create({
    id: "workspace_session_terminal_restart",
    projectId: project.id,
    repoId: "primary",
    privatePath: workspaceRoot,
    now: NOW
  });
  const task = seed.tasks.create({
    id: "task_session_terminal_restart",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Persistent session terminal restart proof",
    goal: "Prove PTY survives ChatCockpit Control Plane reconstruction",
    status: "in-progress",
    now: NOW
  });
  const session = seed.sessions.create({
    id: "session_session_terminal_restart",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Persistent session terminal restart proof",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  seed.tasks.bindSession(task.id, session.id, task.revision, NOW);
  seed.leases.acquire({
    id: "lease_session_terminal_restart",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: LEASE_EXPIRES_AT,
    now: NOW
  });
  seedDatabase.close();

  daemon = new ProcessSupervisorDaemon(paths, {
    generationFactory: () => "generation-session-terminal-restart",
    heartbeatIntervalMs: 100,
    watchdogIntervalMs: 100
  });
  await daemon.start();
  assert.equal(daemon.generation, "generation-session-terminal-restart");

  database1 = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories1 = buildContinuityRepositories(database1);
  const service1 = RuntimeSessionTerminalService.forPaths(repositories1, paths);
  const started = await service1.start(context("start-before-restart"), {
    sessionId: session.id,
    rows: 24,
    cols: 80,
    idempotencyKey: "terminal-start-before-restart"
  });
  assert.equal(started.state, "running");
  assert.equal(started.supervisorGeneration, "generation-session-terminal-restart");
  assert.match(started.terminalId, /^session_terminal_/);
  assert.ok(started.privatePid > 0);

  await service1.input(context("input-before-restart"), {
    terminalId: started.terminalId,
    expectedRevision: started.processRevision,
    input: "printf '__BEFORE_RESTART__\\n'\r",
    idempotencyKey: "terminal-input-before-restart"
  });
  const before = await waitForMarker(
    service1,
    started.terminalId,
    0,
    "__BEFORE_RESTART__"
  );
  assert.ok(before.cursor > 0);

  database1.close();
  database1 = null;

  // Mirrors the 4318 startup reconciliation. Durable session_terminal_* records
  // must not be treated as orphaned in-memory Chat Direct commands.
  database2 = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories2 = buildContinuityRepositories(database2);
  assert.equal(reconcileInterruptedChatDirectProcesses(repositories2, NOW), 0);
  const preservedRecord = repositories2.directProcessSessions.get(started.terminalId);
  assert.equal(preservedRecord.status, "running");

  const service2 = RuntimeSessionTerminalService.forPaths(repositories2, paths);
  const recovered = await service2.start(context("recover-after-restart"), {
    sessionId: session.id,
    rows: 24,
    cols: 80,
    idempotencyKey: "terminal-recover-after-restart"
  });
  assert.equal(recovered.terminalId, started.terminalId);
  assert.equal(recovered.privatePid, started.privatePid);
  assert.equal(recovered.supervisorGeneration, started.supervisorGeneration);
  assert.equal(recovered.state, "running");

  const retained = await service2.read(context("read-retained-scrollback"), {
    terminalId: started.terminalId,
    cursor: 0,
    limit: 200
  });
  assert.match(
    retained.chunks.map((chunk) => chunk.content).join(""),
    /__BEFORE_RESTART__/
  );

  await service2.input(context("input-after-restart"), {
    terminalId: recovered.terminalId,
    expectedRevision: recovered.processRevision,
    input: "printf '__AFTER_RESTART__\\n'\r",
    idempotencyKey: "terminal-input-after-restart"
  });
  const after = await waitForMarker(
    service2,
    recovered.terminalId,
    before.cursor,
    "__AFTER_RESTART__"
  );
  assert.ok(after.cursor >= before.cursor);

  const resized = await service2.resize(context("resize-after-restart"), {
    terminalId: recovered.terminalId,
    expectedRevision: recovered.processRevision,
    rows: 36,
    cols: 132,
    idempotencyKey: "terminal-resize-after-restart"
  });
  assert.equal(resized.rows, 36);
  assert.equal(resized.cols, 132);

  const stopped = await service2.stop(context("stop-after-restart"), {
    terminalId: recovered.terminalId,
    expectedRevision: recovered.processRevision,
    idempotencyKey: "terminal-stop-after-restart"
  });
  assert.equal(stopped.state, "terminated");
  assert.equal(
    repositories2.directProcessSessions.get(recovered.terminalId).status,
    "terminated"
  );
  assert.equal(
    repositories2.directProcessRuntimeOwnership.get(recovered.terminalId),
    null
  );

  process.stdout.write("VERIFY_SESSION_TERMINAL_CONTROL_PLANE_RESTART_OK\n");
} finally {
  database1?.close();
  database2?.close();
  await daemon?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
