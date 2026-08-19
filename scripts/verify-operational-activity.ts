import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ContinuityDatabase, continuityDatabasePath } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { createJob } from "../src/core/jobs.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

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
  const binding = repositories.runtimeBindings.replaceActive({
    id: "runtime_binding_activity_fixture",
    sessionId: session.id,
    workspaceId: workspace.id,
    externalThreadId: "thread_activity_fixture",
    relation: "bound",
    modelProvider: "openai",
    now: "2026-08-19T10:03:00.000Z"
  });
  repositories.runtimeEvents.append({
    id: "runtime_event_activity_fixture",
    sessionId: session.id,
    workspaceId: workspace.id,
    threadId: "thread_activity_fixture",
    method: "turn/started",
    category: "lifecycle",
    publicPayload: { safe: true },
    now: "2026-08-19T10:04:00.000Z"
  });
  continuity.close();

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

  const original = { ...process.env };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-machine-activities";
  process.env.CHATCOCKPIT_HOST = "0.0.0.0";
  process.env.CHATCOCKPIT_PORT = "5123";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  const app = buildServer(paths);
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
    assert.equal(projectActivity.authorizationGrantId, null);
    assert.equal((projectActivity.runtime as { runtimeKind: string }).runtimeKind, "codex-app-server");
    assert.equal((projectActivity.runtime as { externalSessionId: string }).externalSessionId, "thread_activity_fixture");
    assert.equal((projectActivity.latestEvent as { method: string }).method, "turn/started");
    assert.equal((projectActivity.job as { id: string }).id, linkedJob.id);

    const hostActivity = body.activities.find((item) => item.id === hostJob.id)!;
    assert.equal(hostActivity.kind, "job");
    assert.equal(hostActivity.scope, "host");
    assert.equal(hostActivity.projectId, null);
    assert.equal(hostActivity.workspaceId, null);
    assert.equal(hostActivity.taskId, null);
    assert.equal(hostActivity.agentSessionId, null);
    assert.equal(hostActivity.title, "Host cleanup activity");

    assert.equal(response.body.includes("private fixture instructions"), false);
    assert.equal(response.body.includes("private host cleanup detail"), false);
    assert.equal(response.body.includes(root), false);
    assert.equal(body.activities.filter((item) => item.id === session.id).length, 1);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log("VERIFY_OPERATIONAL_ACTIVITY_OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
