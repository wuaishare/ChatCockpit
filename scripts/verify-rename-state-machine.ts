import assert from "node:assert/strict";

import {
  assertRenameMigrationTransition,
  canRenameMigrationTransition
} from "../src/migration/rename-state-machine.js";
import {
  buildRenameMigrationManifest,
  classifyRenameStatePath
} from "../src/migration/rename-state-classifier.js";

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

assert.equal(
  classifyRenameStatePath("runtime/continuity.sqlite").classification,
  "durable-copy"
);
assert.equal(
  classifyRenameStatePath("jobs/queued/job-1.json").classification,
  "durable-copy-with-revalidation"
);
assert.equal(
  classifyRenameStatePath("runtime/oauth.sqlite").classification,
  "security-reset"
);
assert.equal(
  classifyRenameStatePath("runtime/process-supervisor.token").classification,
  "security-reset"
);
assert.equal(
  classifyRenameStatePath("runtime/process-supervisor.sock").classification,
  "ephemeral-never-migrate"
);
assert.equal(
  classifyRenameStatePath("runtime/runner.log").classification,
  "archive-only"
);
assert.equal(
  classifyRenameStatePath("runtime/future-authority.bin").classification,
  "unknown-do-not-activate"
);

const manifest = buildRenameMigrationManifest(
  "legacy-detected",
  ["runtime/continuity.sqlite", "runtime/server.env", "runtime/future-authority.bin"]
);
assert.equal(manifest.secretMaterialIncluded, false);
assert.deepEqual(manifest.identityPreservations, [
  { kind: "repo-id", value: "tokenpilot", action: "preserve" }
]);

process.stdout.write("VERIFY_RENAME_STATE_MACHINE_OK\n");
