import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.js";
import { migrateLegacyUserConfigToChatCockpit } from "../src/migration/chatcockpit-config-migration.js";
import { migrateChatCockpitTargetContinuityDatabase } from "../src/migration/chatcockpit-target-continuity.js";
import {
  buildR4PreflightReport,
  type R4ServiceProbeResult
} from "../src/migration/r4-preflight.js";
import { buildTokenPilotV18FixtureDatabase } from "./fixtures/rename-v0/build-v18-database.js";
import { runGit } from "./test-support/git.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-r4-preflight-"));
const repoRoot = path.join(root, "repo");
const homeRoot = path.join(root, "home");
const legacyStateRoot = path.join(repoRoot, ".tokenpilot");
const targetStateRoot = path.join(homeRoot, ".chatcockpit");
const legacyConfigPath = path.join(homeRoot, ".tokenpilot", "config.json");
const targetConfigPath = path.join(targetStateRoot, "config.json");
const workspace = repoRoot;

const serviceReady: R4ServiceProbeResult = {
  supported: true,
  old: {
    controlPlane: { loaded: true, running: true },
    runner: { loaded: true, running: true },
    processSupervisor: { loaded: false, running: false }
  },
  target: {
    controlPlane: { loaded: false, running: false },
    runner: { loaded: false, running: false },
    processSupervisor: { loaded: false, running: false }
  },
  legacyEndpointReachable: true
};

