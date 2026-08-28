import assert from "node:assert/strict";

import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import {
  parseUserConfig,
  serializeUserConfigV3
} from "../src/core/user-config-schema.ts";

const primaryPath = "/fixture/chatcockpit";
const secondaryPath = "/fixture/chatcockpit-plugins";

const rawV2 = {
  schemaVersion: 2,
  defaultRepoId: "primary",
  workspaceDiscoveryRoots: ["/fixture"],
  workspaceAllowlist: [primaryPath, secondaryPath],
  repoMappings: {
    primary: { path: primaryPath },
    secondary: { path: secondaryPath }
  },
  projects: {
    chatcockpit: {
      displayName: " ChatCockpit ",
      primaryRepoId: "primary",
      repoIds: ["secondary", "primary", "secondary"]
    }
  }
};

const parsed = parseUserConfig(rawV2);
assert.equal(parsed.sourceSchemaVersion, 2);
assert.equal(parsed.config.schemaVersion, 3);
assert.deepEqual(Object.keys(parsed.config.projects), ["chatcockpit"]);

const project = parsed.config.projects.chatcockpit;
assert.ok(project);
const primaryRootId = rootIdForRepoId("primary");
const secondaryRootId = rootIdForRepoId("secondary");
assert.equal(project.displayName, "ChatCockpit");
assert.equal(project.primaryRootId, primaryRootId);
assert.deepEqual(project.rootIds, [primaryRootId, secondaryRootId].sort());

assert.deepEqual(parsed.config.projectRoots[primaryRootId], {
  path: primaryPath,
  kind: "git-repository",
  role: "primary-source",
  access: "read-write"
});
assert.deepEqual(parsed.config.projectRoots[secondaryRootId], {
  path: secondaryPath,
  kind: "git-repository",
  role: "supporting-source",
  access: "read-write"
});
assert.deepEqual(parsed.config.executionWorkspaces.primary, {
  projectRootId: primaryRootId,
  path: primaryPath,
  kind: "checkout",
  provenance: "registered"
});
assert.deepEqual(parsed.config.executionWorkspaces.secondary, {
  projectRootId: secondaryRootId,
  path: secondaryPath,
  kind: "checkout",
  provenance: "registered"
});

// Compatibility projection remains available in memory while legacy consumers migrate.
assert.equal(parsed.config.defaultRepoId, "primary");
assert.equal(parsed.config.repoMappings.primary?.path, primaryPath);
assert.equal(parsed.config.repoMappings.secondary?.path, secondaryPath);

const persisted = serializeUserConfigV3(parsed.config, {
  existingRaw: {
    customSafeField: { preserved: true },
    defaultRepoId: "stale",
    repoMappings: { stale: { path: "/stale" } }
  }
});
assert.equal(persisted.schemaVersion, 3);
assert.equal("defaultRepoId" in persisted, false);
assert.equal("repoMappings" in persisted, false);
assert.deepEqual(persisted.customSafeField, { preserved: true });
assert.deepEqual(Object.keys(persisted.projects as Record<string, unknown>), ["chatcockpit"]);
assert.equal(Object.keys(persisted.projectRoots as Record<string, unknown>).length, 2);
assert.equal(Object.keys(persisted.executionWorkspaces as Record<string, unknown>).length, 2);

const reparsed = parseUserConfig(persisted);
assert.equal(reparsed.sourceSchemaVersion, 3);
assert.deepEqual(reparsed.config.projects, parsed.config.projects);
assert.deepEqual(reparsed.config.projectRoots, parsed.config.projectRoots);
assert.deepEqual(reparsed.config.executionWorkspaces, parsed.config.executionWorkspaces);

const persistedAgain = serializeUserConfigV3(reparsed.config, { existingRaw: persisted });
assert.deepEqual(persistedAgain, persisted);

const rawV1 = {
  schemaVersion: 1,
  defaultRepoId: "alpha",
  workspaceDiscoveryRoots: [],
  workspaceAllowlist: ["/fixture/alpha"],
  repoMappings: {
    alpha: { path: "/fixture/alpha" }
  }
};
const parsedV1 = parseUserConfig(rawV1);
assert.equal(parsedV1.sourceSchemaVersion, 1);
assert.equal(parsedV1.config.projects.alpha?.primaryRootId, rootIdForRepoId("alpha"));
assert.equal(parsedV1.config.executionWorkspaces.alpha?.projectRootId, rootIdForRepoId("alpha"));

const rawLegacy = {
  workspaceDiscoveryRoots: [],
  workspaceAllowlist: [],
  repoMappings: {}
};
const parsedLegacy = parseUserConfig(rawLegacy);
assert.equal(parsedLegacy.sourceSchemaVersion, 0);
assert.equal(parsedLegacy.config.schemaVersion, 3);
assert.deepEqual(parsedLegacy.config.projects, {});
assert.deepEqual(parsedLegacy.config.projectRoots, {});
assert.deepEqual(parsedLegacy.config.executionWorkspaces, {});

assert.throws(
  () =>
    parseUserConfig({
      schemaVersion: 3,
      workspaceDiscoveryRoots: [],
      workspaceAllowlist: [],
      projects: {
        broken: {
          displayName: "Broken",
          primaryRootId: "root_missing",
          rootIds: ["root_missing"]
        }
      },
      projectRoots: {},
      executionWorkspaces: {}
    }),
  /references unknown rootId root_missing/
);

process.stdout.write("VERIFY_PROJECT_ROOT_CONFIG_V3_OK\n");
