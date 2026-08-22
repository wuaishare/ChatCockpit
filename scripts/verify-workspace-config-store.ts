import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseUserConfig } from "../src/core/user-config-schema.ts";
import { ServiceError } from "../src/application/service-error.ts";
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
fs.mkdirSync(repoRoot, { recursive: true });
fs.mkdirSync(importedRepo, { recursive: true });
fs.mkdirSync(discoveryB, { recursive: true });
fs.mkdirSync(path.dirname(configPath), { recursive: true });

const parsed = parseUserConfig({
  schemaVersion: 1,
  defaultRepoId: "primary",
  workspaceDiscoveryRoots: [discoveryA],
  workspaceAllowlist: [repoRoot],
  repoMappings: { primary: { path: repoRoot } }
});
assert.deepEqual(parsed.config.workspaceDiscoveryRoots, [discoveryA]);

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
          futureMappingField: "preserve-me"
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
assert.match(initial.revision, /^[a-f0-9]{64}$/);

const added = store.addDiscoveryRoot(discoveryB, initial.revision);
assert.deepEqual(added.discoveryRoots, [canonical(discoveryA), canonical(discoveryB)].sort());
assert.notEqual(added.revision, initial.revision);

const rawAfterAdd = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
assert.deepEqual(rawAfterAdd.futureTopLevelField, { preserve: true });
assert.equal(
  ((rawAfterAdd.repoMappings as Record<string, Record<string, unknown>>).primary ?? {})
    .futureMappingField,
  "preserve-me"
);

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
assert.equal(imported.repoMappings["imported-repo"]?.path, canonical(importedRepo));
assert.equal(imported.workspaceAllowlist.includes(canonical(importedRepo)), true);
assert.equal(imported.workspaceAllowlist.includes(canonical(discoveryA)), false);
assert.equal(imported.discoveryRoots.includes(canonical(discoveryA)), true);

const rawAfterImport = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
assert.deepEqual(rawAfterImport.futureTopLevelField, { preserve: true });
assert.equal(
  ((rawAfterImport.repoMappings as Record<string, Record<string, unknown>>).primary ?? {})
    .futureMappingField,
  "preserve-me"
);

assert.throws(
  () =>
    store.importRepo({
      root: discoveryA,
      repoPath: importedRepo,
      repoId: "duplicate-physical-repo",
      expectedRevision: imported.revision
    }),
  (error) => serviceCode(error) === "WORKSPACE_ALREADY_REGISTERED"
);

assert.throws(
  () => store.addDiscoveryRoot(path.join(root, "missing"), imported.revision),
  (error) => serviceCode(error) === "WORKSPACE_DISCOVERY_ROOT_NOT_FOUND"
);

if (process.platform !== "win32") {
  const mode = fs.statSync(configPath).mode & 0o777;
  assert.equal(mode, 0o600);
}

const removed = store.removeDiscoveryRoot(discoveryB, imported.revision);
assert.deepEqual(removed.discoveryRoots, [canonical(discoveryA)]);

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("VERIFY_WORKSPACE_CONFIG_STORE_OK\n");
