import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProviderSessionClassificationService } from "../src/application/provider-session-classification-service.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-provider-session-classification-"));
const primaryRoot = path.join(root, "app");
const nestedRoot = path.join(primaryRoot, "packages", "plugin");
const primarySubdir = path.join(primaryRoot, "src");
const nestedSubdir = path.join(nestedRoot, "src");
const worktreeRoot = path.join(root, "worktrees", "feature-a");
const worktreeSubdir = path.join(worktreeRoot, "src");
const outsideRoot = path.join(root, "standalone");
for (const directory of [
  primaryRoot,
  nestedRoot,
  primarySubdir,
  nestedSubdir,
  worktreeRoot,
  worktreeSubdir,
  outsideRoot
]) {
  fs.mkdirSync(directory, { recursive: true });
}

const paths = buildFixturePaths(primaryRoot);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
const primaryRootId = rootIdForRepoId("primary");
const nestedRootId = rootIdForRepoId("plugin");
const config = {
  schemaVersion: 3,
  workspaceDiscoveryRoots: [],
  workspaceAllowlist: [primaryRoot, worktreeRoot],
  projects: {
    app: {
      displayName: "App",
      primaryRootId,
      rootIds: [primaryRootId, nestedRootId].sort()
    }
  },
  projectRoots: {
    [primaryRootId]: {
      path: primaryRoot,
      kind: "git-repository",
      role: "primary-source",
      access: "read-write"
    },
    [nestedRootId]: {
      path: nestedRoot,
      kind: "directory",
      role: "supporting-source",
      access: "read-write"
    }
  },
  executionWorkspaces: {
    primary: {
      projectRootId: primaryRootId,
      path: primaryRoot,
      kind: "checkout",
      provenance: "registered"
    },
    "feature-a": {
      projectRootId: primaryRootId,
      path: worktreeRoot,
      kind: "worktree",
      provenance: "chatcockpit-created"
    }
  }
};
const configText = `${JSON.stringify(config, null, 2)}\n`;
fs.writeFileSync(paths.configPath, configText, { encoding: "utf8", mode: 0o600 });

try {
  const service = new ProviderSessionClassificationService(paths);
  const before = fs.readFileSync(paths.configPath, "utf8");
  const results = service.classify([
    {
      providerId: "codex",
      nativeSessionId: "thread-primary",
      privatePath: primarySubdir,
      label: "Primary work",
      observedAt: 100
    },
    {
      providerId: "codex",
      nativeSessionId: "thread-worktree",
      privatePath: worktreeSubdir,
      label: "Feature worktree",
      observedAt: 110
    },
    {
      providerId: "claude",
      nativeSessionId: "session-nested",
      privatePath: nestedSubdir,
      label: "Nested repo ambiguity",
      observedAt: 120
    },
    {
      providerId: "codex",
      nativeSessionId: "thread-standalone",
      privatePath: outsideRoot,
      label: "Standalone",
      observedAt: 130
    }
  ]);
  const after = fs.readFileSync(paths.configPath, "utf8");

  assert.equal(before, after, "classification must not mutate Project Registry or provider history");
  assert.equal(results.length, 4);

  const primary = results.find((entry) => entry.nativeSessionId === "thread-primary");
  assert.ok(primary);
  assert.equal(primary.classification, "project-scoped");
  assert.equal(primary.projectSlug, "app");
  assert.equal(primary.projectRootId, primaryRootId);
  assert.equal(primary.executionRepoId, "primary");
  assert.deepEqual(primary.matchedProjectRootIds, [primaryRootId]);
  assert.deepEqual(primary.matchedExecutionRepoIds, ["primary"]);

  const worktree = results.find((entry) => entry.nativeSessionId === "thread-worktree");
  assert.ok(worktree);
  assert.equal(worktree.classification, "project-scoped");
  assert.equal(worktree.projectSlug, "app");
  assert.equal(worktree.projectRootId, primaryRootId);
  assert.equal(worktree.executionRepoId, "feature-a");
  assert.deepEqual(worktree.matchedExecutionRepoIds, ["feature-a"]);

  const nested = results.find((entry) => entry.nativeSessionId === "session-nested");
  assert.ok(nested);
  assert.equal(nested.classification, "review-required");
  assert.equal(nested.projectSlug, null);
  assert.equal(nested.projectRootId, null);
  assert.deepEqual(nested.matchedProjectSlugs, ["app"]);
  assert.deepEqual(nested.matchedProjectRootIds, [nestedRootId, primaryRootId].sort());
  assert.deepEqual(nested.matchedExecutionRepoIds, ["primary"]);

  const standalone = results.find((entry) => entry.nativeSessionId === "thread-standalone");
  assert.ok(standalone);
  assert.equal(standalone.classification, "standalone");
  assert.equal(standalone.projectSlug, null);
  assert.deepEqual(standalone.matchedProjectRootIds, []);
  assert.deepEqual(standalone.matchedExecutionRepoIds, []);

  const serialized = JSON.stringify(results);
  assert.equal(serialized.includes(primarySubdir), false);
  assert.equal(serialized.includes(worktreeSubdir), false);
  assert.equal(serialized.includes(nestedSubdir), false);
  assert.equal(serialized.includes(outsideRoot), false);

  process.stdout.write("VERIFY_PROVIDER_SESSION_CLASSIFICATION_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
