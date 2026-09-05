import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.ts";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import { ProcessSupervisorDaemon } from "../src/process-supervisor/index.ts";
import type { CodingRuntimeAdapter } from "../src/runtime/codex/runtime-adapter.ts";
import { buildServer } from "../src/server/app.ts";
import { OPERATOR_CSRF_HEADER } from "../src/server/operator-auth-context.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const NOW = "2026-09-05T04:00:00.000Z";
const LEASE_EXPIRES_AT = "2099-01-01T00:00:00.000Z";
const OWNER_PASSWORD = "session-terminal-test-password";

function codexAdapter(): CodingRuntimeAdapter {
  return {
    setEventSink() {},
    async close() {}
  } as unknown as CodingRuntimeAdapter;
}

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(value, "Operator login must set a cookie");
  return value.split(";", 1)[0]!;
}

async function login(app: ReturnType<typeof buildServer>): Promise<{ cookie: string; csrf: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/operator/login",
    payload: { username: "owner", password: OWNER_PASSWORD }
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as { csrfToken: string };
  return {
    cookie: cookiePair(response.headers["set-cookie"]),
    csrf: body.csrfToken
  };
}

function mutationHeaders(auth: { cookie: string; csrf: string }) {
  return {
    cookie: auth.cookie,
    [OPERATOR_CSRF_HEADER]: auth.csrf,
    "content-type": "application/json"
  };
}

async function waitForMarker(
  app: ReturnType<typeof buildServer>,
  auth: { cookie: string; csrf: string },
  terminalId: string,
  cursor: number,
  marker: string
): Promise<{ cursor: number; output: string }> {
  const deadline = Date.now() + 5_000;
  let nextCursor = cursor;
  let output = "";
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/api/runtime/executions/terminals/${terminalId}/output?cursor=${nextCursor}&limit=200`,
      headers: { cookie: auth.cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      nextCursor: number;
      chunks: Array<{ content: string }>;
    };
    nextCursor = body.nextCursor;
    output += body.chunks.map((chunk) => chunk.content).join("");
    if (output.includes(marker)) return { cursor: nextCursor, output };
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${marker}`);
}

