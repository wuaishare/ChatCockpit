import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildDesktopOperationalSummary, readDesktopOperationalSummary } from "../src/application/desktop-operational-summary-service.js";
import {
  ContinuityDatabase,
  continuityDatabasePath
} from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { buildDistributionContextForProduct } from "../src/core/distribution-context.js";
import { createJob, claimNextQueuedJob, failJob } from "../src/core/jobs.js";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.js";

function fixturePaths(root: string) {
  return buildPaths(
    buildDistributionContextForProduct("chatcockpit", {
      mode: "source",
      installRoot: path.join(root, "install"),
      stateRoot: path.join(root, "state"),
      primaryWorkspaceRoot: path.join(root, "workspace"),
      nodeExecutable: process.execPath,
      configPath: path.join(root, "config.json")
    })
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-desktop-summary-"));
try {
  const missingPaths = fixturePaths(path.join(root, "missing"));
  const missing = readDesktopOperationalSummary(
    missingPaths,
    "2026-01-01T00:00:00.000Z"
  );
  assert.equal(missing.jobs.available, false);
  assert.equal(missing.jobs.running, null);
  assert.equal(missing.approvals.available, false);
  assert.equal(missing.approvals.pending, null);
  assert.equal(fs.existsSync(missingPaths.stateRoot), false);

  const paths = fixturePaths(path.join(root, "fixture"));
  ensureWorkspaceDirs(paths);

  createJob(paths, "pack", { repoId: "primary" });
  createJob(paths, "pack", { repoId: "primary" });
  assert.ok(claimNextQueuedJob(paths));
  const failed = createJob(paths, "pack", { repoId: "primary" });
  failJob(paths, failed.id, "fixture failure");

  const legacyPath = path.join(paths.jobsDir, "legacy-failed.json");
  fs.writeFileSync(
    legacyPath,
    `${JSON.stringify({
      id: "legacy-failed",
      type: "pack",
      status: "failed",
      createdAt: "2025-12-31T23:00:00.000Z",
      updatedAt: "2025-12-31T23:00:00.000Z",
      payload: { repoId: "primary", secretFixture: "must-not-project" },
      error: "legacy fixture failure"
    }, null, 2)}\n`,
    "utf8"
  );

  const databasePath = continuityDatabasePath(paths.runtimeDir);
  const database = new ContinuityDatabase({ path: databasePath });
  const repositories = buildContinuityRepositories(database);
  const now = "2026-01-01T00:00:00.000Z";
  const future = "2099-01-01T00:05:00.000Z";
  const past = "2000-01-01T00:00:00.000Z";

  repositories.directMutationApprovals.create({
    id: "direct_mutation_pending",
    operation: "files.write",
    rootId: "fixture-root",
    relativePath: "README.md",
    mutationHash: "fixture-mutation-hash",
    executorId: "fixture-executor",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { operation: "write" },
    expiresAt: future,
    now
  });
  repositories.directMutationApprovals.create({
    id: "direct_mutation_expired_pending",
    operation: "files.write",
    rootId: "fixture-root",
    relativePath: "OLD.md",
    mutationHash: "fixture-expired-mutation-hash",
    executorId: "fixture-executor",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { operation: "write" },
    expiresAt: past,
    now: past
  });
  repositories.directCommandApprovals.create({
    id: "direct_command_pending",
    rootId: "fixture-root",
    workdir: ".",
    command: "git",
    args: ["status"],
    commandHash: "fixture-command-hash",
    effect: "read",
    timeoutMs: 1000,
    executorId: "fixture-executor",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { command: "git status" },
    expiresAt: future,
    now
  });
  const approved = repositories.directCommandApprovals.create({
    id: "direct_command_approved",
    rootId: "fixture-root",
    workdir: ".",
    command: "git",
    args: ["status", "--short"],
    commandHash: "fixture-approved-command-hash",
    effect: "read",
    timeoutMs: 1000,
    executorId: "fixture-executor",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { command: "git status --short" },
    expiresAt: future,
    now
  });
  repositories.directCommandApprovals.decide({
    id: approved.id,
    decision: "approved",
    expectedRevision: approved.revision,
    now
  });

  const direct = buildDesktopOperationalSummary(paths, repositories, now);
  assert.equal(direct.jobs.running, 1);
  assert.equal(direct.jobs.queued, 1);
  assert.equal(direct.jobs.failed, 2);
  assert.equal(direct.approvals.pending, 2);
  assert.equal(direct.approvals.hostMutation, 1);
  assert.equal(direct.approvals.hostCommand, 1);
  database.close();

  const beforeDatabaseMtime = fs.statSync(databasePath).mtimeMs;
  const beforeLegacyText = fs.readFileSync(legacyPath, "utf8");
  const summary = readDesktopOperationalSummary(paths, now);

  assert.deepEqual(summary.jobs, {
    available: true,
    running: 1,
    queued: 1,
    failed: 2
  });
  assert.equal(summary.approvals.available, true);
  assert.equal(summary.approvals.pending, 2);
  assert.equal(summary.approvals.hostMutation, 1);
  assert.equal(summary.approvals.hostCommand, 1);
  assert.equal(summary.approvals.hostProcess, 0);
  assert.equal(summary.approvals.runtime, 0);
  assert.equal(summary.approvals.runtimeResourceMutation, 0);
  assert.equal(fs.existsSync(legacyPath), true);
  assert.equal(fs.readFileSync(legacyPath, "utf8"), beforeLegacyText);
  assert.equal(fs.existsSync(path.join(paths.failedJobsDir, "legacy-failed.json")), false);
  assert.equal(fs.statSync(databasePath).mtimeMs, beforeDatabaseMtime);

  const encoded = JSON.stringify(summary);
  for (const forbidden of [
    "secretFixture",
    "must-not-project",
    "payload",
    "result",
    paths.stateRoot,
    paths.repoRoot
  ]) {
    assert.equal(encoded.includes(forbidden), false, `summary leaked ${forbidden}`);
  }

  const cliOutput = execFileSync(
    process.execPath,
    ["--import", "tsx", path.resolve("src/cli/index.ts"), "desktop-summary", "--json"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CHATCOCKPIT_INSTALL_ROOT: process.cwd(),
        CHATCOCKPIT_STATE_ROOT: paths.stateRoot,
        CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT: paths.repoRoot,
        CHATCOCKPIT_CONFIG_PATH: paths.configPath
      },
      encoding: "utf8"
    }
  );
  const cliSummary = JSON.parse(cliOutput) as typeof summary;
  assert.deepEqual(cliSummary.jobs, summary.jobs);
  assert.deepEqual(cliSummary.approvals, summary.approvals);
  assert.equal(fs.existsSync(legacyPath), true);
  assert.equal(fs.statSync(databasePath).mtimeMs, beforeDatabaseMtime);

  const readOnlyDatabase = new ContinuityDatabase({
    path: databasePath,
    readOnly: true
  });
  assert.ok(readOnlyDatabase.schemaVersion() > 0);
  assert.throws(() => {
    readOnlyDatabase.sqlite.exec("CREATE TABLE forbidden_write (id TEXT)");
  });
  readOnlyDatabase.close();

  console.log("DESKTOP_OPERATIONAL_SUMMARY_OK");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
