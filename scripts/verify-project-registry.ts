import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProjectService } from "../src/application/project-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { serializeUserConfigV3 } from "../src/core/user-config-schema.ts";
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
  input: {
    displayName: string;
    primary: "primary" | "secondary" | "docs";
  }
): void {
  const primaryRootId = rootIdForRepoId("primary");
  const secondaryRootId = rootIdForRepoId("secondary");
  const docsRootId = "root_docs_fixture";
  const config = {
    schemaVersion: 3 as const,
    workspaceDiscoveryRoots: [],
    workspaceAllowlist: [repoPrimary, repoSecondary],
    projects: {
      chatcockpit: {
        displayName: input.displayName,
        primaryRootId:
          input.primary === "primary"
            ? primaryRootId
            : input.primary === "secondary"
              ? secondaryRootId
              : docsRootId,
        rootIds: [docsRootId, primaryRootId, secondaryRootId].sort()
      }
    },
    projectRoots: {
      [primaryRootId]: {
        path: repoPrimary,
        kind: "git-repository" as const,
        role: "primary-source" as const,
        access: "read-write" as const
      },
      [secondaryRootId]: {
        path: repoSecondary,
        kind: "git-repository" as const,
        role: "supporting-source" as const,
        access: "read-write" as const
      },
      [docsRootId]: {
        path: docsRoot,
        kind: "directory" as const,
        role: "documentation" as const,
        access: "read-only" as const
      }
    },
    executionWorkspaces: {
      primary: {
        projectRootId: primaryRootId,
        path: repoPrimary,
        kind: "checkout" as const,
        provenance: "registered" as const
      },
      secondary: {
        projectRootId: secondaryRootId,
        path: repoSecondary,
        kind: "checkout" as const,
        provenance: "registered" as const
      }
    },
    defaultRepoId: "primary",
    repoMappings: {
      primary: { path: repoPrimary },
      secondary: { path: repoSecondary }
    }
  };
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(serializeUserConfigV3(config), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-project-registry-"));
const repoPrimary = path.join(root, "chatcockpit-primary");
const repoSecondary = path.join(root, "chatcockpit-secondary");
const repoAttached = path.join(root, "chatcockpit-attached");
const repoOther = path.join(root, "other-project");
const docsRoot = path.join(root, "chatcockpit-docs");
const knowledgeRoot = path.join(root, "chatcockpit-knowledge");
initRepo(repoPrimary, "primary.txt");
initRepo(repoSecondary, "secondary.txt");
initRepo(repoAttached, "attached.txt");
initRepo(repoOther, "other.txt");
fs.mkdirSync(docsRoot, { recursive: true });
fs.mkdirSync(knowledgeRoot, { recursive: true });

const paths = buildFixturePaths(repoPrimary);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
writeConfig(paths.configPath, { displayName: "ChatCockpit", primary: "primary" });

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

  const initialRegistry = service.registry(context);
  assert.equal(initialRegistry.projects[0]?.roots.length, 3);
  assert.equal(initialRegistry.projects[0]?.roots.some((entry) => "privatePath" in entry), false);
  const initialDetail = service.registryProject(context, initialRegistry.projects[0]!.project.id);
  assert.equal(initialDetail.roots.length, 3);
  assert.equal(initialDetail.roots.every((entry) => entry.pathVisibility === "machine-local-owner"), true);
  assert.equal(initialDetail.roots.some((entry) => entry.privatePath === fs.realpathSync.native(docsRoot)), true);

  writeConfig(paths.configPath, {
    displayName: "ChatCockpit Platform",
    primary: "secondary"
  });
  const updated = service.list({ ...context, now: "2026-08-28T05:01:00.000Z" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.project.displayName, "ChatCockpit Platform");
  const updatedPrimary = updated[0]?.workspaces.find(
    (workspace) => workspace.id === updated[0]?.project.defaultWorkspaceId
  );
  assert.equal(updatedPrimary?.repoId, "secondary");

  writeConfig(paths.configPath, {
    displayName: "ChatCockpit Platform",
    primary: "docs"
  });
  const docsPrimary = service.list({ ...context, now: "2026-08-28T05:01:30.000Z" });
  assert.equal(docsPrimary[0]?.project.defaultWorkspaceId, null);
  assert.equal(docsPrimary[0]?.workspaces.length, 2);

  const registry = service.registry({ ...context, now: "2026-08-28T05:02:00.000Z" });
  const projectId = registry.projects[0]!.project.id;
  const attached = service.attachRoot(
    { ...context, now: "2026-08-28T05:03:00.000Z" },
    {
      projectId,
      rootPath: repoAttached,
      kind: "git-repository",
      role: "supporting-source",
      access: "read-write",
      repoId: "attached",
      expectedConfigRevision: registry.configRevision
    }
  );
  assert.deepEqual(
    attached.workspaces.map((workspace) => workspace.repoId).sort(),
    ["attached", "primary", "secondary"]
  );
  const attachedRoot = attached.roots.find((entry) =>
    entry.executionWorkspaceIds.some((workspaceId) =>
      attached.workspaces.some((workspace) => workspace.id === workspaceId && workspace.repoId === "attached")
    )
  );
  assert.ok(attachedRoot);
  assert.equal(attachedRoot.role, "supporting-source");

  const withKnowledge = service.attachRoot(
    { ...context, now: "2026-08-28T05:03:30.000Z" },
    {
      projectId,
      rootPath: knowledgeRoot,
      kind: "directory",
      role: "knowledge",
      access: "read-only",
      expectedConfigRevision: attached.configRevision
    }
  );
  const knowledge = withKnowledge.roots.find((entry) => entry.role === "knowledge");
  assert.ok(knowledge);
  assert.deepEqual(knowledge.executionWorkspaceIds, []);
  assert.equal(withKnowledge.workspaces.length, 3);

  const renamed = service.rename(
    { ...context, now: "2026-08-28T05:04:00.000Z" },
    {
      projectId,
      displayName: "ChatCockpit Product",
      expectedConfigRevision: withKnowledge.configRevision
    }
  );
  assert.equal(renamed.project.displayName, "ChatCockpit Product");

  const reprioritized = service.makePrimaryRoot(
    { ...context, now: "2026-08-28T05:05:00.000Z" },
    {
      projectId,
      rootId: attachedRoot.id,
      expectedConfigRevision: renamed.configRevision
    }
  );
  const attachedWorkspace = reprioritized.workspaces.find((workspace) => workspace.repoId === "attached");
  assert.ok(attachedWorkspace);
  assert.equal(reprioritized.project.defaultWorkspaceId, attachedWorkspace.id);
  assert.equal(reprioritized.roots.find((entry) => entry.id === attachedRoot.id)?.primary, true);

  const created = service.createProject(
    { ...context, now: "2026-08-28T05:06:00.000Z" },
    {
      slug: "other-project",
      displayName: "Other Project",
      rootPath: repoOther,
      kind: "git-repository",
      role: "primary-source",
      access: "read-write",
      repoId: "other",
      expectedConfigRevision: reprioritized.configRevision
    }
  );
  assert.equal(created.project.slug, "other-project");
  assert.equal(created.project.displayName, "Other Project");
  assert.deepEqual(created.workspaces.map((workspace) => workspace.repoId), ["other"]);
  assert.equal(created.roots.length, 1);
  assert.equal(created.roots[0]?.primary, true);
  assert.equal(service.list({ ...context, now: "2026-08-28T05:07:00.000Z" }).length, 2);

  process.stdout.write("VERIFY_PROJECT_REGISTRY_OK\n");
} finally {
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
}