function ensureTargetScaffold(): void {
  for (const directory of [
    targetStateRoot,
    path.join(targetStateRoot, "bundles"),
    path.join(targetStateRoot, "jobs", "queued"),
    path.join(targetStateRoot, "jobs", "running"),
    path.join(targetStateRoot, "jobs", "completed"),
    path.join(targetStateRoot, "jobs", "failed"),
    path.join(targetStateRoot, "manifests"),
    path.join(targetStateRoot, "runtime")
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

async function report(
  serviceProbe: () => Promise<R4ServiceProbeResult> = async () => serviceReady
) {
  return buildR4PreflightReport({
    repoRoot,
    legacyStateRoot,
    targetStateRoot,
    legacyConfigPath,
    targetConfigPath,
    requirePublicMain: false,
    serviceProbe
  });
}

fs.mkdirSync(repoRoot, { recursive: true });
fs.mkdirSync(path.dirname(legacyConfigPath), { recursive: true });
fs.mkdirSync(path.dirname(targetConfigPath), { recursive: true });
fs.mkdirSync(path.join(legacyStateRoot, "runtime"), { recursive: true });
fs.mkdirSync(path.join(legacyStateRoot, "jobs", "completed"), { recursive: true });
fs.mkdirSync(path.join(legacyStateRoot, "jobs", "failed"), { recursive: true });
fs.mkdirSync(path.join(legacyStateRoot, "jobs", "queued"), { recursive: true });
fs.mkdirSync(path.join(legacyStateRoot, "jobs", "running"), { recursive: true });
ensureTargetScaffold();

const legacyConfig = {
  workspaceAllowlist: [workspace],
  repoMappings: {
    tokenpilot: { path: workspace }
  }
};
fs.writeFileSync(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, "utf8");
fs.writeFileSync(
  targetConfigPath,
  `${JSON.stringify(migrateLegacyUserConfigToChatCockpit(legacyConfig), null, 2)}\n`,
  "utf8"
);

const continuityPath = path.join(legacyStateRoot, "runtime", "continuity.sqlite");
buildTokenPilotV18FixtureDatabase(continuityPath, workspace);
fs.writeFileSync(
  path.join(legacyStateRoot, "jobs", "completed", "completed.json"),
  "{}\n",
  "utf8"
);
fs.writeFileSync(
  path.join(legacyStateRoot, "jobs", "failed", "failed.json"),
  "{}\n",
  "utf8"
);
fs.writeFileSync(path.join(legacyStateRoot, "repomix-output.xml"), "<bundle />\n", "utf8");
fs.mkdirSync(path.join(legacyStateRoot, "runtime", "capabilities"), { recursive: true });
fs.writeFileSync(
  path.join(legacyStateRoot, "runtime", "capabilities", "codex.json"),
  "{}\n",
  "utf8"
);
fs.writeFileSync(
  path.join(legacyStateRoot, "runtime", "server.env"),
  "TOKENPILOT_API_TOKEN=fixture-secret\nTOKENPILOT_EXPOSED=false\n",
  "utf8"
);

fs.writeFileSync(
  path.join(repoRoot, ".gitignore"),
  ".tokenpilot/\n.chatcockpit/\n",
  "utf8"
);
fs.writeFileSync(path.join(repoRoot, "README.md"), "# R4 preflight fixture\n", "utf8");
runGit(repoRoot, ["init"]);
runGit(repoRoot, ["config", "user.email", "chatcockpit-r4@example.invalid"]);
runGit(repoRoot, ["config", "user.name", "ChatCockpit R4 Fixture"]);
runGit(repoRoot, ["add", ".gitignore", "README.md"]);
runGit(repoRoot, ["commit", "-m", "init"]);

const ready = await report();
assert.equal(ready.state, "ready-to-migrate");
assert.deepEqual(ready.blockers, []);
assert.equal(ready.git.clean, true);
assert.equal(ready.storage.capacityGate, true);
assert.equal(ready.storage.snapshotParentWritable, true);
assert.equal(ready.migration.previewState, "legacy-detected");
assert.equal(ready.migration.targetConfigDisposition, "canonical-equivalent");
assert.equal(ready.migration.targetStateDisposition, "empty-scaffold");
assert.equal(ready.migration.unknownEntries, 0);
assert.equal(ready.database.integrity, "ok");
assert.equal(ready.database.schemaVersion, 18);
assert.equal(ready.database.sourceContract, "v18");
assert.equal(ready.database.targetIdentityMarkerPresent, false);
assert.equal(ready.database.activeWriterLeases, 0);
assert.equal(ready.database.activeRuntimeRuns, 0);
assert.deepEqual(ready.jobs, { queued: 0, running: 0, completed: 1, failed: 1 });
assert.deepEqual(ready.worktrees, { discovered: 0, clean: 0, dirty: 0, unreadable: 0 });
assert.equal(ready.services.old.controlPlane.loaded, true);
assert.equal(ready.services.target.controlPlane.loaded, false);
assert.equal(JSON.stringify(ready).includes(root), false, "Preflight report leaked fixture absolute path");
assert.equal(JSON.stringify(ready).includes("fixture-secret"), false, "Preflight report leaked secret");

const compatibilityUpgrade = new ContinuityDatabase({ path: continuityPath });
assert.equal(compatibilityUpgrade.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
compatibilityUpgrade.close();
const currentCompatible = await report();
assert.equal(currentCompatible.state, "ready-to-migrate");
assert.deepEqual(currentCompatible.blockers, []);
assert.equal(currentCompatible.database.schemaVersion, LATEST_CONTINUITY_SCHEMA_VERSION);
assert.equal(currentCompatible.database.sourceContract, "current-compatible");
assert.equal(currentCompatible.database.targetIdentityMarkerPresent, false);

fs.writeFileSync(path.join(legacyStateRoot, "runtime", "unknown-authority.bin"), "x", "utf8");
const unknownBlocked = await report();
assert.equal(unknownBlocked.state, "blocked");
assert.equal(unknownBlocked.blockers.includes("legacy-state-has-unknown-entries"), true);
fs.rmSync(path.join(legacyStateRoot, "runtime", "unknown-authority.bin"));

fs.writeFileSync(path.join(legacyStateRoot, "jobs", "queued", "queued.json"), "{}\n", "utf8");
const queuedBlocked = await report();
assert.equal(queuedBlocked.state, "blocked");
assert.equal(queuedBlocked.blockers.includes("queued-jobs-present"), true);
assert.equal(queuedBlocked.migration.unknownEntries, 0);
fs.rmSync(path.join(legacyStateRoot, "jobs", "queued", "queued.json"));

fs.writeFileSync(path.join(targetStateRoot, "runtime", "server.env"), "CHATCOCKPIT_EXPOSED=false\n");
const targetBlocked = await report();
assert.equal(targetBlocked.state, "blocked");
assert.equal(targetBlocked.migration.targetStateDisposition, "active-conflict");
assert.equal(targetBlocked.blockers.some((value) => value.includes("preview:target-state-active-entry")), true);
fs.rmSync(path.join(targetStateRoot, "runtime", "server.env"));

const worktreeRoot = path.join(legacyStateRoot, "runtime", "worktrees", "fixture-repo", "fixture-wt");
fs.mkdirSync(worktreeRoot, { recursive: true });
fs.writeFileSync(path.join(worktreeRoot, "README.md"), "clean\n", "utf8");
runGit(worktreeRoot, ["init"]);
runGit(worktreeRoot, ["config", "user.email", "worktree@example.invalid"]);
runGit(worktreeRoot, ["config", "user.name", "R4 Worktree Fixture"]);
runGit(worktreeRoot, ["add", "README.md"]);
runGit(worktreeRoot, ["commit", "-m", "init"]);
const cleanWorktree = await report();
assert.equal(cleanWorktree.state, "ready-to-migrate");
assert.deepEqual(cleanWorktree.worktrees, { discovered: 1, clean: 1, dirty: 0, unreadable: 0 });
fs.appendFileSync(path.join(worktreeRoot, "README.md"), "dirty\n", "utf8");
const dirtyWorktree = await report();
assert.equal(dirtyWorktree.state, "blocked");
assert.equal(dirtyWorktree.blockers.includes("legacy-runtime-worktree-dirty"), true);

const targetServiceBlocked = await report(async () => ({
  ...serviceReady,
  target: {
    ...serviceReady.target,
    controlPlane: { loaded: true, running: true }
  }
}));
assert.equal(targetServiceBlocked.state, "blocked");
assert.equal(
  targetServiceBlocked.blockers.includes("target-chatcockpit-service-already-loaded"),
  true
);

migrateChatCockpitTargetContinuityDatabase(continuityPath, {
  now: "2026-08-15T00:00:00.000Z"
});
const targetOnlySourceBlocked = await report();
assert.equal(targetOnlySourceBlocked.state, "blocked");
assert.equal(
  targetOnlySourceBlocked.database.schemaVersion,
  LATEST_CONTINUITY_SCHEMA_VERSION
);
assert.equal(targetOnlySourceBlocked.database.sourceContract, "invalid");
assert.equal(targetOnlySourceBlocked.database.targetIdentityMarkerPresent, true);
assert.equal(
  targetOnlySourceBlocked.blockers.includes("legacy-continuity-source-contract-invalid"),
  true
);

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("VERIFY_R4_PREFLIGHT_OK\n");
