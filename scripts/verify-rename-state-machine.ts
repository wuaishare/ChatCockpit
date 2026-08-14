import assert from "node:assert/strict";

import {
  assertRenameMigrationTransition,
  canRenameMigrationTransition
} from "../src/migration/rename-state-machine.js";

assert.equal(canRenameMigrationTransition("legacy-detected", "ready-to-migrate"), true);
assert.equal(canRenameMigrationTransition("ready-to-migrate", "quiescing"), true);
assert.equal(canRenameMigrationTransition("quiescing", "snapshotting"), true);
assert.equal(canRenameMigrationTransition("snapshotting", "migrating"), true);
assert.equal(canRenameMigrationTransition("migrating", "verifying"), true);
assert.equal(canRenameMigrationTransition("verifying", "completed"), true);
assert.equal(canRenameMigrationTransition("verifying", "recovery-required"), true);
assert.equal(canRenameMigrationTransition("conflict", "migrating"), false);
assert.equal(canRenameMigrationTransition("completed", "migrating"), false);
assert.throws(
  () => assertRenameMigrationTransition("conflict", "migrating"),
  /Rename migration transition conflict -> migrating is not allowed/
);

process.stdout.write("VERIFY_RENAME_STATE_MACHINE_OK\n");