async function waitForListedTerminalState(
  app: ReturnType<typeof buildServer>,
  auth: { cookie: string; csrf: string },
  sessionId: string,
  terminalId: string,
  state: string
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/api/runtime/executions/terminals?sessionId=${encodeURIComponent(sessionId)}`,
      headers: { cookie: auth.cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      terminals: Array<{ terminalId: string; state: string }>;
    };
    if (body.terminals.find((terminal) => terminal.terminalId === terminalId)?.state === state) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out waiting for terminal ${terminalId} state=${state}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-session-terminal-http-restart-"));
const workspaceRoot = path.join(root, "workspace");
fs.mkdirSync(workspaceRoot, { recursive: true });
const paths = buildFixturePaths(workspaceRoot);
ensureWorkspaceDirs(paths);
const primaryRootId = rootIdForRepoId("primary");
const configPath = path.join(paths.runtimeDir, "session-terminal-http-config.json");
fs.writeFileSync(
  configPath,
  `${JSON.stringify({
    schemaVersion: 3,
    workspaceDiscoveryRoots: [],
    workspaceAllowlist: [workspaceRoot],
    projects: {
      primary: {
        displayName: "Primary",
        primaryRootId,
        rootIds: [primaryRootId]
      }
    },
    projectRoots: {
      [primaryRootId]: {
        path: workspaceRoot,
        kind: "git-repository",
        role: "primary-source",
        access: "read-write"
      }
    },
    executionWorkspaces: {
      primary: {
        projectRootId: primaryRootId,
        path: workspaceRoot,
        kind: "checkout",
        provenance: "registered"
      }
    }
  }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 }
);

const originalEnv = {
  configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
  exposed: process.env.CHATCOCKPIT_EXPOSED,
  token: process.env.CHATCOCKPIT_API_TOKEN
};
process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
process.env.CHATCOCKPIT_EXPOSED = "false";
process.env.CHATCOCKPIT_API_TOKEN = "session-terminal-http-test-token";

let daemon: ProcessSupervisorDaemon | null = null;
let app1: ReturnType<typeof buildServer> | null = null;
let app2: ReturnType<typeof buildServer> | null = null;
try {
  const schemaDatabase = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  schemaDatabase.close();

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: OWNER_PASSWORD });
  operatorStore.close();

  daemon = new ProcessSupervisorDaemon(paths, {
    generationFactory: () => "generation-session-terminal-http-restart",
    heartbeatIntervalMs: 100,
    watchdogIntervalMs: 60_000
  });
  await daemon.start();

  app1 = buildServer(paths, { codexAdapter: codexAdapter() });
  await app1.ready();

  const fixtureDatabase = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(fixtureDatabase);
  const project = repositories.projects.create({
    id: "project_session_terminal_http_restart",
    slug: "session-terminal-http-restart",
    displayName: "Session Terminal HTTP Restart Proof",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_session_terminal_http_restart",
    projectId: project.id,
    repoId: "terminal-http-fixture",
    privatePath: workspaceRoot,
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_session_terminal_http_restart",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Session terminal HTTP restart proof",
    goal: "Prove durable PTY survives Fastify Control Plane restart",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_session_terminal_http_restart",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Session terminal HTTP restart proof",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  repositories.leases.acquire({
    id: "lease_session_terminal_http_restart",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: LEASE_EXPIRES_AT,
    now: NOW
  });
  fixtureDatabase.close();

  const auth1 = await login(app1);
  const startResponse = await app1.inject({
    method: "POST",
    url: "/api/runtime/executions/terminals",
    headers: mutationHeaders(auth1),
    payload: {
      sessionId: session.id,
      rows: 24,
      cols: 80,
      idempotencyKey: "terminal-http-start-before-restart"
    }
  });
  assert.equal(startResponse.statusCode, 200, startResponse.body);
  const started = startResponse.json() as {
    terminalId: string;
    processRevision: number;
    privatePid: number;
    supervisorGeneration: string;
    state: string;
  };
  assert.equal(started.state, "running");
  assert.equal(started.supervisorGeneration, "generation-session-terminal-http-restart");

  const terminalListBefore = await app1.inject({
    method: "GET",
    url: `/api/runtime/executions/terminals?sessionId=${encodeURIComponent(session.id)}`,
    headers: { cookie: auth1.cookie }
  });
  assert.equal(terminalListBefore.statusCode, 200, terminalListBefore.body);
  const terminalListBeforeBody = terminalListBefore.json() as {
    terminals: Array<{ terminalId: string; state: string }>;
  };
  assert.equal(terminalListBeforeBody.terminals[0]?.terminalId, started.terminalId);
  assert.equal(terminalListBeforeBody.terminals[0]?.state, "running");

  const observabilityBefore = await app1.inject({
    method: "GET",
    url: "/api/runtime/executions",
    headers: { cookie: auth1.cookie }
  });
  assert.equal(observabilityBefore.statusCode, 200, observabilityBefore.body);
  const observabilityBeforeBody = observabilityBefore.json() as {
    processes: Array<{ id: string; executorId: string }>;
  };
  assert.equal(
    observabilityBeforeBody.processes.some((process) => process.id === started.terminalId),
    false,
    "Native session terminals must not leak into generic managed-process observability"
  );

  const inputBefore = await app1.inject({
    method: "POST",
    url: `/api/runtime/executions/terminals/${started.terminalId}/input`,
    headers: mutationHeaders(auth1),
    payload: {
      expectedRevision: started.processRevision,
      input: "printf '__HTTP_BEFORE_RESTART__\\n'\r",
      idempotencyKey: "terminal-http-input-before-restart"
    }
  });
  assert.equal(inputBefore.statusCode, 200, inputBefore.body);
  const before = await waitForMarker(
    app1,
    auth1,
    started.terminalId,
    0,
    "__HTTP_BEFORE_RESTART__"
  );

  await app1.close();
  app1 = null;

  app2 = buildServer(paths, { codexAdapter: codexAdapter() });
  await app2.ready();
  const auth2 = await login(app2);

  const attachedAfterRestart = await app2.inject({
    method: "GET",
    url: `/api/runtime/executions/terminals?sessionId=${encodeURIComponent(session.id)}`,
    headers: { cookie: auth2.cookie }
  });
  assert.equal(attachedAfterRestart.statusCode, 200, attachedAfterRestart.body);
  const attachedAfterRestartBody = attachedAfterRestart.json() as {
    terminals: Array<{
      terminalId: string;
      privatePid: number;
      supervisorGeneration: string;
      state: string;
    }>;
  };
  assert.equal(attachedAfterRestartBody.terminals[0]?.terminalId, started.terminalId);
  assert.equal(attachedAfterRestartBody.terminals[0]?.privatePid, started.privatePid);
  assert.equal(
    attachedAfterRestartBody.terminals[0]?.supervisorGeneration,
    started.supervisorGeneration
  );
  assert.equal(attachedAfterRestartBody.terminals[0]?.state, "running");

  const recoverResponse = await app2.inject({
    method: "POST",
    url: "/api/runtime/executions/terminals",
    headers: mutationHeaders(auth2),
    payload: {
      sessionId: session.id,
      rows: 24,
      cols: 80,
      idempotencyKey: "terminal-http-recover-after-restart"
    }
  });
  assert.equal(recoverResponse.statusCode, 200, recoverResponse.body);
  const recovered = recoverResponse.json() as typeof started;
  assert.equal(recovered.terminalId, started.terminalId);
  assert.equal(recovered.privatePid, started.privatePid);
  assert.equal(recovered.supervisorGeneration, started.supervisorGeneration);
  assert.equal(recovered.state, "running");

  const retainedResponse = await app2.inject({
    method: "GET",
    url: `/api/runtime/executions/terminals/${started.terminalId}/output?cursor=0&limit=200`,
    headers: { cookie: auth2.cookie }
  });
  assert.equal(retainedResponse.statusCode, 200, retainedResponse.body);
  const retained = retainedResponse.json() as { chunks: Array<{ content: string }> };
  assert.match(
    retained.chunks.map((chunk) => chunk.content).join(""),
    /__HTTP_BEFORE_RESTART__/
  );

  const inputAfter = await app2.inject({
    method: "POST",
    url: `/api/runtime/executions/terminals/${recovered.terminalId}/input`,
    headers: mutationHeaders(auth2),
    payload: {
      expectedRevision: recovered.processRevision,
      input: "printf '__HTTP_AFTER_RESTART__\\n'\r",
      idempotencyKey: "terminal-http-input-after-restart"
    }
  });
  assert.equal(inputAfter.statusCode, 200, inputAfter.body);
  await waitForMarker(
    app2,
    auth2,
    recovered.terminalId,
    before.cursor,
    "__HTTP_AFTER_RESTART__"
  );

  const naturalExit = await app2.inject({
    method: "POST",
    url: `/api/runtime/executions/terminals/${recovered.terminalId}/input`,
    headers: mutationHeaders(auth2),
    payload: {
      expectedRevision: recovered.processRevision,
      input: "exit\r",
      idempotencyKey: "terminal-http-natural-exit"
    }
  });
  assert.equal(naturalExit.statusCode, 200, naturalExit.body);
  await waitForListedTerminalState(
    app2,
    auth2,
    session.id,
    recovered.terminalId,
    "exited"
  );

  const restartAfterNaturalExit = await app2.inject({
    method: "POST",
    url: "/api/runtime/executions/terminals",
    headers: mutationHeaders(auth2),
    payload: {
      sessionId: session.id,
      rows: 30,
      cols: 100,
      idempotencyKey: "terminal-http-restart-after-natural-exit"
    }
  });
  assert.equal(restartAfterNaturalExit.statusCode, 200, restartAfterNaturalExit.body);
  const restarted = restartAfterNaturalExit.json() as typeof started;
  assert.notEqual(restarted.terminalId, recovered.terminalId);
  assert.equal(restarted.state, "running");
  assert.equal(restarted.supervisorGeneration, recovered.supervisorGeneration);

  const terminate = await app2.inject({
    method: "POST",
    url: `/api/runtime/executions/terminals/${restarted.terminalId}/terminate`,
    headers: mutationHeaders(auth2),
    payload: {
      expectedRevision: restarted.processRevision,
      idempotencyKey: "terminal-http-stop-restarted-terminal"
    }
  });
  assert.equal(terminate.statusCode, 200, terminate.body);
  assert.equal((terminate.json() as { state: string }).state, "terminated");

  process.stdout.write("VERIFY_SESSION_TERMINAL_HTTP_RESTART_OK\n");
} finally {
  await app1?.close();
  await app2?.close();
  await daemon?.close();
  if (originalEnv.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = originalEnv.configPath;
  if (originalEnv.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
  else process.env.CHATCOCKPIT_EXPOSED = originalEnv.exposed;
  if (originalEnv.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
  else process.env.CHATCOCKPIT_API_TOKEN = originalEnv.token;
  fs.rmSync(root, { recursive: true, force: true });
}
