import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { RuntimeApprovalService } from "../src/application/runtime-approval-service.ts";
import { RuntimeBindingService } from "../src/application/runtime-binding-service.ts";
import { RuntimeEventService } from "../src/application/runtime-event-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { RuntimeTurnService } from "../src/application/runtime-turn-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type { CodexBinaryResolution } from "../src/runtime/codex/binary.ts";
import { runGit } from "./test-support/git.ts";
import { waitForValue } from "./test-support/wait.ts";

function mockResolution(command: string): CodexBinaryResolution {
  return {
    command,
    source: "configured",
    version: "codex-cli mock-app-server-1.0.0",
    attempts: [
      {
        source: "configured",
        available: true,
        reason: "codex-cli mock-app-server-1.0.0"
      }
    ]
  };
}

async function verifyCodexExecution(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-codex-execution-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const nestedWorkspaceRoot = path.join(workspaceRoot, ".worktrees", "feature");
  const configPath = path.join(tempRoot, "config.json");
  const tracePath = path.join(tempRoot, "app-server-trace.jsonl");
  const fixturePath = path.join(
    process.cwd(),
    "scripts",
    "fixtures",
    "mock-codex-app-server.mjs"
  );
  fs.mkdirSync(nestedWorkspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# Execution fixture\n", "utf8");
  runGit(workspaceRoot, ["init", "-b", "main"]);
  runGit(workspaceRoot, ["config", "user.email", "chatcockpit@example.invalid"]);
  runGit(workspaceRoot, ["config", "user.name", "ChatCockpit Test"]);
  runGit(workspaceRoot, ["add", "README.md"]);
  runGit(workspaceRoot, ["commit", "-m", "Initial fixture"]);
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [workspaceRoot],
        repoMappings: {
          primary: { path: workspaceRoot }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  const paths = buildPaths(workspaceRoot);
  const database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_execution",
    slug: "execution-fixture",
    displayName: "Execution Fixture"
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_execution",
    projectId: project.id,
    repoId: "primary",
    privatePath: workspaceRoot,
    kind: "checkout",
    branch: "main",
    status: "ready"
  });
  const task = repositories.tasks.create({
    id: "task_execution",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Verify explicit Codex execution",
    goal: "Exercise turn, approval, event, and interrupt controls",
    status: "in-progress"
  });
  const session = repositories.sessions.create({
    id: "session_execution",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Explicit Codex execution",
    mode: "codex-session",
    status: "running"
  });

  const env = {
    ...process.env,
    CHATCOCKPIT_MOCK_WORKSPACE_ROOT: workspaceRoot,
    CHATCOCKPIT_MOCK_NESTED_WORKSPACE_ROOT: nestedWorkspaceRoot,
    CHATCOCKPIT_MOCK_APP_SERVER_TRACE: tracePath
  };
  const adapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces,
    resolveBinary: () => mockResolution(process.execPath),
    createClient: () =>
      new CodexAppServerClient({
        command: process.execPath,
        args: [fixturePath],
        env,
        requestTimeoutMs: 3_000
      })
  });
  const runtime = new RuntimeRouter(adapter);
  const bindingService = new RuntimeBindingService(repositories, runtime);
  const eventService = new RuntimeEventService(repositories, runtime);
  const turnService = new RuntimeTurnService(paths, repositories, runtime);
  const approvalService = new RuntimeApprovalService(repositories, runtime);
  const context = buildOperationContext({
    actorType: "local-ui",
    requestId: "verify-codex-execution",
    publicProjection: true
  });
  eventService.attach();

  try {
    const bound = await bindingService.bind(context, {
      sessionId: session.id,
      threadId: "thread_root",
      expectedSessionRevision: session.revision,
      idempotencyKey: "execution-bind-0001"
    });
    const turnInput = {
      sessionId: session.id,
      text: "Inspect the repository status and continue the verified task.",
      expectedSessionRevision: bound.session.revision,
      expectedTaskRevision: task.revision,
      leaseDurationSeconds: 900,
      idempotencyKey: "execution-turn-start-0001"
    } as const;
    const started = await turnService.start(context, turnInput);
    assert.equal(started.replayed, false);
    assert.equal(started.run.externalTurnId, "turn_mock_1");
    assert.equal(started.run.status, "running");
    assert.equal(started.lease.status, "active");
    assert.equal(started.handoff.status, "accepted");
    assert.equal(started.turn.status, "inProgress");

    const approval = await waitForValue(
      () => repositories.runtimeApprovals.listPending(session.id)[0] ?? null,
      { label: "command approval", intervalMs: 10 }
    );
    assert.equal(approval.kind, "command-execution");
    assert.equal(approval.status, "pending");
    assert.match(String(approval.publicSummary.command), /<workspace-root>/);
    assert.doesNotMatch(JSON.stringify(approval), new RegExp(tempRoot));
    assert.equal(repositories.runtimeRuns.get(started.run.id).status, "waiting-approval");
    assert.equal(repositories.sessions.get(session.id).status, "waiting-approval");

    const approvalResult = await approvalService.respond(context, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "accept",
      idempotencyKey: "execution-approval-0001"
    });
    assert.equal(approvalResult.replayed, false);
    const completedRun = await waitForValue(
      () => {
        const current = repositories.runtimeRuns.get(started.run.id);
        return current.status === "completed" ? current : null;
      },
      { label: "completed Codex run", intervalMs: 10 }
    );
    assert.equal(completedRun.status, "completed");
    assert.equal(repositories.leases.get(completedRun.writerLeaseId).status, "released");
    assert.equal(repositories.sessions.get(session.id).status, "handoff-ready");
    assert.equal(
      repositories.evidence.getBundle(completedRun.evidenceBundleId).status,
      "complete"
    );
    const resolvedApproval = repositories.runtimeApprovals.get(approval.id);
    assert.equal(resolvedApproval.status, "resolved");
    assert.deepEqual(resolvedApproval.decision, { decision: "accept" });

    const events = eventService.read(context, {
      sessionId: session.id,
      limit: 200
    });
    assert.equal(events.events.some((event) => event.method === "turn/start"), true);
    assert.equal(
      events.events.some(
        (event) => event.method === "item/commandExecution/requestApproval"
      ),
      true
    );
    assert.equal(events.events.some((event) => event.method === "turn/completed"), true);
    const publicEvents = JSON.stringify(events);
    assert.doesNotMatch(publicEvents, new RegExp(tempRoot));
    assert.doesNotMatch(
      publicEvents,
      /instructionSources|private_request_json|commandExecution\/outputDelta/
    );

    const replay = await turnService.start(context, turnInput);
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.id, started.run.id);

    const secondTask = repositories.tasks.create({
      id: "task_interrupt",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Verify Codex interrupt",
      goal: "Interrupt one explicit model loop",
      status: "in-progress"
    });
    const secondSession = repositories.sessions.create({
      id: "session_interrupt",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: secondTask.id,
      title: "Codex interrupt",
      mode: "codex-session",
      status: "running"
    });
    const secondBinding = await bindingService.bind(context, {
      sessionId: secondSession.id,
      threadId: "thread_nested",
      expectedSessionRevision: secondSession.revision,
      idempotencyKey: "execution-bind-0002"
    });
    const secondStart = await turnService.start(context, {
      sessionId: secondSession.id,
      text: "Begin work that will be interrupted explicitly.",
      expectedSessionRevision: secondBinding.session.revision,
      expectedTaskRevision: secondTask.revision,
      leaseDurationSeconds: 900,
      idempotencyKey: "execution-turn-start-0002"
    });
    const currentSecondRun = repositories.runtimeRuns.get(secondStart.run.id);
    const interrupted = await turnService.interrupt(context, {
      runId: currentSecondRun.id,
      expectedRunRevision: currentSecondRun.revision,
      idempotencyKey: "execution-turn-interrupt-0001"
    });
    assert.equal(interrupted.run.status, "interrupted");
    assert.equal(interrupted.lease.status, "released");
    assert.equal(interrupted.session.status, "handoff-ready");

    const traces = fs
      .readFileSync(tracePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const turnStarts = traces.filter((entry) => entry.method === "turn/start");
    assert.equal(turnStarts.length, 2);
    const firstStartParams = turnStarts[0]?.params as Record<string, unknown>;
    assert.equal(firstStartParams.approvalPolicy, "on-request");
    assert.equal(firstStartParams.approvalsReviewer, "user");
    for (const forbidden of [
      "cwd",
      "sandboxPolicy",
      "model",
      "baseInstructions",
      "developerInstructions"
    ]) {
      assert.equal(forbidden in firstStartParams, false);
    }
    const approvalResponses = traces.filter(
      (entry) => entry.method === undefined && entry.result !== undefined
    );
    assert.equal(
      approvalResponses.some(
        (entry) =>
          JSON.stringify(entry.result) === JSON.stringify({ decision: "accept" })
      ),
      true
    );
    assert.equal(
      traces.some((entry) => entry.method === "turn/start" && entry.idempotencyKey),
      false
    );
  } finally {
    eventService.detach();
    await runtime.close();
    database.close();
    if (originalConfigPath === undefined) {
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
    }
  }
}

await verifyCodexExecution();
process.stdout.write("VERIFY_CODEX_EXECUTION_OK\n");
