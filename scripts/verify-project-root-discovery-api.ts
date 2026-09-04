import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.ts";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import type { CodingRuntimeAdapter } from "../src/runtime/codex/runtime-adapter.ts";
import { buildServer } from "../src/server/app.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(repoPath: string, fileName: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main", repoPath]);
  fs.writeFileSync(path.join(repoPath, fileName), `${fileName}\n`, "utf8");
  runGit(["-C", repoPath, "add", fileName]);
  runGit([
    "-C",
    repoPath,
    "-c",
    "user.name=ChatCockpit Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture"
  ]);
}

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "login must set an Operator session cookie");
  return value.split(";", 1)[0]!;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-project-root-discovery-api-"));
const primaryRepo = path.join(root, "primary");
const discoveredRepo = path.join(root, "discovered");
const discoveredSubdir = path.join(discoveredRepo, "packages", "web");
const nativeProjectRepo = path.join(root, "native-project");
initRepo(primaryRepo, "primary.txt");
initRepo(discoveredRepo, "discovered.txt");
initRepo(nativeProjectRepo, "native-project.txt");
fs.mkdirSync(discoveredSubdir, { recursive: true });

const paths = buildFixturePaths(primaryRepo);
ensureWorkspaceDirs(paths);
const configPath = path.join(paths.runtimeDir, "project-root-discovery-api-config.json");
const primaryRootId = rootIdForRepoId("primary");
const config = {
  schemaVersion: 3,
  workspaceDiscoveryRoots: [],
  workspaceAllowlist: [primaryRepo],
  projects: {
    primary: {
      displayName: "Primary",
      primaryRootId,
      rootIds: [primaryRootId]
    }
  },
  projectRoots: {
    [primaryRootId]: {
      path: primaryRepo,
      kind: "git-repository",
      role: "primary-source",
      access: "read-write"
    }
  },
  executionWorkspaces: {
    primary: {
      projectRootId: primaryRootId,
      path: primaryRepo,
      kind: "checkout",
      provenance: "registered"
    }
  }
};
const configText = `${JSON.stringify(config, null, 2)}\n`;
fs.writeFileSync(configPath, configText, { encoding: "utf8", mode: 0o600 });

const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
const operatorService = new OperatorService({ store: operatorStore });
await operatorService.setOwnerPassword({
  username: "owner",
  password: "test-password"
});
operatorStore.close();

const original = {
  configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
  exposed: process.env.CHATCOCKPIT_EXPOSED,
  token: process.env.CHATCOCKPIT_API_TOKEN,
  codexHome: process.env.CODEX_HOME
};
process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
process.env.CHATCOCKPIT_EXPOSED = "false";
process.env.CHATCOCKPIT_API_TOKEN = "test-token";
const codexHome = path.join(root, "codex-home");
fs.mkdirSync(codexHome, { recursive: true });
fs.writeFileSync(
  path.join(codexHome, ".codex-global-state.json"),
  `${JSON.stringify({
    "local-projects": {
      "local-native-project": {
        id: "local-native-project",
        name: "Native Project",
        rootPaths: [nativeProjectRepo],
        createdAt: 50,
        updatedAt: 150
      },
      "local-native-project-alias": {
        id: "local-native-project-alias",
        name: "Native Project Alias",
        rootPaths: [nativeProjectRepo],
        createdAt: 60,
        updatedAt: 140
      }
    },
    "electron-saved-workspace-roots": [nativeProjectRepo]
  })}\n`,
  "utf8"
);
process.env.CODEX_HOME = codexHome;

let privateThreadDiscoveryCalls = 0;
const codexAdapter = {
  async listPrivateThreadLocations() {
    privateThreadDiscoveryCalls += 1;
    return {
      data: [
        {
          threadId: "thread-discovered",
          privatePath: discoveredSubdir,
          name: "Discovered work",
          updatedAt: 100
        }
      ],
      nextCursor: null
    };
  },
  setEventSink() {},
  async close() {}
} as unknown as CodingRuntimeAdapter;

