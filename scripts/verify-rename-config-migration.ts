import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildChatCockpitTargetConfigPreview,
  loadUserConfig
} from "../src/core/config.js";
import { buildSourceDistributionContext } from "../src/core/distribution-context.js";
import {
  assessChatCockpitTargetConfig,
  migrateLegacyUserConfigToChatCockpit
} from "../src/migration/chatcockpit-config-migration.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-rename-config-"));
const repoRoot = path.join(root, "repo");
const configPath = path.join(root, "config.json");
fs.mkdirSync(repoRoot, { recursive: true });

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

const migrated = loadUserConfig(repoRoot, context);
assert.equal(migrated.schemaVersion, 1);
assert.equal(migrated.defaultRepoId, "tokenpilot");
assert.equal(migrated.repoMappings.tokenpilot?.path, fs.realpathSync.native(repoRoot));
assert.equal(fs.readFileSync(configPath, "utf8"), legacyRaw);

const pureTarget = migrateLegacyUserConfigToChatCockpit(JSON.parse(legacyRaw));
assert.equal(pureTarget.schemaVersion, 1);
assert.equal(pureTarget.defaultRepoId, "primary");
assert.equal(pureTarget.repoMappings.primary?.path, fs.realpathSync.native(repoRoot));
assert.equal(pureTarget.repoMappings.tokenpilot, undefined);

const customRepoRoot = path.join(root, "custom-repo");
fs.mkdirSync(customRepoRoot, { recursive: true });
const customTarget = migrateLegacyUserConfigToChatCockpit({
  workspaceAllowlist: [repoRoot, customRepoRoot],
  repoMappings: {
    tokenpilot: { path: repoRoot },
    custom: { path: customRepoRoot }
  }
});
assert.equal(customTarget.repoMappings.primary?.path, fs.realpathSync.native(repoRoot));
assert.equal(customTarget.repoMappings.custom?.path, fs.realpathSync.native(customRepoRoot));

const equivalent = assessChatCockpitTargetConfig({
  legacyConfigRaw: JSON.parse(legacyRaw),
  targetConfigRaw: pureTarget
});
assert.equal(equivalent.disposition, "canonical-equivalent");
assert.deepEqual(equivalent.blockers, []);

const conflicting = assessChatCockpitTargetConfig({
  legacyConfigRaw: JSON.parse(legacyRaw),
  targetConfigRaw: {
    ...pureTarget,
    workspaceAllowlist: [repoRoot, customRepoRoot],
    repoMappings: {
      ...pureTarget.repoMappings,
      primary: { path: customRepoRoot }
    }
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
assert.equal(target.schemaVersion, 1);
assert.equal(target.defaultRepoId, "primary");
assert.equal(target.repoMappings.primary?.path, fs.realpathSync.native(repoRoot));
assert.equal(target.repoMappings.tokenpilot, undefined);

fs.writeFileSync(
  configPath,
  JSON.stringify({
    schemaVersion: 2,
    defaultRepoId: "primary",
    workspaceAllowlist: [repoRoot],
    repoMappings: { primary: { path: repoRoot } }
  }),
  "utf8"
);
assert.throws(() => loadUserConfig(repoRoot, context), /schemaVersion 2 is unsupported/);

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
