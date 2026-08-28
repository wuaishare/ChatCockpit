import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProjectService } from "../src/application/project-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const NOW = "2026-08-28T05:00:00.000Z";
const context = {
  requestId: "project-registry-test",
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

function writeConfig(
  configPath: string,
  input: { displayName: string; primaryRepoId: "primary" | "secondary" }
): void {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        defaultRepoId: "primary",
        workspaceDiscoveryRoots: [],
        workspaceAllowlist: [repoPrimary, repoSecondary],
        repoMappings: {
          primary: { path: repoPrimary },
          secondary: { path: repoSecondary }
        },
        projects: {
          chatcockpit: {
            displayName: input.displayName,
            primaryRepoId: input.primaryRepoId,
            repoIds: ["primary", "secondary"]
          }
        }
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-project-registry-"));
const repoPrimary = path.join(root, "chatcockpit-primary");
const repoSecondary = path.join(root, "chatcockpit-secondary");
const repoAttached = path.join(root, "chatcockpit-attached");
const repoOther = path.join(root, "other-project");
initRepo(repoPrimary, "primary.txt");
initRepo(repoSecondary, "secondary.txt");
initRepo(repoAttached, "attached.txt");
initRepo(repoOther, "other.txt");

const paths = buildFixturePaths(repoPrimary);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
writeConfig(paths.configPath, { displayName: "ChatCockpit", primaryRepoId: "primary" });

const database = new ContinuityDatabase({ path: path.join(root, "continuity.sqlite") });
const repositories = buildContinuityRepositories(database);
const service = new ProjectService(paths, database, repositories);

try {
  const initial = service.list(context);
  assert.equal(initial.length, 1);
  assert.equal(initial[0]?.project.slug, "chatcockpit");
  assert.equal(initial[0]?.project.displayName, "ChatCockpit");
  assert.deepEqual(
    initial[0]?.workspaces.map((workspace) => workspace.repoId).sort(),
    ["primary", "secondary"]
  );
  const initialPrimary = initial[0]?.workspaces.find(
    (workspace) => workspace.id === initial[0]?.project.defaultWorkspaceId
  );
  assert.equal(initialPrimary?.repoId, "primary");

  writeConfig(paths.configPath, {
    displayName: "ChatCockpit Platform",
    primaryRepoId: "secondary"
  });
  const updated = service.list({ ...context, now: "2026-08-28T05:01:00.000Z" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.project.displayName, "ChatCockpit Platform");
  const updatedPrimary = updated[0]?.workspaces.find(
    (workspace) => workspace.id === updated[0]?.project.defaultWorkspaceId
  );
  assert.equal(updatedPrimary?.repoId, "secondary");

  const registry = service.registry({ ...context, now: "2026-08-28T05:02:00.000Z" });
  assert.equal(registry.projects.length, 1);
  const attached = service.attachWorkspace(
    { ...context, now: "2026-08-28T05:03:00.000Z" },
    {
      projectId: registry.projects[0]!.project.id,
      repoId: "attached",
      path: repoAttached,
      expectedConfigRevision: registry.configRevision
    }
  );
  assert.deepEqual(
    attached.workspaces.map((workspace) => workspace.repoId).sort(),
    ["attached", "primary", "secondary"]
  );

  const renamed = service.rename(
    { ...context, now: "2026-08-28T05:04:00.000Z" },
    {
      projectId: attached.project.id,
      displayName: "ChatCockpit Product",
      expectedConfigRevision: attached.configRevision
    }
  );
  assert.equal(renamed.project.displayName, "ChatCockpit Product");
  const attachedWorkspace = renamed.workspaces.find((workspace) => workspace.repoId === "attached");
  assert.ok(attachedWorkspace);

  const reprioritized = service.makePrimaryWorkspace(
    { ...context, now: "2026-08-28T05:05:00.000Z" },
    {
      projectId: renamed.project.id,
      workspaceId: attachedWorkspace.id,
      expectedConfigRevision: renamed.configRevision
    }
  );
  assert.equal(reprioritized.project.defaultWorkspaceId, attachedWorkspace.id);

  const created = service.create(
    { ...context, now: "2026-08-28T05:06:00.000Z" },
    {
      slug: "other-project",
      displayName: "Other Project",
      repoId: "other",
      path: repoOther,
      expectedConfigRevision: reprioritized.configRevision
    }
  );
  assert.equal(created.project.slug, "other-project");
  assert.equal(created.project.displayName, "Other Project");
  assert.deepEqual(created.workspaces.map((workspace) => workspace.repoId), ["other"]);
  assert.equal(service.list({ ...context, now: "2026-08-28T05:07:00.000Z" }).length, 2);

  process.stdout.write("VERIFY_PROJECT_REGISTRY_OK\n");
} finally {
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
}
