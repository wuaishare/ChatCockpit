import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildChatCockpitTargetConfigPreview,
  loadUserConfig
} from "../src/core/config.js";
import { buildSourceDistributionContext } from "../src/core/distribution-context.js";
import { rootIdForRepoId } from "../src/core/project-config-identity.js";
import {
  assessChatCockpitTargetConfig,
  migrateLegacyUserConfigToChatCockpit
} from "../src/migration/chatcockpit-config-migration.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-rename-config-"));
const repoRoot = path.join(root, "repo");
const configPath = path.join(root, "config.json");
fs.mkdirSync(repoRoot, { recursive: true });

const canonicalRepoRoot = fs.realpathSync.native(repoRoot);
const tokenpilotRootId = rootIdForRepoId("tokenpilot");
const primaryRootId = rootIdForRepoId("primary");
const context = buildSourceDistributionContext(repoRoot, { configPath });
const legacyRaw = JSON.stringify(
  {
    workspaceAllowlist: [repoRoot],
    repoMappings: {
      tokenpilot: { path: repoRoot }
    }
  },
  null,
  2
) + "\n";
fs.writeFileSync(configPath, legacyRaw, "utf8");

// Reading legacy config migrates only in memory; it must not rewrite disk implicitly.
const migrated = loadUserConfig(repoRoot, context);
assert.equal(migrated.schemaVersion, 3);
assert.equal(migrated.defaultRepoId, "tokenpilot");
assert.equal(migrated.repoMappings.tokenpilot?.path, canonicalRepoRoot);
assert.deepEqual(migrated.projects.tokenpilot, {
  displayName: "tokenpilot",
  primaryRootId: tokenpilotRootId,
  rootIds: [tokenpilotRootId]
});
assert.deepEqual(migrated.projectRoots[tokenpilotRootId], {
  path: canonicalRepoRoot,
  kind: "git-repository",
  role: "primary-source",
  access: "read-write"
});
assert.deepEqual(migrated.executionWorkspaces.tokenpilot, {
  projectRootId: tokenpilotRootId,
  path: canonicalRepoRoot,
  kind: "checkout",
  provenance: "registered"
});
assert.equal(fs.readFileSync(configPath, "utf8"), legacyRaw);

// Product rename remaps both the compatibility repoId and the durable ProjectRoot identity.
const pureTarget = migrateLegacyUserConfigToChatCockpit(JSON.parse(legacyRaw));
assert.equal(pureTarget.schemaVersion, 3);
assert.equal(pureTarget.defaultRepoId, "primary");
assert.equal(pureTarget.repoMappings.primary?.path, canonicalRepoRoot);
assert.equal(pureTarget.repoMappings.tokenpilot, undefined);
assert.deepEqual(pureTarget.projects.primary, {
  displayName: "primary",
  primaryRootId,
  rootIds: [primaryRootId]
});
assert.equal(pureTarget.projects.tokenpilot, undefined);
assert.deepEqual(pureTarget.projectRoots[primaryRootId], {
  path: canonicalRepoRoot,
  kind: "git-repository",
  role: "primary-source",
  access: "read-write"
});
assert.equal(pureTarget.projectRoots[tokenpilotRootId], undefined);
assert.deepEqual(pureTarget.executionWorkspaces.primary, {
  projectRootId: primaryRootId,
  path: canonicalRepoRoot,
  kind: "checkout",
  provenance: "registered"
});
assert.equal(pureTarget.executionWorkspaces.tokenpilot, undefined);

