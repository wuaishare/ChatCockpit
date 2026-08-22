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

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(repoPath: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main", repoPath]);
  fs.writeFileSync(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  runGit(["-C", repoPath, "add", "README.md"]);
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

function cookiePair(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  assert.ok(raw);
  return raw.split(";", 1)[0]!;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-workspace-onboarding-api-"));
const primaryRepo = path.join(root, "primary");
const discoveryRoot = path.join(root, "projects");
const candidateRepo = path.join(discoveryRoot, "api-repo");
initRepo(primaryRepo);
initRepo(candidateRepo);

const paths = buildFixturePaths(primaryRepo);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
fs.writeFileSync(
  paths.configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceDiscoveryRoots: [],
      workspaceAllowlist: [primaryRepo],
      repoMappings: { primary: { path: primaryRepo } }
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
  password: "workspace-onboarding-api-password"
});
const loginGate = operatorService.createSecureLoginGate().gateSecret;
operatorStore.close();

const openapiSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "openapi", "chatcockpit.openapi.yaml"),
  "utf8"
);
assert.match(openapiSource, /\/api\/continuity\/workspace-discovery\/roots:/);
assert.match(openapiSource, /importWorkspaceDiscoveryCandidate/);
assert.match(openapiSource, /Machine-local Owner-only/);

const app = buildServer(paths);
try {
  const noSession = await app.inject({
    method: "GET",
    url: "/api/continuity/workspace-discovery/roots",
    headers: { host: "127.0.0.1" },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(noSession.statusCode, 401);

  const login = await app.inject({
    method: "POST",
    url: "/api/operator/login",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      "x-chatcockpit-login-gate": loginGate
    },
    remoteAddress: "127.0.0.1",
    payload: {
      username: "owner",
      password: "workspace-onboarding-api-password"
    }
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = cookiePair(login.headers["set-cookie"]);
  const csrf = (login.json() as { csrfToken: string }).csrfToken;
  assert.ok(csrf);

  const initial = await app.inject({
    method: "GET",
    url: "/api/continuity/workspace-discovery/roots",
    headers: { host: "127.0.0.1", cookie },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(initial.statusCode, 200, initial.body);
  const initialBody = initial.json() as { configRevision: string; roots: unknown[] };
  assert.deepEqual(initialBody.roots, []);

  const remoteOwner = await app.inject({
    method: "GET",
    url: "/api/continuity/workspace-discovery/roots",
    headers: { host: "chatcockpit.example.com", cookie },
    remoteAddress: "198.51.100.23"
  });
  assert.equal([403, 404].includes(remoteOwner.statusCode), true, remoteOwner.body);
  if (remoteOwner.statusCode === 403) {
    assert.equal(
      (remoteOwner.json() as { error: { code: string } }).error.code,
      "MACHINE_LOCAL_AUTHORITY_REQUIRED"
    );
  }
  assert.equal(remoteOwner.body.includes(discoveryRoot), false);

  const noCsrf = await app.inject({
    method: "POST",
    url: "/api/continuity/workspace-discovery/roots",
    headers: { host: "127.0.0.1", cookie, "content-type": "application/json" },
    remoteAddress: "127.0.0.1",
    payload: {
      path: discoveryRoot,
      expectedConfigRevision: initialBody.configRevision
    }
  });
  assert.equal(noCsrf.statusCode, 403);
  assert.equal((noCsrf.json() as { error: { code: string } }).error.code, "CSRF_REQUIRED");

  const added = await app.inject({
    method: "POST",
    url: "/api/continuity/workspace-discovery/roots",
    headers: {
      host: "127.0.0.1",
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": csrf
    },
    remoteAddress: "127.0.0.1",
    payload: {
      path: discoveryRoot,
      expectedConfigRevision: initialBody.configRevision
    }
  });
  assert.equal(added.statusCode, 200, added.body);
  const addedBody = added.json() as {
    configRevision: string;
    roots: Array<{ id: string; path: string }>;
  };
  assert.equal(addedBody.roots[0]?.path, fs.realpathSync.native(discoveryRoot));
  const rootId = addedBody.roots[0]!.id;

  const scan = await app.inject({
    method: "POST",
    url: `/api/continuity/workspace-discovery/roots/${encodeURIComponent(rootId)}/scan`,
    headers: {
      host: "127.0.0.1",
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": csrf
    },
    remoteAddress: "127.0.0.1",
    payload: { expectedConfigRevision: addedBody.configRevision }
  });
  assert.equal(scan.statusCode, 200, scan.body);
  const scanBody = scan.json() as {
    configRevision: string;
    candidates: Array<{ candidateId: string; name: string; suggestedRepoId: string }>;
  };
  assert.equal(scanBody.candidates[0]?.name, "api-repo");
  assert.equal(JSON.stringify(scanBody.candidates).includes(discoveryRoot), false);

  const imported = await app.inject({
    method: "POST",
    url: `/api/continuity/workspace-discovery/roots/${encodeURIComponent(rootId)}/import`,
    headers: {
      host: "127.0.0.1",
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": csrf
    },
    remoteAddress: "127.0.0.1",
    payload: {
      candidateId: scanBody.candidates[0]!.candidateId,
      repoId: scanBody.candidates[0]!.suggestedRepoId,
      expectedConfigRevision: scanBody.configRevision,
      idempotencyKey: "workspace-api-import-0001"
    }
  });
  assert.equal(imported.statusCode, 200, imported.body);

  const projects = await app.inject({
    method: "GET",
    url: "/api/continuity/projects",
    headers: { host: "127.0.0.1", cookie },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(projects.statusCode, 200, projects.body);
  assert.equal(projects.body.includes(candidateRepo), false);
  const projectBody = projects.json() as {
    projects: Array<{ workspaces: Array<{ repoId: string }> }>;
  };
  assert.equal(
    projectBody.projects.some((projection) =>
      projection.workspaces.some((workspace) => workspace.repoId === "api-repo")
    ),
    true
  );

  const bearerRejected = await app.inject({
    method: "GET",
    url: "/api/continuity/workspace-discovery/roots",
    headers: {
      host: "127.0.0.1",
      authorization: "Bearer invalid-workspace-token"
    },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(bearerRejected.statusCode, 401);
  assert.equal(bearerRejected.body.includes(discoveryRoot), false);

  process.stdout.write("VERIFY_WORKSPACE_ONBOARDING_API_OK\n");
} finally {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
