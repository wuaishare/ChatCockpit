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
initRepo(primaryRepo, "primary.txt");
initRepo(discoveredRepo, "discovered.txt");
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
process.env.CODEX_HOME = codexHome;

const codexAdapter = {
  async listPrivateThreadLocations() {
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

  const before = fs.readFileSync(configPath, "utf8");
  const response = await fetch(`${server.baseUrl}/api/projects/discovery`, {
    headers: { cookie }
  });
  assert.equal(response.status, 200);
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
  assert.equal(body.candidates.length, 1);
  assert.equal(body.candidates[0]?.kind, "git-repository");
  assert.equal(body.candidates[0]?.privatePath, fs.realpathSync.native(discoveredRepo));
  assert.equal(body.candidates[0]?.registration, "unregistered");
  assert.equal(body.candidates[0]?.existingRootId, null);
  assert.match(body.candidates[0]?.candidateId ?? "", /^project_root_candidate_[a-f0-9]{32}$/);
  assert.deepEqual(body.candidates[0]?.sources, [
    {
      sourceId: "codex-native-history",
      sourceDisplayName: "Codex",
      signalCount: 1,
      signalKinds: ["native-session-cwd"],
      latestObservedAt: 100,
      latestLabel: "Discovered work"
    }
  ]);

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
