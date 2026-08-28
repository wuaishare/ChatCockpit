import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProjectService } from "../src/application/project-service.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { WorkspaceOnboardingService } from "../src/application/workspace-onboarding-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const NOW = "2026-08-22T00:00:00.000Z";
const context = {
  requestId: "workspace-onboarding-test",
  actorType: "local-ui" as const,
  actorId: "owner-test",
  publicProjection: false,
  now: NOW
};

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

function code(error: unknown): string | null {
  return error instanceof ServiceError ? error.code : null;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-workspace-onboarding-"));
const primaryRepo = path.join(root, "primary");
const discoveryRoot = path.join(root, "projects");
const secondDiscoveryRoot = path.join(root, "projects-2");
const repoA = path.join(discoveryRoot, "repo-a");
const repoB = path.join(discoveryRoot, "repo-b");
const hiddenRepo = path.join(discoveryRoot, ".hidden-repo");
const normalDir = path.join(discoveryRoot, "notes");
const outsideRepo = path.join(root, "outside-repo");
initRepo(primaryRepo, "primary.txt");
initRepo(repoA, "a.txt");
initRepo(repoB, "b.txt");
initRepo(hiddenRepo, "hidden.txt");
initRepo(outsideRepo, "outside.txt");
fs.mkdirSync(normalDir, { recursive: true });
fs.mkdirSync(secondDiscoveryRoot, { recursive: true });
if (process.platform !== "win32") {
  fs.symlinkSync(outsideRepo, path.join(discoveryRoot, "escape-link"));
}

for (let index = 0; index < 205; index += 1) {
  fs.mkdirSync(path.join(secondDiscoveryRoot, `plain-${String(index).padStart(3, "0")}`));
}

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

const database = new ContinuityDatabase({ path: path.join(root, "continuity.sqlite") });
const repositories = buildContinuityRepositories(database);
const projects = new ProjectService(paths, database, repositories);
const service = new WorkspaceOnboardingService(paths, projects, repositories);

try {
  const initial = service.listRoots(context);
  assert.deepEqual(initial.roots, []);
  assert.match(initial.configRevision, /^[a-f0-9]{64}$/);

  const added = service.addRoot(context, {
    path: discoveryRoot,
    expectedConfigRevision: initial.configRevision
  });
  assert.equal(added.roots.length, 1);
  assert.equal(added.roots[0]?.displayName, "projects");
  assert.equal(added.roots[0]?.path, fs.realpathSync.native(discoveryRoot));
  assert.notEqual(added.configRevision, initial.configRevision);

  assert.throws(
    () =>
      service.addRoot(context, {
        path: paths.stateRoot,
        expectedConfigRevision: added.configRevision
      }),
    (error) => code(error) === "WORKSPACE_DISCOVERY_ROOT_FORBIDDEN"
  );

  const rootId = added.roots[0]!.id;
  const scan = service.scanRoot(context, {
    rootId,
    expectedConfigRevision: added.configRevision
  });
  assert.deepEqual(scan.candidates.map((candidate) => candidate.name), ["repo-a", "repo-b"]);
  assert.equal(scan.candidates.every((candidate) => candidate.registration === "unregistered"), true);
  assert.equal(JSON.stringify(scan.candidates).includes(root), false);
  assert.equal(scan.candidates[0]?.git.repository, true);
  assert.match(scan.candidates[0]?.git.headCommit ?? "", /^[a-f0-9]{40}$/);

  const firstCandidate = scan.candidates[0]!;
  const imported = await service.importCandidate(context, {
    rootId,
    candidateId: firstCandidate.candidateId,
    repoId: "repo-a",
    expectedConfigRevision: scan.configRevision,
    idempotencyKey: "workspace-import-0001"
  });
  assert.equal(imported.replayed, false);
  assert.equal(imported.workspace.repoId, "repo-a");
  assert.equal(imported.project.slug, "repo-a");

  const raw = JSON.parse(fs.readFileSync(paths.configPath, "utf8")) as {
    schemaVersion: number;
    workspaceDiscoveryRoots: string[];
    workspaceAllowlist: string[];
    projects: Record<string, { displayName: string; primaryRootId: string; rootIds: string[] }>;
    projectRoots: Record<string, { path: string; kind: string; role: string; access: string }>;
    executionWorkspaces: Record<string, { projectRootId: string; path: string; kind: string }>;
    repoMappings?: unknown;
  };
  const importedRootId = rootIdForRepoId("repo-a");
  assert.equal(raw.schemaVersion, 3);
  assert.equal(raw.workspaceDiscoveryRoots.includes(fs.realpathSync.native(discoveryRoot)), true);
  assert.equal(raw.workspaceAllowlist.includes(fs.realpathSync.native(repoA)), true);
  assert.equal(raw.workspaceAllowlist.includes(fs.realpathSync.native(discoveryRoot)), false);
  assert.equal(raw.projects["repo-a"]?.primaryRootId, importedRootId);
  assert.deepEqual(raw.projects["repo-a"]?.rootIds, [importedRootId]);
  assert.equal(raw.projectRoots[importedRootId]?.path, fs.realpathSync.native(repoA));
  assert.equal(raw.projectRoots[importedRootId]?.kind, "git-repository");
  assert.equal(raw.executionWorkspaces["repo-a"]?.projectRootId, importedRootId);
  assert.equal(raw.executionWorkspaces["repo-a"]?.path, fs.realpathSync.native(repoA));
  assert.equal(raw.executionWorkspaces["repo-b"], undefined);
  assert.equal(raw.repoMappings, undefined);

  const replay = await service.importCandidate(context, {
    rootId,
    candidateId: firstCandidate.candidateId,
    repoId: "repo-a",
    expectedConfigRevision: scan.configRevision,
    idempotencyKey: "workspace-import-0001"
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.workspace.id, imported.workspace.id);

  await assert.rejects(
    () =>
      service.importCandidate(context, {
        rootId,
        candidateId: firstCandidate.candidateId,
        repoId: "repo-a-conflict",
        expectedConfigRevision: scan.configRevision,
        idempotencyKey: "workspace-import-0001"
      }),
    (error) => code(error) === "IDEMPOTENCY_CONFLICT"
  );

  const afterImport = service.listRoots(context);
  const rescan = service.scanRoot(context, {
    rootId,
    expectedConfigRevision: afterImport.configRevision
  });
  assert.equal(
    rescan.candidates.find((candidate) => candidate.name === "repo-a")?.registration,
    "registered"
  );
  assert.equal(
    rescan.candidates.find((candidate) => candidate.name === "repo-b")?.registration,
    "unregistered"
  );

  const secondAdded = service.addRoot(context, {
    path: secondDiscoveryRoot,
    expectedConfigRevision: afterImport.configRevision
  });
  const secondRoot = secondAdded.roots.find((entry) => entry.path === fs.realpathSync.native(secondDiscoveryRoot));
  assert.ok(secondRoot);
  const bounded = service.scanRoot(context, {
    rootId: secondRoot.id,
    expectedConfigRevision: secondAdded.configRevision
  });
  assert.equal(bounded.inspectedEntries, 200);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.candidates.length, 0);

  const repoBScan = service.scanRoot(context, {
    rootId,
    expectedConfigRevision: secondAdded.configRevision
  });
  const staleCandidate = repoBScan.candidates.find((candidate) => candidate.name === "repo-b");
  assert.ok(staleCandidate);
  fs.renameSync(repoB, path.join(discoveryRoot, "repo-b-moved"));
  await assert.rejects(
    () =>
      service.importCandidate(context, {
        rootId,
        candidateId: staleCandidate.candidateId,
        repoId: "repo-b",
        expectedConfigRevision: repoBScan.configRevision,
        idempotencyKey: "workspace-import-stale-0001"
      }),
    (error) => code(error) === "WORKSPACE_DISCOVERY_CANDIDATE_STALE"
  );

  process.stdout.write("VERIFY_WORKSPACE_ONBOARDING_OK\n");
} finally {
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
}
