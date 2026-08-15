import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrateLegacyUserConfigToChatCockpit } from "../src/migration/chatcockpit-config-migration.js";
import { buildR4MigrationStaging } from "../src/migration/r4-executor.js";
import {
  buildR4PreflightReport,
  type R4ServiceProbeResult
} from "../src/migration/r4-preflight.js";
import { assertRenameMigrationTransition } from "../src/migration/rename-state-machine.js";
import type { RenameMigrationState } from "../src/migration/rename-types.js";
import { buildTokenPilotV18FixtureDatabase } from "./fixtures/rename-v0/build-v18-database.js";
import { runGit } from "./test-support/git.js";

interface ScenarioFixture {
  root: string;
  repoRoot: string;
  legacyStateRoot: string;
  targetStateRoot: string;
  legacyConfigPath: string;
  targetConfigPath: string;
  snapshotRoot: string;
  stagingRoot: string;
  rollbackRoot: string;
  legacyDatabasePath: string;
}

class FakeServiceController {
  legacyActive = true;
  targetActive = false;
  readonly actions: string[] = [];

  async probe(): Promise<R4ServiceProbeResult> {
    return {
      supported: true,
      old: {
        controlPlane: { loaded: this.legacyActive, running: this.legacyActive },
        runner: { loaded: this.legacyActive, running: this.legacyActive },
        processSupervisor: { loaded: false, running: false }
      },
      target: {
        controlPlane: { loaded: this.targetActive, running: this.targetActive },
        runner: { loaded: this.targetActive, running: this.targetActive },
        processSupervisor: { loaded: false, running: false }
      },
      legacyEndpointReachable: this.legacyActive
    };
  }

  async quiesceLegacy(): Promise<void> {
    this.actions.push("quiesce-legacy");
    this.legacyActive = false;
  }

  async restoreLegacy(): Promise<void> {
    this.actions.push("restore-legacy");
    this.legacyActive = true;
  }

  async startTarget(): Promise<void> {
    this.actions.push("start-target");
    this.targetActive = true;
  }

  async stopTarget(): Promise<void> {
    this.actions.push("stop-target");
    this.targetActive = false;
  }
}

function transition(states: RenameMigrationState[], next: RenameMigrationState): void {
  const current = states.at(-1);
  assert.ok(current, "Migration state history is empty");
  assertRenameMigrationTransition(current, next);
  states.push(next);
}