const customRepoRoot = path.join(root, "custom-repo");
const discoveryRoot = path.join(root, "discovery-root");
fs.mkdirSync(customRepoRoot, { recursive: true });
fs.mkdirSync(discoveryRoot, { recursive: true });
const canonicalCustomRoot = fs.realpathSync.native(customRepoRoot);
const customRootId = rootIdForRepoId("custom");
const customTarget = migrateLegacyUserConfigToChatCockpit({
  workspaceDiscoveryRoots: [discoveryRoot],
  workspaceAllowlist: [repoRoot, customRepoRoot],
  repoMappings: {
    tokenpilot: { path: repoRoot },
    custom: { path: customRepoRoot }
  }
});
assert.equal(customTarget.repoMappings.primary?.path, canonicalRepoRoot);
assert.equal(customTarget.repoMappings.custom?.path, canonicalCustomRoot);
assert.deepEqual(customTarget.projects.primary, {
  displayName: "primary",
  primaryRootId,
  rootIds: [primaryRootId]
});
assert.deepEqual(customTarget.projects.custom, {
  displayName: "custom",
  primaryRootId: customRootId,
  rootIds: [customRootId]
});
assert.equal(customTarget.projectRoots[customRootId]?.path, canonicalCustomRoot);
assert.equal(customTarget.executionWorkspaces.custom?.projectRootId, customRootId);
assert.deepEqual(customTarget.workspaceDiscoveryRoots, [fs.realpathSync.native(discoveryRoot)]);

const equivalent = assessChatCockpitTargetConfig({
  legacyConfigRaw: JSON.parse(legacyRaw),
  targetConfigRaw: pureTarget
});
assert.equal(equivalent.disposition, "canonical-equivalent");
assert.deepEqual(equivalent.blockers, []);

const conflicting = assessChatCockpitTargetConfig({
  legacyConfigRaw: JSON.parse(legacyRaw),
  targetConfigRaw: {
    schemaVersion: 3,
    workspaceDiscoveryRoots: pureTarget.workspaceDiscoveryRoots,
    workspaceAllowlist: [repoRoot, customRepoRoot],
    projects: pureTarget.projects,
    projectRoots: pureTarget.projectRoots,
    executionWorkspaces: pureTarget.executionWorkspaces
  }
});
assert.equal(conflicting.disposition, "conflict");
assert.equal(
  conflicting.blockers.includes("target-config-does-not-match-migrated-legacy-config"),
  true
);

assert.throws(
  () =>
    migrateLegacyUserConfigToChatCockpit({
      workspaceAllowlist: [repoRoot],
      repoMappings: {
        tokenpilot: { path: repoRoot },
        primary: { path: repoRoot }
      }
    }),
  /reserved target repoId primary|resolve to the same physical path/
);
assert.throws(
  () =>
    migrateLegacyUserConfigToChatCockpit({
      workspaceAllowlist: [repoRoot],
      repoMappings: {
        tokenpilot: { path: repoRoot, extra: "not-supported" }
      }
    }),
  /unsupported field/
);

const target = buildChatCockpitTargetConfigPreview(repoRoot, context);
assert.equal(target.schemaVersion, 3);
assert.equal(target.defaultRepoId, "primary");
assert.equal(target.repoMappings.primary?.path, canonicalRepoRoot);
assert.equal(target.repoMappings.tokenpilot, undefined);
assert.deepEqual(target.projects.primary, {
  displayName: "primary",
  primaryRootId,
  rootIds: [primaryRootId]
});
assert.equal(target.projectRoots[primaryRootId]?.path, canonicalRepoRoot);
assert.equal(target.executionWorkspaces.primary?.projectRootId, primaryRootId);

fs.writeFileSync(
  configPath,
  JSON.stringify({
    schemaVersion: 3,
    workspaceDiscoveryRoots: [],
    workspaceAllowlist: [repoRoot],
    projects: {
      primary: {
        displayName: "primary",
        primaryRootId: "root_missing",
        rootIds: ["root_missing"]
      }
    },
    projectRoots: {},
    executionWorkspaces: {}
  }),
  "utf8"
);
assert.throws(() => loadUserConfig(repoRoot, context), /references unknown rootId root_missing/);

fs.writeFileSync(
  configPath,
  JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [repoRoot],
    repoMappings: {}
  }),
  "utf8"
);
assert.throws(() => loadUserConfig(repoRoot, context), /defaultRepoId primary has no repo mapping/);

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("VERIFY_RENAME_CONFIG_MIGRATION_OK\n");