const server = await listenTestServer(buildServer(paths, { codexAdapter }));
try {
  const machineRead = await fetch(`${server.baseUrl}/api/projects/discovery`, {
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(machineRead.status, 401);
  assert.match(await machineRead.text(), /OPERATOR_SESSION_REQUIRED/);

  const login = await fetch(`${server.baseUrl}/api/operator/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "owner",
      password: "test-password"
    })
  });
  assert.equal(login.status, 200);
  const cookie = cookiePair(login);
  const loginBody = (await login.json()) as { csrfToken: string };

  const before = fs.readFileSync(configPath, "utf8");
  const response = await fetch(`${server.baseUrl}/api/projects/discovery`, {
    headers: { cookie }
  });
  assert.equal(response.status, 200);
  assert.equal(privateThreadDiscoveryCalls, 1);
  const body = (await response.json()) as {
    ok: true;
    sources: Array<{ id: string; status: string }>;
    candidates: Array<{
      candidateId: string;
      kind: string;
      privatePath: string;
      registration: string;
      existingRootId: string | null;
      sources: Array<{ sourceId: string; signalKinds: string[] }>;
    }>;
  };
  const after = fs.readFileSync(configPath, "utf8");

  assert.equal(before, after, "Owner discovery GET must not mutate config");
  assert.deepEqual(body.sources.map((source) => [source.id, source.status]), [
    ["codex-native-history", "ready"]
  ]);
  assert.equal(body.candidates.length, 2);
  const threadOnly = body.candidates.find(
    (candidate) => candidate.privatePath === fs.realpathSync.native(discoveredRepo)
  );
  assert.ok(threadOnly);
  assert.equal(threadOnly.kind, "git-repository");
  assert.equal(threadOnly.registration, "unregistered");
  assert.equal(threadOnly.existingRootId, null);
  assert.match(threadOnly.candidateId, /^project_root_candidate_[a-f0-9]{32}$/);
  assert.deepEqual(threadOnly.sources, [
    {
      sourceId: "codex-native-history",
      sourceDisplayName: "Codex",
      signalCount: 1,
      signalKinds: ["native-session-cwd"],
      latestObservedAt: 100,
      latestLabel: "Discovered work"
    }
  ]);

  const nativeProject = body.candidates.find(
    (candidate) => candidate.privatePath === fs.realpathSync.native(nativeProjectRepo)
  );
  assert.ok(nativeProject);
  assert.equal(nativeProject.kind, "git-repository");
  assert.equal(nativeProject.registration, "unregistered");
  assert.equal(body.groups.length, 2);
  assert.deepEqual(
    body.groups.map((group) => [group.name, group.candidateIds]),
    [
      ["Native Project", [nativeProject.candidateId]],
      ["Native Project Alias", [nativeProject.candidateId]]
    ],
    "distinct native logical projects may share one physical Git root candidate"
  );

  const missingCsrf = await fetch(`${server.baseUrl}/api/projects/discovery/reconcile-native`, {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(missingCsrf.status, 403);
  assert.match(await missingCsrf.text(), /CSRF_REQUIRED/);

  const reconcile = await fetch(`${server.baseUrl}/api/projects/discovery/reconcile-native`, {
    method: "POST",
    headers: {
      cookie,
      "x-chatcockpit-csrf": loginBody.csrfToken
    }
  });
  assert.equal(reconcile.status, 200);
  assert.equal(
    privateThreadDiscoveryCalls,
    1,
    "native reconciliation must not enumerate Codex thread history"
  );
  const reconcileBody = (await reconcile.json()) as {
    ok: true;
    created: Array<{ projectSlug: string; repoId: string; sourceId: string; groupId: string }>;
    reused: Array<{ projectSlug: string; repoId: string; sourceId: string; groupId: string }>;
    skipped: Array<{ groupId: string; reason: string }>;
  };
  assert.equal(reconcileBody.created.length, 1);
  assert.equal(reconcileBody.created[0]?.projectSlug, "native-project");
  assert.equal(reconcileBody.created[0]?.repoId, "native-project");
  assert.equal(reconcileBody.created[0]?.sourceId, "codex-native-history");
  assert.equal(reconcileBody.reused.length, 1);
  assert.equal(reconcileBody.reused[0]?.projectSlug, "native-project");
  assert.equal(
    reconcileBody.reused[0]?.repoId,
    reconcileBody.created[0]?.repoId,
    "a duplicate native logical project must reuse the physical root materialized earlier in the same reconcile"
  );

  const projectsAfter = await fetch(`${server.baseUrl}/api/projects?status=active`, {
    headers: { cookie }
  });
  assert.equal(projectsAfter.status, 200);
  const projectsAfterBody = (await projectsAfter.json()) as {
    projects: Array<{ project: { id: string; slug: string }; workspaces: Array<{ id: string; repoId: string }> }>;
  };
  const materialized = projectsAfterBody.projects.find((entry) => entry.project.slug === "native-project");
  assert.ok(materialized);
  assert.deepEqual(materialized.workspaces.map((workspace) => workspace.repoId), ["native-project"]);
  assert.equal(
    projectsAfterBody.projects.some((entry) => entry.project.slug === "discovered"),
    false,
    "thread-cwd-only evidence must not auto-materialize a Project"
  );

  const bearerExecution = await fetch(
    `${server.baseUrl}/api/projects/${encodeURIComponent(materialized.project.id)}/executions`,
    { headers: { authorization: "Bearer test-token" } }
  );
  assert.equal(bearerExecution.status, 401);
  assert.match(await bearerExecution.text(), /OPERATOR_SESSION_REQUIRED/);

  const execution = await fetch(
    `${server.baseUrl}/api/projects/${encodeURIComponent(materialized.project.id)}/executions`,
    { headers: { cookie } }
  );
  assert.equal(execution.status, 200);
  const executionBody = (await execution.json()) as {
    ok: true;
    projectId: string;
    activities: unknown[];
    tasks: unknown[];
    processes: unknown[];
    connections: unknown[];
    counts: { activeActivities: number; runningProcesses: number; activeConnections: number };
  };
  assert.equal(executionBody.projectId, materialized.project.id);
  assert.deepEqual(executionBody.activities, []);
  assert.deepEqual(executionBody.tasks, []);
  assert.deepEqual(executionBody.processes, []);
  assert.deepEqual(executionBody.connections, []);
  assert.deepEqual(executionBody.counts, {
    activeActivities: 0,
    runningActivities: 0,
    waitingApproval: 0,
    activeTasks: 0,
    runningProcesses: 0,
    activeConnections: 0
  });

  const bearerRuntimeExecution = await fetch(`${server.baseUrl}/api/runtime/executions`, {
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(bearerRuntimeExecution.status, 401);
  assert.match(await bearerRuntimeExecution.text(), /OPERATOR_SESSION_REQUIRED/);

  const runtimeExecution = await fetch(`${server.baseUrl}/api/runtime/executions`, {
    headers: { cookie }
  });
  assert.equal(runtimeExecution.status, 200);
  const runtimeExecutionBody = (await runtimeExecution.json()) as {
    ok: true;
    activities: unknown[];
    tasks: unknown[];
    processes: unknown[];
    connections: unknown[];
    counts: typeof executionBody.counts;
  };
  assert.deepEqual(runtimeExecutionBody.activities, []);
  assert.deepEqual(runtimeExecutionBody.tasks, []);
  assert.deepEqual(runtimeExecutionBody.processes, []);
  assert.deepEqual(runtimeExecutionBody.connections, []);
  assert.deepEqual(runtimeExecutionBody.counts, executionBody.counts);

  const bearerProcessTerminate = await fetch(
    `${server.baseUrl}/api/runtime/executions/processes/missing-process/terminate`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        expectedRevision: 1,
        idempotencyKey: "runtime-process-terminate-api-bearer-0001"
      })
    }
  );
  assert.equal(bearerProcessTerminate.status, 401);
  assert.match(await bearerProcessTerminate.text(), /OPERATOR_SESSION_REQUIRED/);

  const missingProcessTerminateCsrf = await fetch(
    `${server.baseUrl}/api/runtime/executions/processes/missing-process/terminate`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        expectedRevision: 1,
        idempotencyKey: "runtime-process-terminate-api-csrf-0001"
      })
    }
  );
  assert.equal(missingProcessTerminateCsrf.status, 403);
  assert.match(await missingProcessTerminateCsrf.text(), /CSRF_REQUIRED/);

  const missingProcessTerminate = await fetch(
    `${server.baseUrl}/api/runtime/executions/processes/missing-process/terminate`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-chatcockpit-csrf": loginBody.csrfToken
      },
      body: JSON.stringify({
        expectedRevision: 1,
        idempotencyKey: "runtime-process-terminate-api-missing-0001"
      })
    }
  );
  assert.equal(missingProcessTerminate.status, 404);
  assert.match(await missingProcessTerminate.text(), /CONTINUITY_RECORD_NOT_FOUND/);

  const materializedWorkspace = materialized.workspaces[0]!;
  const taskResponse = await fetch(`${server.baseUrl}/api/continuity/tasks`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": loginBody.csrfToken
    },
    body: JSON.stringify({
      projectId: materialized.project.id,
      workspaceId: materializedWorkspace.id,
      title: "Execution observability projection fixture",
      goal: "Verify private OAuth provenance never leaks through execution APIs.",
      idempotencyKey: "project-execution-observability-task-0001"
    })
  });
  assert.equal(taskResponse.status, 200);
  const taskBody = (await taskResponse.json()) as { task: { id: string; revision: number } };
  const sessionResponse = await fetch(`${server.baseUrl}/api/continuity/sessions/start`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": loginBody.csrfToken
    },
    body: JSON.stringify({
      taskId: taskBody.task.id,
      title: "Execution observability projection session",
      mode: "chat-direct",
      expectedTaskRevision: taskBody.task.revision,
      idempotencyKey: "project-execution-observability-session-0001"
    })
  });
  assert.equal(sessionResponse.status, 200);

  const populatedProjectExecution = await fetch(
    `${server.baseUrl}/api/projects/${encodeURIComponent(materialized.project.id)}/executions`,
    { headers: { cookie } }
  );
  const populatedProjectBody = (await populatedProjectExecution.json()) as {
    activities: Array<Record<string, unknown>>;
  };
  assert.ok(populatedProjectBody.activities.length > 0);
  assert.equal("authorizationGrantId" in populatedProjectBody.activities[0]!, false);

  const populatedRuntimeExecution = await fetch(`${server.baseUrl}/api/runtime/executions`, {
    headers: { cookie }
  });
  const populatedRuntimeBody = (await populatedRuntimeExecution.json()) as {
    activities: Array<Record<string, unknown>>;
  };
  assert.ok(populatedRuntimeBody.activities.length > 0);
  assert.equal("authorizationGrantId" in populatedRuntimeBody.activities[0]!, false);

  const discoveryAfter = await fetch(`${server.baseUrl}/api/projects/discovery`, {
    headers: { cookie }
  });
  assert.equal(discoveryAfter.status, 200);
  assert.equal(privateThreadDiscoveryCalls, 2);
  const discoveryAfterBody = (await discoveryAfter.json()) as typeof body;
  const registeredNative = discoveryAfterBody.candidates.find(
    (candidate) => candidate.privatePath === fs.realpathSync.native(nativeProjectRepo)
  );
  const stillUnregisteredThread = discoveryAfterBody.candidates.find(
    (candidate) => candidate.privatePath === fs.realpathSync.native(discoveredRepo)
  );
  assert.equal(registeredNative?.registration, "registered");
  assert.equal(stillUnregisteredThread?.registration, "unregistered");

  const replay = await fetch(`${server.baseUrl}/api/projects/discovery/reconcile-native`, {
    method: "POST",
    headers: {
      cookie,
      "x-chatcockpit-csrf": loginBody.csrfToken
    }
  });
  assert.equal(replay.status, 200);
  assert.equal(
    privateThreadDiscoveryCalls,
    2,
    "idempotent native reconciliation must stay on the native catalog fast path"
  );
  const replayBody = (await replay.json()) as typeof reconcileBody;
  assert.equal(replayBody.created.length, 0);
  assert.equal(replayBody.reused.length, 2);
  assert.deepEqual(
    [...new Set(replayBody.reused.map((entry) => entry.projectSlug))],
    ["native-project"]
  );

  process.stdout.write("VERIFY_PROJECT_ROOT_DISCOVERY_API_OK\n");
} finally {
  await server.close();
  if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
  if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
  else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
  if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
  else process.env.CHATCOCKPIT_API_TOKEN = original.token;
  if (original.codexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = original.codexHome;
  fs.rmSync(root, { recursive: true, force: true });
}
