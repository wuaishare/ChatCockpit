import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../src/application/service-error.ts";
import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import { parseUserConfig } from "../src/core/user-config-schema.ts";
import { WorkspaceConfigStore } from "../src/workspaces/workspace-config-store.ts";

function canonical(input: string): string {
  return fs.realpathSync.native(path.resolve(input));
}

function serviceCode(error: unknown): string | null {
  return error instanceof ServiceError ? error.code : null;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-workspace-config-store-"));
const configPath = path.join(root, "config", "config.json");
const repoRoot = path.join(root, "repos", "primary");
const discoveryA = path.join(root, "projects-a");
const discoveryB = path.join(root, "projects-b");
const importedRepo = path.join(discoveryA, "imported-repo");
const attachedRepo = path.join(root, "repos", "attached-repo");
const docsRoot = path.join(root, "docs");
for (const directory of [repoRoot, importedRepo, attachedRepo, docsRoot, discoveryB]) {
  fs.mkdirSync(directory, { recursive: true });
}
fs.mkdirSync(path.dirname(configPath), { recursive: true });

const primaryRootId = rootIdForRepoId("primary");
const secondaryRootId = rootIdForRepoId("secondary");

const parsed = parseUserConfig({
  schemaVersion: 1,
  defaultRepoId: "primary",
  workspaceDiscoveryRoots: [discoveryA],
  workspaceAllowlist: [repoRoot],
  repoMappings: { primary: { path: repoRoot } }
});
assert.equal(parsed.sourceSchemaVersion, 1);
assert.equal(parsed.config.schemaVersion, 3);
assert.deepEqual(parsed.config.workspaceDiscoveryRoots, [discoveryA]);
assert.deepEqual(parsed.config.projects, {
  primary: {
    displayName: "primary",
    primaryRootId,
    rootIds: [primaryRootId]
  }
});
assert.deepEqual(parsed.config.projectRoots[primaryRootId], {
  path: repoRoot,
  kind: "git-repository",
  role: "primary-source",
  access: "read-write"
});
assert.equal(parsed.config.executionWorkspaces.primary?.projectRootId, primaryRootId);

const grouped = parseUserConfig({
  schemaVersion: 2,
  defaultRepoId: "primary",
  workspaceDiscoveryRoots: [discoveryA],
  workspaceAllowlist: [repoRoot, importedRepo],
  repoMappings: {
    primary: { path: repoRoot },
    secondary: { path: importedRepo }
  },
  projects: {
    chatcockpit: {
      displayName: "ChatCockpit",
      primaryRepoId: "primary",
      repoIds: ["primary", "secondary"]
    }
  }
});
assert.equal(grouped.sourceSchemaVersion, 2);
assert.deepEqual(grouped.config.projects.chatcockpit, {
  displayName: "ChatCockpit",
  primaryRootId,
  rootIds: [primaryRootId, secondaryRootId].sort()
});
assert.throws(
  () =>
    parseUserConfig({
      schemaVersion: 2,
      defaultRepoId: "primary",
      workspaceDiscoveryRoots: [],
      workspaceAllowlist: [repoRoot],
      repoMappings: { primary: { path: repoRoot } },
      projects: {
        first: { displayName: "First", primaryRepoId: "primary", repoIds: ["primary"] },
        second: { displayName: "Second", primaryRepoId: "primary", repoIds: ["primary"] }
      }
    }),
  /more than one project/i
);

const legacy = parseUserConfig({
  schemaVersion: 1,
  defaultRepoId: "primary",
  workspaceAllowlist: [repoRoot],
  repoMappings: { primary: { path: repoRoot } }
});
assert.deepEqual(legacy.config.workspaceDiscoveryRoots, []);

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceDiscoveryRoots: [discoveryA],
      workspaceAllowlist: [repoRoot],
      repoMappings: {
        primary: {
          path: repoRoot,
          futureMappingField: "legacy-nested-field-is-not-canonical"
        }
      },
      futureTopLevelField: { preserve: true }
    },
    null,
    2
  )}\n`,
  { encoding: "utf8", mode: 0o600 }
);

const store = new WorkspaceConfigStore({ configPath });
const initial = store.snapshot();
assert.deepEqual(initial.discoveryRoots, [canonical(discoveryA)]);
assert.equal(initial.defaultRepoId, "primary");
assert.deepEqual(initial.projects, {
  primary: {
    displayName: "primary",
    primaryRootId,
    rootIds: [primaryRootId]
  }
});
assert.equal(initial.projectRoots[primaryRootId]?.path, canonical(repoRoot));
assert.equal(initial.executionWorkspaces.primary?.projectRootId, primaryRootId);
assert.match(initial.revision, /^[a-f0-9]{64}$/);

const added = store.addDiscoveryRoot(discoveryB, initial.revision);
assert.deepEqual(added.discoveryRoots, [canonical(discoveryA), canonical(discoveryB)].sort());
assert.notEqual(added.revision, initial.revision);

const rawAfterAdd = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
assert.equal(rawAfterAdd.schemaVersion, 3);
assert.equal("defaultRepoId" in rawAfterAdd, false);
assert.equal("repoMappings" in rawAfterAdd, false);
assert.deepEqual(
  (rawAfterAdd.projects as Record<string, unknown>).primary,
  { displayName: "primary", primaryRootId, rootIds: [primaryRootId] }
);
assert.deepEqual(rawAfterAdd.futureTopLevelField, { preserve: true });
assert.equal(JSON.stringify(rawAfterAdd).includes("futureMappingField"), false);

assert.throws(
  () => store.removeDiscoveryRoot(discoveryA, initial.revision),
  (error) => serviceCode(error) === "WORKSPACE_DISCOVERY_REVISION_CONFLICT"
);

const imported = store.importRepo({
  root: discoveryA,
  repoPath: importedRepo,
  repoId: "imported-repo",
  expectedRevision: added.revision
});
const importedRootId = rootIdForRepoId("imported-repo");
assert.equal(imported.repoMappings["imported-repo"]?.path, canonical(importedRepo));
assert.deepEqual(imported.projects["imported-repo"], {
  displayName: "imported-repo",
  primaryRootId: importedRootId,
  rootIds: [importedRootId]
});
assert.equal(imported.projectRoots[importedRootId]?.role, "primary-source");
assert.equal(imported.executionWorkspaces["imported-repo"]?.projectRootId, importedRootId);
assert.equal(imported.workspaceAllowlist.includes(canonical(importedRepo)), true);
assert.equal(imported.workspaceAllowlist.includes(canonical(discoveryA)), false);
assert.equal(imported.discoveryRoots.includes(canonical(discoveryA)), true);

const attached = store.registerRepo({
  repoPath: attachedRepo,
  repoId: "attached-repo",
  projectSlug: "primary",
  expectedRevision: imported.revision
});
const attachedRootId = rootIdForRepoId("attached-repo");
assert.equal(attached.repoMappings["attached-repo"]?.path, canonical(attachedRepo));
assert.deepEqual(attached.projects.primary, {
  displayName: "primary",
  primaryRootId,
  rootIds: [attachedRootId, primaryRootId].sort()
});
assert.equal(attached.projectRoots[attachedRootId]?.role, "supporting-source");
assert.equal(attached.executionWorkspaces["attached-repo"]?.projectRootId, attachedRootId);

const withDocs = store.registerProjectRoot({
  rootPath: docsRoot,
  projectSlug: "primary",
  kind: "directory",
  role: "documentation",
  access: "read-only",
  expectedRevision: attached.revision
});
const docsEntry = Object.entries(withDocs.projectRoots).find(([, entry]) => entry.path === canonical(docsRoot));
assert.ok(docsEntry);
const [docsRootId, docsMapping] = docsEntry;
assert.equal(docsMapping.kind, "directory");
assert.equal(docsMapping.role, "documentation");
assert.equal(docsMapping.access, "read-only");
assert.equal(
  Object.values(withDocs.executionWorkspaces).some((workspace) => workspace.projectRootId === docsRootId),
  false
);
assert.equal(withDocs.projects.primary?.rootIds.includes(docsRootId), true);

const renamed = store.renameProject({
  projectSlug: "primary",
  displayName: "Primary Project",
  expectedRevision: withDocs.revision
});
assert.equal(renamed.projects.primary?.displayName, "Primary Project");

const reprioritized = store.setPrimaryRoot({
  projectSlug: "primary",
  rootId: attachedRootId,
  expectedRevision: renamed.revision
});
assert.equal(reprioritized.projects.primary?.primaryRootId, attachedRootId);

const legacyReprioritized = store.setPrimaryRepo({
  projectSlug: "primary",
  repoId: "primary",
  expectedRevision: reprioritized.revision
});
assert.equal(legacyReprioritized.projects.primary?.primaryRootId, primaryRootId);

const docsPrimary = store.setPrimaryRoot({
  projectSlug: "primary",
  rootId: docsRootId,
  expectedRevision: legacyReprioritized.revision
});
assert.equal(docsPrimary.projects.primary?.primaryRootId, docsRootId);
// Changing the Project primary root does not invent or rewrite a globally selected workspace.
assert.equal(docsPrimary.executionWorkspaces.primary?.projectRootId, primaryRootId);
assert.equal(docsPrimary.executionWorkspaces["attached-repo"]?.projectRootId, attachedRootId);

const rawAfterImport = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
assert.equal(rawAfterImport.schemaVersion, 3);
assert.equal("repoMappings" in rawAfterImport, false);
assert.equal("defaultRepoId" in rawAfterImport, false);
assert.deepEqual(rawAfterImport.futureTopLevelField, { preserve: true });

assert.throws(
  () =>
    store.importRepo({
      root: discoveryA,
      repoPath: importedRepo,
      repoId: "duplicate-physical-repo",
      expectedRevision: docsPrimary.revision
    }),
  (error) => serviceCode(error) === "PROJECT_ROOT_PATH_CONFLICT"
);

assert.throws(
  () => store.addDiscoveryRoot(path.join(root, "missing"), docsPrimary.revision),
  (error) => serviceCode(error) === "WORKSPACE_DISCOVERY_ROOT_NOT_FOUND"
);

if (process.platform !== "win32") {
  const mode = fs.statSync(configPath).mode & 0o777;
  assert.equal(mode, 0o600);
}

const removed = store.removeDiscoveryRoot(discoveryB, docsPrimary.revision);
assert.deepEqual(removed.discoveryRoots, [canonical(discoveryA)]);

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("VERIFY_WORKSPACE_CONFIG_STORE_OK\n");
