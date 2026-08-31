import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildOperationContext } from "../src/application/operation-context.js";
import { ContinuityDatabase, continuityDatabasePath } from "../src/continuity/database.js";
import { createJob, getJob } from "../src/core/jobs.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { GovernanceDatabase, governanceDatabasePath } from "../src/governance/database.js";
import { OperationalActivityProvenanceRepository } from "../src/governance/operational-activity-provenance-repository.js";
import { runRunner } from "../src/runner/index.js";
import {
  markRunnerFailed,
  markRunnerRecovered,
  markRunnerStarted,
  type RunnerStatusRecord
} from "../src/runner/status.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function runnerStatus(filePath: string): RunnerStatusRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as RunnerStatusRecord;
}

const governedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-runner-provenance-"));
const governedPaths = buildFixturePaths(governedRoot);
ensureWorkspaceDirs(governedPaths);
const governedContinuity = new ContinuityDatabase({
  path: continuityDatabasePath(governedPaths.runtimeDir)
});
const governedSchema = new GovernanceDatabase({
  path: governanceDatabasePath(governedPaths.runtimeDir)
});
governedSchema.close();
const provenance = new OperationalActivityProvenanceRepository(governedContinuity);
const governedJob = createJob(governedPaths, "taskpack", {
  title: "Governed runner activity",
  problem: "runner provenance fixture"
});
provenance.recordFromContext(
  buildOperationContext({
    actorType: "remote-mcp",
    actorId: "grant_runner_fixture",
    requestId: "runner-request-must-not-persist",
    now: "2026-08-19T11:00:00.000Z"
  }),
  { activityId: governedJob.id, activityKind: "job" }
);
governedContinuity.close();

await runRunner(governedPaths, { watch: false });
const governedStatus = runnerStatus(governedPaths.runnerStatusPath);
assert.match(governedStatus.workerInstanceId, /^worker_[0-9a-f-]{36}$/);
assert.equal(governedStatus.state, "stopped");
assert.equal(getJob(governedPaths, governedJob.id)?.job.status, "completed");
const governedRead = new ContinuityDatabase({
  path: continuityDatabasePath(governedPaths.runtimeDir)
});
const governedProvenance = new OperationalActivityProvenanceRepository(governedRead).get(
  governedJob.id
);
assert.equal(governedProvenance?.authorizationGrantId, "grant_runner_fixture");
assert.equal(governedProvenance?.workerInstanceId, governedStatus.workerInstanceId);
governedRead.close();
const governedBytes = fs.readFileSync(continuityDatabasePath(governedPaths.runtimeDir));
assert.equal(governedBytes.includes(Buffer.from("runner-request-must-not-persist")), false);

const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-runner-legacy-"));
const legacyPaths = buildFixturePaths(legacyRoot);
ensureWorkspaceDirs(legacyPaths);
const legacyContinuity = new ContinuityDatabase({
  path: continuityDatabasePath(legacyPaths.runtimeDir)
});
const legacyJob = createJob(legacyPaths, "taskpack", {
  title: "Legacy runner activity",
  problem: "no Governance v2 table exists yet"
});
legacyContinuity.close();
await runRunner(legacyPaths, { watch: false });
assert.equal(getJob(legacyPaths, legacyJob.id)?.job.status, "completed");
const legacyRead = new ContinuityDatabase({
  path: continuityDatabasePath(legacyPaths.runtimeDir)
});
assert.equal(new OperationalActivityProvenanceRepository(legacyRead).get(legacyJob.id), null);
legacyRead.close();

const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-runner-recovery-"));
const recoveryPaths = buildFixturePaths(recoveryRoot);
ensureWorkspaceDirs(recoveryPaths);
markRunnerStarted(recoveryPaths, "watch");
markRunnerFailed(recoveryPaths, "database is locked");
const failedStatus = runnerStatus(recoveryPaths.runnerStatusPath);
assert.equal(failedStatus.lastError, "database is locked");
assert.equal(failedStatus.lastFailureError, "database is locked");
assert.ok(failedStatus.lastFailureAt);
const failureAt = failedStatus.lastFailureAt;
markRunnerRecovered(recoveryPaths);
const recoveredStatus = runnerStatus(recoveryPaths.runnerStatusPath);
assert.equal(recoveredStatus.lastError, undefined);
assert.equal(recoveredStatus.lastFailureError, "database is locked");
assert.equal(recoveredStatus.lastFailureAt, failureAt);
assert.ok(recoveredStatus.lastHealthyAt);

fs.rmSync(governedRoot, { recursive: true, force: true });
fs.rmSync(legacyRoot, { recursive: true, force: true });
fs.rmSync(recoveryRoot, { recursive: true, force: true });
process.stdout.write("VERIFY_RUNNER_ACTIVITY_PROVENANCE_OK\n");
