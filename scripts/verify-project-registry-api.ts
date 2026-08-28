import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.ts";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildServer } from "../src/server/app.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout ?? "").trim();
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

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-project-registry-api-"));
  const primaryRepo = path.join(root, "primary");
  const candidatesRoot = path.join(root, "candidates");
  const attachedRepo = path.join(candidatesRoot, "attached");
  const otherRepo = path.join(candidatesRoot, "other");
  const nonGitDirectory = path.join(candidatesRoot, "plain-directory");
  initRepo(primaryRepo, "primary.txt");
  initRepo(attachedRepo, "attached.txt");
  initRepo(otherRepo, "other.txt");
  fs.mkdirSync(nonGitDirectory, { recursive: true });

  const paths = buildFixturePaths(primaryRepo);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "project-registry-api-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        defaultRepoId: "primary",
        workspaceDiscoveryRoots: [],
        workspaceAllowlist: [primaryRepo],
        repoMappings: {
          primary: { path: primaryRepo }
        },
        projects: {
          primary: {
            displayName: "Primary Project",
            primaryRepoId: "primary",
            repoIds: ["primary"]
          }
        }
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "project-registry-test-password"
  });
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    token: process.env.CHATCOCKPIT_API_TOKEN
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_API_TOKEN = "project-registry-machine-token";

  const server = await listenTestServer(buildServer(paths));
  try {
    const machineRead = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { authorization: "Bearer project-registry-machine-token" }
    });
    assert.equal(machineRead.status, 401);
    assert.match(await machineRead.text(), /OPERATOR_SESSION_REQUIRED/);

    const login = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "project-registry-test-password"
      })
    });
    assert.equal(login.status, 200);
    const cookie = cookiePair(login);
    const loginBody = (await login.json()) as { csrfToken: string };
    assert.match(loginBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);

    const ownerHeaders = { cookie };
    const mutationHeaders = {
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": loginBody.csrfToken
    };

    const initialResponse = await fetch(`${server.baseUrl}/api/projects`, {
      headers: ownerHeaders
    });
    assert.equal(initialResponse.status, 200);
    const initial = (await initialResponse.json()) as {
      ok: true;
      configRevision: string;
      projects: Array<{
        project: { id: string; displayName: string; defaultWorkspaceId: string | null };
        workspaces: Array<{ id: string; repoId: string }>;
      }>;
    };
    assert.match(initial.configRevision, /^[a-f0-9]{64}$/);
    assert.equal(initial.projects.length, 1);
    assert.equal(initial.projects[0]?.project.displayName, "Primary Project");
    assert.equal(initial.projects[0]?.workspaces[0]?.repoId, "primary");
    assert.doesNotMatch(JSON.stringify(initial), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const noCsrfAttach = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(initial.projects[0]!.project.id)}/workspaces`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          repoId: "attached",
          path: attachedRepo,
          expectedConfigRevision: initial.configRevision
        })
      }
    );
    assert.equal(noCsrfAttach.status, 403);
    assert.match(await noCsrfAttach.text(), /CSRF_REQUIRED/);

    const attachResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(initial.projects[0]!.project.id)}/workspaces`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          repoId: "attached",
          path: attachedRepo,
          expectedConfigRevision: initial.configRevision
        })
      }
    );
    assert.equal(attachResponse.status, 200);
    const attached = (await attachResponse.json()) as {
      ok: true;
      configRevision: string;
      project: { id: string; displayName: string; defaultWorkspaceId: string | null };
      workspaces: Array<{ id: string; repoId: string }>;
    };
    assert.notEqual(attached.configRevision, initial.configRevision);
    assert.deepEqual(
      attached.workspaces.map((workspace) => workspace.repoId).sort(),
      ["attached", "primary"]
    );
    assert.doesNotMatch(JSON.stringify(attached), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const attachedWorkspace = attached.workspaces.find((workspace) => workspace.repoId === "attached");
    assert.ok(attachedWorkspace);
    const makePrimaryResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(attached.project.id)}/workspaces/${encodeURIComponent(attachedWorkspace.id)}/make-primary`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ expectedConfigRevision: attached.configRevision })
      }
    );
    assert.equal(makePrimaryResponse.status, 200);
    const primaryChanged = (await makePrimaryResponse.json()) as {
      configRevision: string;
      project: { defaultWorkspaceId: string | null };
    };
    assert.equal(primaryChanged.project.defaultWorkspaceId, attachedWorkspace.id);

    const renameResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(attached.project.id)}/rename`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          displayName: "Renamed Project",
          expectedConfigRevision: primaryChanged.configRevision
        })
      }
    );
    assert.equal(renameResponse.status, 200);
    const renamed = (await renameResponse.json()) as {
      configRevision: string;
      project: { displayName: string };
    };
    assert.equal(renamed.project.displayName, "Renamed Project");

    const staleRenameResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(attached.project.id)}/rename`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          displayName: "Stale Rename",
          expectedConfigRevision: initial.configRevision
        })
      }
    );
    assert.equal(staleRenameResponse.status, 409);
    assert.match(await staleRenameResponse.text(), /WORKSPACE_CONFIG_REVISION_CONFLICT/);

    const nonGitCreateResponse = await fetch(`${server.baseUrl}/api/projects`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        slug: "plain-project",
        displayName: "Plain Project",
        repoId: "plain",
        path: nonGitDirectory,
        expectedConfigRevision: renamed.configRevision
      })
    });
    assert.equal(nonGitCreateResponse.status, 400);
    assert.match(await nonGitCreateResponse.text(), /WORKSPACE_GIT_ROOT_REQUIRED/);

    const createResponse = await fetch(`${server.baseUrl}/api/projects`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        slug: "other-project",
        displayName: "Other Project",
        repoId: "other",
        path: otherRepo,
        expectedConfigRevision: renamed.configRevision
      })
    });
    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as {
      configRevision: string;
      project: { id: string; displayName: string };
      workspaces: Array<{ repoId: string }>;
    };
    assert.equal(created.project.displayName, "Other Project");
    assert.deepEqual(created.workspaces.map((workspace) => workspace.repoId), ["other"]);

    const finalResponse = await fetch(`${server.baseUrl}/api/projects`, {
      headers: ownerHeaders
    });
    assert.equal(finalResponse.status, 200);
    const final = (await finalResponse.json()) as {
      configRevision: string;
      projects: Array<{ project: { displayName: string } }>;
    };
    assert.equal(final.configRevision, created.configRevision);
    assert.deepEqual(
      final.projects.map((entry) => entry.project.displayName).sort(),
      ["Other Project", "Renamed Project"]
    );

    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      schemaVersion: number;
      projects: Record<string, { displayName: string; primaryRepoId: string; repoIds: string[] }>;
    };
    assert.equal(rawConfig.schemaVersion, 2);
    assert.equal(rawConfig.projects.primary?.displayName, "Renamed Project");
    assert.equal(rawConfig.projects.primary?.primaryRepoId, "attached");
    assert.deepEqual(rawConfig.projects.primary?.repoIds, ["attached", "primary"]);
    assert.deepEqual(rawConfig.projects["other-project"]?.repoIds, ["other"]);

    process.stdout.write("VERIFY_PROJECT_REGISTRY_API_OK\n");
  } finally {
    await server.close();
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();
