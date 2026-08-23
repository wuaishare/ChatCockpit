import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { ContinuityDatabase, continuityDatabasePath } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import {
  GovernanceDatabase,
  governanceDatabasePath,
  LATEST_GOVERNANCE_SCHEMA_VERSION
} from "../src/governance/database.js";
import { OperationalActivityProvenanceRepository } from "../src/governance/operational-activity-provenance-repository.js";
import { OperationalActivityControlEventRepository } from "../src/governance/operational-activity-control-event-repository.js";
import { createJob } from "../src/core/jobs.js";
import { trackJobProcess } from "../src/core/job-processes.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

type SseEvent = { event: string; data: unknown };

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: { buffer: string }
): Promise<SseEvent> {
  const decoder = new TextDecoder();
  for (;;) {
    const boundary = state.buffer.indexOf("\n\n");
    if (boundary >= 0) {
      const frame = state.buffer.slice(0, boundary);
      state.buffer = state.buffer.slice(boundary + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      return { event, data: data.length ? JSON.parse(data.join("\n")) : null };
    }
    const chunk = await reader.read();
    if (chunk.done) throw new Error("SSE stream closed before the expected event");
    state.buffer += decoder.decode(chunk.value, { stream: true });
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-operational-activity-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(root, "README.md"), "# Operational activity fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"),
    path.join(root, "openapi/chatcockpit.openapi.yaml")
  );
  const configPath = path.join(paths.runtimeDir, "fixture-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [root],
    repoMappings: { primary: { path: root } }
  }), "utf8");

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-activities" });
  operatorStore.close();

  const continuity = new ContinuityDatabase({ path: continuityDatabasePath(paths.runtimeDir) });
  const repositories = buildContinuityRepositories(continuity);
  const governance = new GovernanceDatabase({ path: governanceDatabasePath(paths.runtimeDir) });
  assert.equal(governance.schemaVersion(), LATEST_GOVERNANCE_SCHEMA_VERSION);
  governance.close();
  const activityProvenance = new OperationalActivityProvenanceRepository(continuity);
  const project = repositories.projects.create({
    id: "project_activity_fixture",
    slug: "activity-fixture",
    displayName: "Activity Fixture",
    now: "2026-08-19T10:00:00.000Z"
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_activity_fixture",
    projectId: project.id,
    repoId: "primary",
    privatePath: root,
    now: "2026-08-19T10:00:00.000Z"
  });
  const task = repositories.tasks.create({
    id: "task_activity_fixture",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Project-bound task",
    goal: "Verify the project-bound activity projection",
    status: "in-progress",
    now: "2026-08-19T10:01:00.000Z"
  });
  const session = repositories.sessions.create({
    id: "session_activity_fixture",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Codex project activity",
    mode: "codex-session",
    status: "running",
    startedAt: "2026-08-19T10:02:00.000Z"
  });
  activityProvenance.recordFromContext(
    buildOperationContext({
      actorType: "remote-mcp",
      actorId: "grant_session_fixture",
      requestId: "raw-session-request-must-not-persist",
      now: "2026-08-19T10:02:30.000Z"
    }),
    { activityId: session.id, activityKind: "agent-session" }
  );
  const binding = repositories.runtimeBindings.replaceActive({
    id: "runtime_binding_activity_fixture",
    sessionId: session.id,
    workspaceId: workspace.id,
    externalThreadId: "thread_activity_fixture",
    relation: "bound",
    modelProvider: "openai",
    now: "2026-08-19T10:03:00.000Z"
  });
  const evidenceBundle = repositories.evidence.createBundle({
    id: "evidence_activity_fixture",
    taskId: task.id,
    sessionId: session.id,
    now: "2026-08-19T10:03:10.000Z"
  });
  const handoff = repositories.handoffs.create({
    id: "handoff_activity_fixture",
    taskId: task.id,
    sessionId: session.id,
    workspaceId: workspace.id,
    fromMode: "codex-session",
    goal: "Preserve the activity fixture handoff boundary",
    nextAction: "Continue the fixture run",
    evidenceBundleId: evidenceBundle.id,
    now: "2026-08-19T10:03:15.000Z"
  });
  const lease = repositories.leases.acquire({
    id: "lease_activity_fixture",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "codex-session",
    holderId: "runtime_activity_fixture",
    expiresAt: "2026-08-19T10:30:00.000Z",
    now: "2026-08-19T10:03:20.000Z"
  });
  const startingRun = repositories.runtimeRuns.create({
    id: "runtime_run_activity_fixture",
    sessionId: session.id,
    workspaceId: workspace.id,
    runtimeBindingId: binding.id,
    threadId: "thread_activity_fixture",
    inputHash: "activity-fixture-input-hash",
    inputLength: 32,
    handoffId: handoff.id,
    evidenceBundleId: evidenceBundle.id,
    writerLeaseId: lease.id,
    now: "2026-08-19T10:03:30.000Z"
  });
  const runtimeRun = repositories.runtimeRuns.attachTurn(
    startingRun.id,
    "turn_activity_fixture",
    startingRun.revision,
    "2026-08-19T10:03:45.000Z"
  );
  repositories.runtimeEvents.append({
    id: "runtime_event_activity_fixture",
    runId: runtimeRun.id,
    sessionId: session.id,
    workspaceId: workspace.id,
    threadId: "thread_activity_fixture",
    turnId: "turn_activity_fixture",
    method: "turn/started",
    category: "lifecycle",
    publicPayload: { safe: true },
    now: "2026-08-19T10:04:00.000Z"
  });
  const linkedJob = createJob(paths, "codex-run", {
    repoId: "primary",
    title: "Codex project activity",
    instructions: "private fixture instructions must not project",
    continuityTaskId: task.id,
    continuitySessionId: session.id,
    continuityRuntimeBindingId: binding.id
  });
  const hostJob = createJob(paths, "taskpack", {
    title: "Host cleanup activity",
    problem: "private host cleanup detail must not project"
  });
  trackJobProcess(paths, { jobId: hostJob.id, pid: process.pid, label: "Host cleanup worker" });

  const controlEvents = new OperationalActivityControlEventRepository(continuity);
  controlEvents.append(
    buildOperationContext({ actorType: "local-ui", actorId: "owner_activity_fixture", requestId: "timeline-linked-job-control-request", now: "2026-08-19T10:04:30.000Z" }),
    { jobId: linkedJob.id, action: "pause", resultingState: "paused", processRevision: 2 }
  );
  controlEvents.append(
    buildOperationContext({ actorType: "local-ui", actorId: "owner_activity_fixture", requestId: "timeline-host-job-control-request", now: "2026-08-19T10:06:30.000Z" }),
    { jobId: hostJob.id, action: "resume", resultingState: "running", processRevision: 2 }
  );

  activityProvenance.recordFromContext(
    buildOperationContext({
      actorType: "remote-mcp",
      actorId: "grant_job_fixture",
      requestId: "raw-job-request-must-not-persist",
      now: "2026-08-19T10:05:00.000Z"
    }),
    { activityId: linkedJob.id, activityKind: "job" }
  );
  activityProvenance.recordFromContext(
    buildOperationContext({
      actorType: "remote-mcp",
      actorId: "grant_host_fixture",
      requestId: "raw-host-request-must-not-persist",
      now: "2026-08-19T10:06:00.000Z"
    }),
    { activityId: hostJob.id, activityKind: "job" }
  );
  activityProvenance.assignWorker(
    hostJob.id,
    "worker_fixture_01",
    "2026-08-19T10:07:00.000Z"
  );
  continuity.close();

  const original = { ...process.env };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-machine-activities";
  process.env.CHATCOCKPIT_HOST = "0.0.0.0";
  process.env.CHATCOCKPIT_PORT = "5123";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  const app = buildServer(paths, {
    activityStreamPollIntervalMs: 25,
    activityStreamHeartbeatIntervalMs: 50
  });
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/activities" });
    assert.equal(anonymous.statusCode, 401);
    const machine = await app.inject({
      method: "GET",
      url: "/api/activities",
      headers: { authorization: "Bearer test-token-machine-activities" }
    });
    assert.equal(machine.statusCode, 401, machine.body);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-activities" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0];
    const response = await app.inject({
      method: "GET",
      url: "/api/activities",
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      counts: { total: number; active: number };
      activities: Array<Record<string, unknown>>;
    };
    assert.equal(body.counts.total, 2);
    assert.equal(body.counts.active, 2);

    const projectActivity = body.activities.find((item) => item.id === session.id)!;
    assert.equal(projectActivity.kind, "agent-session");
    assert.equal(projectActivity.scope, "workspace");
    assert.equal(projectActivity.projectId, project.id);
    assert.equal(projectActivity.workspaceId, workspace.id);
    assert.equal(projectActivity.taskId, task.id);
    assert.equal(projectActivity.agentSessionId, session.id);
    assert.equal(projectActivity.authorizationGrantId, "grant_job_fixture");
    assert.match(String(projectActivity.traceId), /^trace_[0-9a-f]{32}$/);
    assert.equal(projectActivity.workerInstanceId, null);
    assert.equal((projectActivity.runtime as { runtimeKind: string }).runtimeKind, "codex-app-server");
    assert.equal((projectActivity.runtime as { externalSessionId: string }).externalSessionId, "thread_activity_fixture");
    assert.equal((projectActivity.runtime as { runId: string }).runId, runtimeRun.id);
    assert.equal((projectActivity.runtime as { runRevision: number }).runRevision, runtimeRun.revision);
    assert.equal((projectActivity.runtime as { turnId: string }).turnId, "turn_activity_fixture");
    assert.equal(projectActivity.controls.interrupt, true);
    assert.equal((projectActivity.latestEvent as { kind: string }).kind, "job-paused");
    assert.equal("method" in (projectActivity.latestEvent as Record<string, unknown>), false);
    assert.equal((projectActivity.job as { id: string }).id, linkedJob.id);

    const hostActivity = body.activities.find((item) => item.id === hostJob.id)!;
    assert.equal(hostActivity.kind, "job");
    assert.equal(hostActivity.scope, "host");
    assert.equal(hostActivity.projectId, null);
    assert.equal(hostActivity.workspaceId, null);
    assert.equal(hostActivity.taskId, null);
    assert.equal(hostActivity.agentSessionId, null);
    assert.equal(hostActivity.authorizationGrantId, "grant_host_fixture");
    assert.match(String(hostActivity.traceId), /^trace_[0-9a-f]{32}$/);
    assert.equal(hostActivity.workerInstanceId, "worker_fixture_01");
    assert.equal(hostActivity.title, "Host cleanup activity");
    assert.equal((hostActivity.job as { processRevision: number }).processRevision, 1);
    assert.equal(hostActivity.controls.pause, true);
    assert.equal(hostActivity.controls.resume, false);
    assert.equal(hostActivity.controls.terminate, true);

    assert.equal(response.body.includes("private fixture instructions"), false);
    assert.equal(response.body.includes("private host cleanup detail"), false);
    assert.equal(response.body.includes(root), false);
    assert.equal(response.body.includes("turn/started"), false);
    assert.equal(body.activities.filter((item) => item.id === session.id).length, 1);

    const machineTimeline = await app.inject({ method: "GET", url: `/api/activities/${session.id}/events`, headers: { authorization: "Bearer test-token-machine-activities" } });
    assert.equal(machineTimeline.statusCode, 401, machineTimeline.body);
    const missingTimeline = await app.inject({ method: "GET", url: "/api/activities/missing-activity/events", headers: { cookie } });
    assert.equal(missingTimeline.statusCode, 404, missingTimeline.body);
    const projectTimelineResponse = await app.inject({ method: "GET", url: `/api/activities/${session.id}/events?limit=50`, headers: { cookie } });
    assert.equal(projectTimelineResponse.statusCode, 200, projectTimelineResponse.body);
    const projectTimeline = projectTimelineResponse.json() as { activityId: string; events: Array<Record<string, unknown>> };
    assert.equal(projectTimeline.activityId, session.id);
    assert.deepEqual(projectTimeline.events.map((event) => event.kind), ["run-started", "job-paused"]);
    assert.deepEqual(projectTimeline.events.map((event) => event.source), ["runtime", "job-control"]);
    assert.equal(projectTimelineResponse.body.includes("turn/started"), false);
    assert.equal(projectTimelineResponse.body.includes("timeline-linked-job-control-request"), false);
    assert.equal(projectTimelineResponse.body.includes("owner_activity_fixture"), false);
    const hostTimelineResponse = await app.inject({ method: "GET", url: `/api/activities/${hostJob.id}/events`, headers: { cookie } });
    assert.equal(hostTimelineResponse.statusCode, 200, hostTimelineResponse.body);
    const hostTimeline = hostTimelineResponse.json() as { events: Array<Record<string, unknown>> };
    assert.deepEqual(hostTimeline.events.map((event) => event.kind), ["job-resumed"]);
    assert.equal(hostTimeline.events[0]?.activityId, hostJob.id);

    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const anonymousStream = await fetch(`${baseUrl}/api/activities/stream`);
    assert.equal(anonymousStream.status, 401);
    const machineStream = await fetch(`${baseUrl}/api/activities/stream`, {
      headers: { authorization: "Bearer test-token-machine-activities" }
    });
    assert.equal(machineStream.status, 401);

    const abortStream = new AbortController();
    const streamTimeout = setTimeout(() => abortStream.abort(), 3_000);
    const streamResponse = await fetch(`${baseUrl}/api/activities/stream`, {
      headers: { cookie },
      signal: abortStream.signal
    });
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.equal(streamResponse.headers.get("cache-control"), "no-cache, no-transform");
    const reader = streamResponse.body!.getReader();
    const streamState = { buffer: "" };
    const initialEvent = await readSseEvent(reader, streamState);
    assert.equal(initialEvent.event, "activity.snapshot");
    const initialSnapshot = initialEvent.data as { activities: Array<Record<string, unknown>> };
    const initialHost = initialSnapshot.activities.find((item) => item.id === hostJob.id)!;
    assert.equal(initialHost.workerInstanceId, "worker_fixture_01");

    const streamDatabase = new ContinuityDatabase({
      path: continuityDatabasePath(paths.runtimeDir)
    });
    const streamProvenance = new OperationalActivityProvenanceRepository(streamDatabase);
    streamProvenance.assignWorker(
      hostJob.id,
      "worker_fixture_02",
      "2026-08-19T10:08:00.000Z"
    );
    const streamRepositories = buildContinuityRepositories(streamDatabase);
    streamRepositories.runtimeEvents.append({
      id: "runtime_event_activity_stream_fixture",
      sessionId: session.id,
      workspaceId: workspace.id,
      threadId: "thread_activity_fixture",
      method: "item/completed",
      category: "item",
      publicPayload: { itemType: "commandExecution", privatePath: root },
      now: "2026-08-19T10:09:00.000Z"
    });
    const streamControlEvents = new OperationalActivityControlEventRepository(streamDatabase);
    streamControlEvents.append(
      buildOperationContext({
        actorType: "local-ui",
        actorId: "operator_fixture",
        requestId: "raw-control-request-must-not-project",
        now: "2026-08-19T10:09:30.000Z"
      }),
      {
        jobId: hostJob.id,
        action: "pause",
        resultingState: "paused",
        processRevision: 2
      }
    );
    streamDatabase.close();

    let changedSnapshotSeen = false;
    let activityEventSeen = false;
    let controlEventSeen = false;
    let heartbeatSeen = false;
    for (let index = 0; index < 14 && (!changedSnapshotSeen || !activityEventSeen || !controlEventSeen || !heartbeatSeen); index += 1) {
      const event = await readSseEvent(reader, streamState);
      if (event.event === "heartbeat") heartbeatSeen = true;
      if (event.event === "activity.event") {
        const payload = event.data as { event: Record<string, unknown> };
        assert.equal("method" in payload.event, false);
        assert.equal(JSON.stringify(payload).includes("privatePath"), false);
        assert.equal(JSON.stringify(payload).includes(root), false);
        assert.equal(JSON.stringify(payload).includes("actorIdentityHash"), false);
        assert.equal(JSON.stringify(payload).includes("requestIdentityHash"), false);
        assert.equal(JSON.stringify(payload).includes("raw-control-request-must-not-project"), false);
        if (payload.event.source === "runtime") {
          assert.equal(payload.event.activityId, session.id);
          assert.equal(payload.event.kind, "step-completed");
          assert.equal(payload.event.itemType, "commandExecution");
          activityEventSeen = true;
        }
        if (payload.event.source === "job-control") {
          assert.equal(payload.event.activityId, hostJob.id);
          assert.equal(payload.event.kind, "job-paused");
          assert.equal(payload.event.controlAction, "pause");
          assert.equal(payload.event.resultingState, "paused");
          assert.equal(payload.event.processRevision, 2);
          controlEventSeen = true;
        }
      }
      if (event.event === "activity.snapshot") {
        const snapshot = event.data as { activities: Array<Record<string, unknown>> };
        const host = snapshot.activities.find((item) => item.id === hostJob.id)!;
        if (host.workerInstanceId === "worker_fixture_02") changedSnapshotSeen = true;
        assert.equal(JSON.stringify(event.data).includes("private host cleanup detail"), false);
        assert.equal(JSON.stringify(event.data).includes(root), false);
      }
    }
    assert.equal(changedSnapshotSeen, true, "SSE must emit a changed Activity snapshot");
    assert.equal(activityEventSeen, true, "SSE must emit normalized Runtime Activity event frames");
    assert.equal(controlEventSeen, true, "SSE must emit normalized Job control Activity event frames");
    assert.equal(heartbeatSeen, true, "SSE must emit heartbeat frames");
    clearTimeout(streamTimeout);
    abortStream.abort();
    await reader.cancel().catch(() => undefined);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const sqliteBytes = fs.readFileSync(continuityDatabasePath(paths.runtimeDir));
  assert.equal(sqliteBytes.includes(Buffer.from("raw-session-request-must-not-persist")), false);
  assert.equal(sqliteBytes.includes(Buffer.from("raw-job-request-must-not-persist")), false);
  assert.equal(sqliteBytes.includes(Buffer.from("raw-host-request-must-not-persist")), false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log("VERIFY_OPERATIONAL_ACTIVITY_OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
