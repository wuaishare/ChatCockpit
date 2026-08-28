import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.ts";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildServer } from "../src/server/app.ts";
import type { CodingRuntimeAdapter } from "../src/runtime/codex/runtime-adapter.ts";
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

function escaped(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

interface RootSummary {
  id: string;
  kind: "git-repository" | "directory";
  role: string;
  access: string;
  primary: boolean;
  pathVisibility: "hidden";
  executionWorkspaceIds: string[];
}

interface RootDetail extends Omit<RootSummary, "pathVisibility"> {
  pathVisibility: "machine-local-owner";
  privatePath: string;
}

interface ProjectMutationBody {
  ok: true;
  configRevision: string;
  project: { id: string; displayName: string; defaultWorkspaceId: string | null };
  workspaces: Array<{ id: string; repoId: string }>;
  roots: RootSummary[];
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-project-registry-api-"));
  const primaryRepo = path.join(root, "primary");
  const candidatesRoot = path.join(root, "candidates");
  const attachedRepo = path.join(candidatesRoot, "attached");
  const autoAttachedRepo = path.join(candidatesRoot, "auto-attached");
  const otherRepo = path.join(candidatesRoot, "other");
  const documentationRoot = path.join(candidatesRoot, "docs");
  const plainProjectRoot = path.join(candidatesRoot, "plain-project");
  initRepo(primaryRepo, "primary.txt");
  initRepo(attachedRepo, "attached.txt");
  initRepo(autoAttachedRepo, "auto-attached.txt");
  initRepo(otherRepo, "other.txt");
  fs.mkdirSync(documentationRoot, { recursive: true });
  fs.mkdirSync(plainProjectRoot, { recursive: true });

  const paths = buildFixturePaths(primaryRepo);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "project-registry-api-config.json");
  // Deliberately start from v2. The first governed mutation must persist canonical v3.
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
        },
        fixtureSafeTopLevel: { preserved: true }
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
    password: "test-password"
  });
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    token: process.env.CHATCOCKPIT_API_TOKEN
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_API_TOKEN = "test-token";

  const codexAdapter = {
    async capabilities() {
      return {
        available: true,
        runtime: "codex-app-server" as const,
        binarySource: "fixture",
        binaryVersion: "fixture",
        protocolFamily: "app-server-v2" as const,
        serverProtocolVersion: null,
        stableMethods: ["thread/start", "thread/resume", "turn/start"],
        experimentalApiEnabled: false,
        standaloneExecution: null
      };
    },
    async listThreads() {
      return { data: [], nextCursor: null, backwardsCursor: null };
    },
    async readMcpApplicability(input: { workspaceId: string }) {
      return {
        workspaceId: input.workspaceId,
        configuredServerCount: 0,
        applicableServerCount: 0,
        disabledServerCount: 0,
        servers: []
      };
    },
    setEventSink() {},
    async close() {}
  } as unknown as CodingRuntimeAdapter;

  const server = await listenTestServer(buildServer(paths, { codexAdapter }));
  try {
    const machineRead = await fetch(`${server.baseUrl}/api/projects`, {
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
        roots: RootSummary[];
      }>;
    };
    assert.match(initial.configRevision, /^[a-f0-9]{64}$/);
    assert.equal(initial.projects.length, 1);
    assert.equal(initial.projects[0]?.project.displayName, "Primary Project");
    assert.equal(initial.projects[0]?.workspaces[0]?.repoId, "primary");
    assert.equal(initial.projects[0]?.roots.length, 1);
    assert.equal(initial.projects[0]?.roots[0]?.pathVisibility, "hidden");
    assert.doesNotMatch(JSON.stringify(initial), escaped(root));

    const projectId = initial.projects[0]!.project.id;
    const initialDefaultWorkspaceId = initial.projects[0]!.project.defaultWorkspaceId;
    assert.ok(initialDefaultWorkspaceId);
    const detailResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}`,
      { headers: ownerHeaders }
    );
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as {
      roots: RootDetail[];
      workspaces: Array<{ repoId: string; privatePath: string }>;
    };
    assert.equal(detail.roots.length, 1);
    assert.equal(detail.roots[0]?.pathVisibility, "machine-local-owner");
    assert.equal(detail.roots[0]?.privatePath, fs.realpathSync.native(primaryRepo));
    assert.equal(detail.workspaces[0]?.repoId, "primary");
    assert.equal(detail.workspaces[0]?.privatePath, fs.realpathSync.native(primaryRepo));

    const noCsrfAttach = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          path: attachedRepo,
          kind: "git-repository",
          role: "supporting-source",
          access: "read-write",
          repoId: "attached",
          expectedConfigRevision: initial.configRevision
        })
      }
    );
    assert.equal(noCsrfAttach.status, 403);
    assert.match(await noCsrfAttach.text(), /CSRF_REQUIRED/);

    const attachResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          path: attachedRepo,
          kind: "git-repository",
          role: "supporting-source",
          access: "read-write",
          repoId: "attached",
          expectedConfigRevision: initial.configRevision
        })
      }
    );
    assert.equal(attachResponse.status, 200);
    const attached = (await attachResponse.json()) as ProjectMutationBody;
    assert.notEqual(attached.configRevision, initial.configRevision);
    assert.deepEqual(
      attached.workspaces.map((workspace) => workspace.repoId).sort(),
      ["attached", "primary"]
    );
    assert.equal(attached.roots.length, 2);
    assert.equal(attached.roots.every((entry) => entry.pathVisibility === "hidden"), true);
    assert.doesNotMatch(JSON.stringify(attached), escaped(root));
    const attachedWorkspace = attached.workspaces.find((workspace) => workspace.repoId === "attached");
    assert.ok(attachedWorkspace);
    const attachedRoot = attached.roots.find((entry) =>
      entry.executionWorkspaceIds.includes(attachedWorkspace.id)
    );
    assert.ok(attachedRoot);

    const docsAttachResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          path: documentationRoot,
          kind: "directory",
          role: "documentation",
          access: "read-only",
          expectedConfigRevision: attached.configRevision
        })
      }
    );
    assert.equal(docsAttachResponse.status, 200);
    const withDocs = (await docsAttachResponse.json()) as ProjectMutationBody;
    assert.equal(withDocs.roots.length, 3);
    assert.equal(withDocs.workspaces.length, 2);
    const docsRoot = withDocs.roots.find((entry) => entry.role === "documentation");
    assert.ok(docsRoot);
    assert.deepEqual(docsRoot.executionWorkspaceIds, []);

    const docsPrimaryResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots/${encodeURIComponent(docsRoot.id)}/make-primary`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ expectedConfigRevision: withDocs.configRevision })
      }
    );
    assert.equal(docsPrimaryResponse.status, 200);
    const docsPrimary = (await docsPrimaryResponse.json()) as ProjectMutationBody;
    assert.equal(docsPrimary.project.defaultWorkspaceId, initialDefaultWorkspaceId);
    assert.equal(docsPrimary.roots.find((entry) => entry.id === docsRoot.id)?.primary, true);

    const attachedPrimaryResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots/${encodeURIComponent(attachedRoot.id)}/make-primary`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ expectedConfigRevision: docsPrimary.configRevision })
      }
    );
    assert.equal(attachedPrimaryResponse.status, 200);
    const attachedPrimary = (await attachedPrimaryResponse.json()) as ProjectMutationBody;
    assert.equal(attachedPrimary.project.defaultWorkspaceId, initialDefaultWorkspaceId);

    const renameResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/rename`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          displayName: "Renamed Project",
          expectedConfigRevision: attachedPrimary.configRevision
        })
      }
    );
    assert.equal(renameResponse.status, 200);
    const renamed = (await renameResponse.json()) as ProjectMutationBody;
    assert.equal(renamed.project.displayName, "Renamed Project");

    const staleRenameResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/rename`,
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

    const gitWithoutRepoId = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          path: autoAttachedRepo,
          kind: "git-repository",
          expectedConfigRevision: renamed.configRevision
        })
      }
    );
    assert.equal(gitWithoutRepoId.status, 200);
    const autoAttached = (await gitWithoutRepoId.json()) as ProjectMutationBody;
    const autoAttachedWorkspace = autoAttached.workspaces.find((workspace) => workspace.repoId === "auto-attached");
    assert.ok(autoAttachedWorkspace);
    const autoAttachedRoot = autoAttached.roots.find((entry) =>
      entry.executionWorkspaceIds.includes(autoAttachedWorkspace.id)
    );
    assert.ok(autoAttachedRoot);

    const directoryWithRepoId = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          path: plainProjectRoot,
          kind: "directory",
          repoId: "plain",
          expectedConfigRevision: autoAttached.configRevision
        })
      }
    );
    assert.equal(directoryWithRepoId.status, 400);
    assert.match(await directoryWithRepoId.text(), /VALIDATION_ERROR/);

    const createResponse = await fetch(`${server.baseUrl}/api/projects`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        displayName: "Other Project",
        root: {
          path: otherRepo
        },
        expectedConfigRevision: autoAttached.configRevision
      })
    });
    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as ProjectMutationBody;
    assert.equal(created.project.displayName, "Other Project");
    assert.deepEqual(created.workspaces.map((workspace) => workspace.repoId), ["other"]);
    assert.equal(created.roots.length, 1);
    assert.equal(created.roots[0]?.primary, true);

    const plainCreateResponse = await fetch(`${server.baseUrl}/api/projects`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        slug: "plain-project",
        displayName: "Plain Project",
        root: {
          path: plainProjectRoot,
          kind: "directory",
          role: "documentation",
          access: "read-only"
        },
        expectedConfigRevision: created.configRevision
      })
    });
    assert.equal(plainCreateResponse.status, 200);
    const plainCreated = (await plainCreateResponse.json()) as ProjectMutationBody;
    assert.equal(plainCreated.project.displayName, "Plain Project");
    assert.equal(plainCreated.project.defaultWorkspaceId, null);
    assert.deepEqual(plainCreated.workspaces, []);
    assert.equal(plainCreated.roots.length, 1);
    assert.equal(plainCreated.roots[0]?.kind, "directory");

    const lastRootDetachResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(created.project.id)}/roots/${encodeURIComponent(created.roots[0]!.id)}/detach`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ expectedConfigRevision: plainCreated.configRevision })
      }
    );
    assert.equal(lastRootDetachResponse.status, 409);
    assert.match(await lastRootDetachResponse.text(), /PROJECT_ROOT_LAST_ROOT/);

    const noCsrfDetachResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots/${encodeURIComponent(autoAttachedRoot.id)}/detach`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ expectedConfigRevision: plainCreated.configRevision })
      }
    );
    assert.equal(noCsrfDetachResponse.status, 403);
    assert.match(await noCsrfDetachResponse.text(), /CSRF_REQUIRED/);

    const detachResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots/${encodeURIComponent(autoAttachedRoot.id)}/detach`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ expectedConfigRevision: plainCreated.configRevision })
      }
    );
    assert.equal(detachResponse.status, 200);
    const detached = (await detachResponse.json()) as ProjectMutationBody;
    assert.equal(detached.roots.some((entry) => entry.id === autoAttachedRoot.id), false);
    assert.equal(detached.workspaces.some((workspace) => workspace.repoId === "auto-attached"), false);
    assert.equal(fs.existsSync(autoAttachedRepo), true, "detaching a ProjectRoot must not delete its checkout");

    const duplicateRootResponse = await fetch(
      `${server.baseUrl}/api/projects/${encodeURIComponent(projectId)}/roots`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          path: attachedRepo,
          kind: "git-repository",
          repoId: "duplicate",
          expectedConfigRevision: detached.configRevision
        })
      }
    );
    assert.equal(duplicateRootResponse.status, 409);
    assert.match(await duplicateRootResponse.text(), /PROJECT_ROOT_PATH_CONFLICT/);

    const finalResponse = await fetch(`${server.baseUrl}/api/projects`, {
      headers: ownerHeaders
    });
    assert.equal(finalResponse.status, 200);
    const final = (await finalResponse.json()) as {
      configRevision: string;
      projects: Array<{ project: { displayName: string }; roots: RootSummary[] }>;
    };
    assert.equal(final.configRevision, detached.configRevision);
    assert.deepEqual(
      final.projects.map((entry) => entry.project.displayName).sort(),
      ["Other Project", "Plain Project", "Renamed Project"]
    );
    assert.equal(final.projects.every((entry) => entry.roots.every((rootEntry) => rootEntry.pathVisibility === "hidden")), true);
    assert.doesNotMatch(JSON.stringify(final), escaped(root));

    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    assert.equal(rawConfig.schemaVersion, 3);
    assert.equal("defaultRepoId" in rawConfig, false);
    assert.equal("repoMappings" in rawConfig, false);
    assert.deepEqual(rawConfig.fixtureSafeTopLevel, { preserved: true });
    const rawProjects = rawConfig.projects as Record<string, { displayName: string; primaryRootId: string; rootIds: string[] }>;
    const rawRoots = rawConfig.projectRoots as Record<string, { path: string; kind: string; role: string; access: string }>;
    const rawWorkspaces = rawConfig.executionWorkspaces as Record<string, { projectRootId: string; path: string; kind: string }>;
    assert.equal(rawProjects.primary?.displayName, "Renamed Project");
    assert.equal(rawProjects.primary?.rootIds.length, 3);
    assert.equal(rawProjects.primary?.primaryRootId, attachedRoot.id);
    assert.equal(rawWorkspaces.attached?.projectRootId, attachedRoot.id);
    assert.equal(rawWorkspaces["auto-attached"], undefined);
    assert.equal(rawWorkspaces.other?.kind, "checkout");
    assert.equal(
      Object.values(rawRoots).some((entry) => entry.path === fs.realpathSync.native(documentationRoot) && entry.kind === "directory"),
      true
    );
    assert.equal(
      Object.values(rawWorkspaces).some((entry) => entry.path === fs.realpathSync.native(plainProjectRoot)),
      false
    );

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