function createFixture(label: string): ScenarioFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `chatcockpit-r4-rehearsal-${label}-`));
  const repoRoot = path.join(root, "repo");
  const legacyStateRoot = path.join(repoRoot, ".tokenpilot");
  const homeRoot = path.join(root, "home");
  const targetStateRoot = path.join(homeRoot, ".chatcockpit");
  const legacyConfigPath = path.join(homeRoot, ".tokenpilot", "config.json");
  const targetConfigPath = path.join(targetStateRoot, "config.json");
  const snapshotRoot = path.join(root, "snapshot");
  const stagingRoot = path.join(root, "staging");
  const rollbackRoot = path.join(root, "rollback");

  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, ".gitignore"),
    [".tokenpilot/", ".chatcockpit/", "",].join("\n"),
    "utf8"
  );
  fs.writeFileSync(path.join(repoRoot, "README.md"), `# ${label}\n`, "utf8");
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.email", "r4-rehearsal@example.invalid"]);
  runGit(repoRoot, ["config", "user.name", "R4 Rehearsal Fixture"]);
  runGit(repoRoot, ["add", ".gitignore", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "init"]);

  for (const directory of [
    path.join(legacyStateRoot, "runtime"),
    path.join(legacyStateRoot, "jobs", "completed"),
    path.join(legacyStateRoot, "jobs", "failed"),
    path.dirname(legacyConfigPath),
    path.dirname(targetConfigPath),
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

  const legacyConfig = {
    workspaceAllowlist: [repoRoot],
    repoMappings: { tokenpilot: { path: repoRoot } }
  };
  fs.writeFileSync(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    targetConfigPath,
    `${JSON.stringify(migrateLegacyUserConfigToChatCockpit(legacyConfig), null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(legacyStateRoot, "runtime", "server.env"),
    "TOKENPILOT_API_TOKEN=legacy-rehearsal-secret\nTOKENPILOT_EXPOSED=false\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(legacyStateRoot, "jobs", "completed", "completed.json"),
    '{"status":"completed"}\n',
    "utf8"
  );
  fs.writeFileSync(
    path.join(legacyStateRoot, "jobs", "failed", "failed.json"),
    '{"status":"failed"}\n',
    "utf8"
  );
  fs.writeFileSync(path.join(legacyStateRoot, "repomix-output.xml"), "<legacy />\n", "utf8");

  const legacyDatabasePath = path.join(legacyStateRoot, "runtime", "continuity.sqlite");
  buildTokenPilotV18FixtureDatabase(legacyDatabasePath, repoRoot);

  return {
    root,
    repoRoot,
    legacyStateRoot,
    targetStateRoot,
    legacyConfigPath,
    targetConfigPath,
    snapshotRoot,
    stagingRoot,
    rollbackRoot,
    legacyDatabasePath
  };
}

async function preflight(fixture: ScenarioFixture, services: FakeServiceController) {
  return buildR4PreflightReport({
    repoRoot: fixture.repoRoot,
    legacyStateRoot: fixture.legacyStateRoot,
    targetStateRoot: fixture.targetStateRoot,
    legacyConfigPath: fixture.legacyConfigPath,
    targetConfigPath: fixture.targetConfigPath,
    requirePublicMain: false,
    serviceProbe: () => services.probe()
  });
}

function activateStaging(fixture: ScenarioFixture): {
  targetStateBackupPath: string | null;
  configCreated: boolean;
} {
  fs.mkdirSync(fixture.rollbackRoot, { recursive: true, mode: 0o700 });
  const stagedState = path.join(fixture.stagingRoot, "state");
  const stagedConfig = path.join(fixture.stagingRoot, "config", "config.json");
  assert.equal(fs.existsSync(stagedState), true);
  assert.equal(fs.existsSync(stagedConfig), true);

  const configRelative = path.relative(fixture.targetStateRoot, fixture.targetConfigPath);
  const configInsideTargetState =
    configRelative !== "" &&
    !path.isAbsolute(configRelative) &&
    configRelative !== ".." &&
    !configRelative.startsWith(`..${path.sep}`);
  if (configInsideTargetState) {
    const stagedTargetConfig = path.join(stagedState, configRelative);
    fs.mkdirSync(path.dirname(stagedTargetConfig), { recursive: true });
    fs.copyFileSync(stagedConfig, stagedTargetConfig);
  }

  let targetStateBackupPath: string | null = null;
  if (fs.existsSync(fixture.targetStateRoot)) {
    targetStateBackupPath = path.join(fixture.rollbackRoot, "target-state-before");
    fs.renameSync(fixture.targetStateRoot, targetStateBackupPath);
  }
  fs.renameSync(stagedState, fixture.targetStateRoot);

  let configCreated = false;
  if (!configInsideTargetState && !fs.existsSync(fixture.targetConfigPath)) {
    fs.mkdirSync(path.dirname(fixture.targetConfigPath), { recursive: true });
    fs.copyFileSync(stagedConfig, fixture.targetConfigPath);
    configCreated = true;
  }
  return { targetStateBackupPath, configCreated };
}

function rollbackActivation(
  fixture: ScenarioFixture,
  activation: { targetStateBackupPath: string | null; configCreated: boolean }
): void {
  fs.rmSync(fixture.targetStateRoot, { recursive: true, force: true });
  if (activation.targetStateBackupPath && fs.existsSync(activation.targetStateBackupPath)) {
    fs.renameSync(activation.targetStateBackupPath, fixture.targetStateRoot);
  }
  if (activation.configCreated) {
    fs.rmSync(fixture.targetConfigPath, { force: true });
  }
}

async function runSuccess(): Promise<void> {
  const fixture = createFixture("success");
  const services = new FakeServiceController();
  const states: RenameMigrationState[] = ["legacy-detected"];
  try {
    const initial = await preflight(fixture, services);
    assert.equal(initial.state, "ready-to-migrate");
    transition(states, "ready-to-migrate");
    transition(states, "quiescing");
    await services.quiesceLegacy();
    transition(states, "snapshotting");
    const staged = await buildR4MigrationStaging({
      sandboxRoot: fixture.root,
      repoRoot: fixture.repoRoot,
      legacyStateRoot: fixture.legacyStateRoot,
      legacyConfigPath: fixture.legacyConfigPath,
      targetStateRoot: fixture.targetStateRoot,
      targetConfigPath: fixture.targetConfigPath,
      snapshotRoot: fixture.snapshotRoot,
      stagingRoot: fixture.stagingRoot
    });
    assert.equal(staged.targetContinuitySchemaVersion, 19);
    transition(states, "migrating");
    const activation = activateStaging(fixture);
    transition(states, "verifying");
    await services.startTarget();
    assert.equal(services.targetActive, true);
    assert.equal(services.legacyActive, false);
    assert.equal(fs.existsSync(path.join(fixture.targetStateRoot, "runtime", "continuity.sqlite")), true);
    const envSource = fs.readFileSync(
      path.join(fixture.targetStateRoot, "runtime", "server.env"),
      "utf8"
    );
    assert.match(envSource, /^CHATCOCKPIT_API_TOKEN=cc_local_/m);
    assert.doesNotMatch(envSource, /^TOKENPILOT_/m);
    assert.equal(activation.configCreated, false);
    transition(states, "completed");
    assert.deepEqual(states, [
      "legacy-detected",
      "ready-to-migrate",
      "quiescing",
      "snapshotting",
      "migrating",
      "verifying",
      "completed"
    ]);
    assert.deepEqual(services.actions, ["quiesce-legacy", "start-target"]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function runSnapshotFailure(): Promise<void> {
  const fixture = createFixture("snapshot-failure");
  const services = new FakeServiceController();
  const states: RenameMigrationState[] = ["legacy-detected"];
  try {
    assert.equal((await preflight(fixture, services)).state, "ready-to-migrate");
    transition(states, "ready-to-migrate");
    transition(states, "quiescing");
    await services.quiesceLegacy();
    transition(states, "snapshotting");
    fs.mkdirSync(fixture.snapshotRoot, { recursive: true });
    fs.writeFileSync(path.join(fixture.snapshotRoot, "unexpected.txt"), "occupied\n", "utf8");
    await assert.rejects(
      () =>
        buildR4MigrationStaging({
          sandboxRoot: fixture.root,
          repoRoot: fixture.repoRoot,
          legacyStateRoot: fixture.legacyStateRoot,
          legacyConfigPath: fixture.legacyConfigPath,
          targetStateRoot: fixture.targetStateRoot,
          targetConfigPath: fixture.targetConfigPath,
          snapshotRoot: fixture.snapshotRoot,
          stagingRoot: fixture.stagingRoot
        }),
      /snapshotRoot must be empty/
    );
    transition(states, "recovery-required");
    await services.restoreLegacy();
    transition(states, "failed");
    assert.equal(services.legacyActive, true);
    assert.equal(services.targetActive, false);
    assert.deepEqual(services.actions, ["quiesce-legacy", "restore-legacy"]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function runDatabaseFailure(): Promise<void> {
  const fixture = createFixture("db-failure");
  const services = new FakeServiceController();
  const states: RenameMigrationState[] = ["legacy-detected"];
  try {
    assert.equal((await preflight(fixture, services)).state, "ready-to-migrate");
    transition(states, "ready-to-migrate");
    transition(states, "quiescing");
    await services.quiesceLegacy();
    transition(states, "snapshotting");
    const database = new DatabaseSync(fixture.legacyDatabasePath);
    database.prepare("UPDATE schema_migrations SET version=19 WHERE version=18").run();
    database.close();
    await assert.rejects(
      () =>
        buildR4MigrationStaging({
          sandboxRoot: fixture.root,
          repoRoot: fixture.repoRoot,
          legacyStateRoot: fixture.legacyStateRoot,
          legacyConfigPath: fixture.legacyConfigPath,
          targetStateRoot: fixture.targetStateRoot,
          targetConfigPath: fixture.targetConfigPath,
          snapshotRoot: fixture.snapshotRoot,
          stagingRoot: fixture.stagingRoot
        }),
      /source contract is invalid/
    );
    transition(states, "recovery-required");
    await services.restoreLegacy();
    transition(states, "failed");
    assert.equal(services.legacyActive, true);
    assert.equal(services.targetActive, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function runConfigDriftFailure(): Promise<void> {
  const fixture = createFixture("config-drift");
  const services = new FakeServiceController();
  const states: RenameMigrationState[] = ["legacy-detected"];
  try {
    assert.equal((await preflight(fixture, services)).state, "ready-to-migrate");
    transition(states, "ready-to-migrate");
    transition(states, "quiescing");
    await services.quiesceLegacy();
    transition(states, "snapshotting");
    const target = JSON.parse(fs.readFileSync(fixture.targetConfigPath, "utf8")) as {
      workspaceAllowlist: string[];
      repoMappings: Record<string, { path: string }>;
    };
    const conflictingRoot = path.join(fixture.root, "conflicting-workspace");
    fs.mkdirSync(conflictingRoot, { recursive: true });
    target.workspaceAllowlist.push(conflictingRoot);
    target.repoMappings.primary = { path: conflictingRoot };
    fs.writeFileSync(fixture.targetConfigPath, `${JSON.stringify(target, null, 2)}\n`, "utf8");
    await assert.rejects(
      () =>
        buildR4MigrationStaging({
          sandboxRoot: fixture.root,
          repoRoot: fixture.repoRoot,
          legacyStateRoot: fixture.legacyStateRoot,
          legacyConfigPath: fixture.legacyConfigPath,
          targetStateRoot: fixture.targetStateRoot,
          targetConfigPath: fixture.targetConfigPath,
          snapshotRoot: fixture.snapshotRoot,
          stagingRoot: fixture.stagingRoot
        }),
      /R4_PREFLIGHT_DRIFT/
    );
    transition(states, "recovery-required");
    await services.restoreLegacy();
    transition(states, "failed");
    assert.equal(services.legacyActive, true);
    assert.equal(services.targetActive, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function runHealthFailure(): Promise<void> {
  const fixture = createFixture("health-failure");
  const services = new FakeServiceController();
  const states: RenameMigrationState[] = ["legacy-detected"];
  try {
    assert.equal((await preflight(fixture, services)).state, "ready-to-migrate");
    transition(states, "ready-to-migrate");
    transition(states, "quiescing");
    await services.quiesceLegacy();
    transition(states, "snapshotting");
    await buildR4MigrationStaging({
      sandboxRoot: fixture.root,
      repoRoot: fixture.repoRoot,
      legacyStateRoot: fixture.legacyStateRoot,
      legacyConfigPath: fixture.legacyConfigPath,
      targetStateRoot: fixture.targetStateRoot,
      targetConfigPath: fixture.targetConfigPath,
      snapshotRoot: fixture.snapshotRoot,
      stagingRoot: fixture.stagingRoot
    });
    transition(states, "migrating");
    const activation = activateStaging(fixture);
    transition(states, "verifying");
    await services.startTarget();
    const healthOk = false;
    assert.equal(healthOk, false);
    transition(states, "recovery-required");
    await services.stopTarget();
    rollbackActivation(fixture, activation);
    await services.restoreLegacy();
    transition(states, "failed");
    assert.equal(services.targetActive, false);
    assert.equal(services.legacyActive, true);
    assert.equal(
      fs.readdirSync(fixture.targetStateRoot, { recursive: true }).length > 0,
      true,
      "Rollback should restore the pre-existing target scaffold"
    );
    assert.equal(fs.existsSync(path.join(fixture.targetStateRoot, "runtime", "server.env")), false);
    assert.deepEqual(services.actions, [
      "quiesce-legacy",
      "start-target",
      "stop-target",
      "restore-legacy"
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

await runSuccess();
await runSnapshotFailure();
await runDatabaseFailure();
await runConfigDriftFailure();
await runHealthFailure();

process.stdout.write("VERIFY_R4_FULL_REHEARSAL_OK\n");
