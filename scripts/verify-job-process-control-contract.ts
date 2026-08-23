import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { JobProcessControlService } from "../src/application/job-process-control-service.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import { ContinuityDatabase, continuityDatabasePath } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import {
  getTrackedJobProcess,
  markJobProcessFinished,
  trackJobProcess,
  type JobProcessSignalAdapter
} from "../src/core/job-processes.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import {
  GovernanceDatabase,
  governanceDatabasePath,
  LATEST_GOVERNANCE_SCHEMA_VERSION
} from "../src/governance/database.js";
import { OperationalActivityControlEventRepository } from "../src/governance/operational-activity-control-event-repository.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function assertServiceCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, code);
  return true;
}

function context(requestId: string, actorId = "raw-operator-id-must-not-persist") {
  return buildOperationContext({
    requestId,
    actorType: "local-ui",
    actorId,
    publicProjection: true,
    now: "2026-08-20T05:45:00.000Z"
  });
}

async function verifyServiceContract(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-job-control-service-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const databasePath = continuityDatabasePath(paths.runtimeDir);
  const continuity = new ContinuityDatabase({ path: databasePath });
  const governance = new GovernanceDatabase({ path: governanceDatabasePath(paths.runtimeDir) });
  assert.equal(governance.schemaVersion(), LATEST_GOVERNANCE_SCHEMA_VERSION);
  governance.close();
  const repositories = buildContinuityRepositories(continuity);
  const controlEvents = new OperationalActivityControlEventRepository(continuity);

  try {
    const processDir = path.join(paths.runtimeDir, "job-processes");
    fs.mkdirSync(processDir, { recursive: true });
    fs.writeFileSync(path.join(processDir, "legacy_job.json"), JSON.stringify({
      jobId: "legacy_job",
      pid: 41001,
      startedAt: "2026-08-20T05:40:00.000Z",
      updatedAt: "2026-08-20T05:40:00.000Z",
      state: "running",
      label: "legacy fixture"
    }, null, 2));
    assert.equal(getTrackedJobProcess(paths, "legacy_job")?.revision, 1);

    trackJobProcess(paths, { jobId: "controlled_job", pid: 41002, label: "controlled fixture" });
    assert.equal(getTrackedJobProcess(paths, "controlled_job")?.revision, 1);

    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const adapter: JobProcessSignalAdapter = {
      signal(pid, signal) { signals.push({ pid, signal }); }
    };
    const service = new JobProcessControlService(paths, repositories, controlEvents, adapter);
    const pauseInput = {
      jobId: "controlled_job",
      action: "pause" as const,
      expectedRevision: 1,
      idempotencyKey: "job-control-pause-01"
    };
    const paused = await service.control(context("pause-request"), pauseInput);
    assert.equal(paused.state, "paused");
    assert.equal(paused.revision, 2);
    assert.equal(paused.replayed, false);
    assert.deepEqual(signals, [{ pid: 41002, signal: "SIGSTOP" }]);
    assert.equal(getTrackedJobProcess(paths, "controlled_job")?.revision, 2);

    const pauseEvents = controlEvents.listForJob("controlled_job");
    assert.equal(pauseEvents.length, 1);
    assert.equal(pauseEvents[0]?.action, "pause");
    assert.equal(pauseEvents[0]?.resultingState, "paused");
    assert.equal(pauseEvents[0]?.processRevision, 2);
    assert.equal(pauseEvents[0]?.actorType, "local-ui");
    assert.match(pauseEvents[0]?.actorIdentityHash ?? "", /^[0-9a-f]{64}$/);
    assert.match(pauseEvents[0]?.requestIdentityHash ?? "", /^[0-9a-f]{64}$/);

    const replayedPause = await service.control(context("pause-replay-request"), pauseInput);
    assert.equal(replayedPause.replayed, true);
    assert.equal(replayedPause.revision, 2);
    assert.equal(signals.length, 1);
    assert.equal(controlEvents.listForJob("controlled_job").length, 1);

    await assert.rejects(
      service.control(context("conflicting-key-request"), {
        jobId: "controlled_job",
        action: "resume",
        expectedRevision: 2,
        idempotencyKey: pauseInput.idempotencyKey
      }),
      (error) => assertServiceCode(error, "IDEMPOTENCY_CONFLICT")
    );
    await assert.rejects(
      service.control(context("stale-revision-request"), {
        jobId: "controlled_job",
        action: "resume",
        expectedRevision: 1,
        idempotencyKey: "job-control-stale-01"
      }),
      (error) => assertServiceCode(error, "REVISION_CONFLICT")
    );
    assert.equal(signals.length, 1);

    const resumed = await service.control(context("resume-request"), {
      jobId: "controlled_job",
      action: "resume",
      expectedRevision: 2,
      idempotencyKey: "job-control-resume-01"
    });
    assert.equal(resumed.state, "running");
    assert.equal(resumed.revision, 3);
    assert.equal(signals.at(-1)?.signal, "SIGCONT");
    assert.equal(controlEvents.listForJob("controlled_job").length, 2);

    trackJobProcess(paths, { jobId: "signal_failure_job", pid: 41003, label: "failure fixture" });
    let failureSignals = 0;
    const failingService = new JobProcessControlService(paths, repositories, controlEvents, {
      signal() {
        failureSignals += 1;
        throw new Error("signal definitely not delivered");
      }
    });
    const failureInput = {
      jobId: "signal_failure_job",
      action: "pause" as const,
      expectedRevision: 1,
      idempotencyKey: "job-control-signal-failure-01"
    };
    await assert.rejects(
      failingService.control(context("signal-failure-request"), failureInput),
      (error) => assertServiceCode(error, "JOB_PROCESS_SIGNAL_FAILED")
    );
    assert.equal(failureSignals, 1);
    assert.equal(getTrackedJobProcess(paths, "signal_failure_job")?.revision, 1);
    assert.equal(controlEvents.listForJob("signal_failure_job").length, 0);
    const recoveredService = new JobProcessControlService(paths, repositories, controlEvents, adapter);
    const recovered = await recoveredService.control(context("signal-retry-request"), failureInput);
    assert.equal(recovered.state, "paused");
    assert.equal(recovered.revision, 2);

    trackJobProcess(paths, { jobId: "drift_job", pid: 41004, label: "drift fixture" });
    let driftSignals = 0;
    const driftService = new JobProcessControlService(paths, repositories, controlEvents, {
      signal() {
        driftSignals += 1;
        markJobProcessFinished(paths, "drift_job", "completed");
      }
    });
    const driftInput = {
      jobId: "drift_job",
      action: "pause" as const,
      expectedRevision: 1,
      idempotencyKey: "job-control-drift-01"
    };
    await assert.rejects(
      driftService.control(context("drift-request"), driftInput),
      (error) => assertServiceCode(error, "JOB_PROCESS_STATE_CHANGED_AFTER_SIGNAL")
    );
    assert.equal(driftSignals, 1);
    assert.equal(controlEvents.listForJob("drift_job").length, 0);
    await assert.rejects(
      driftService.control(context("drift-retry-request"), driftInput),
      (error) => assertServiceCode(error, "IDEMPOTENCY_IN_PROGRESS")
    );
    assert.equal(driftSignals, 1, "ambiguous commit failure must never send a second signal");

    trackJobProcess(paths, { jobId: "runner_race_job", pid: 41005, label: "runner race fixture" });
    const raceService = new JobProcessControlService(paths, repositories, controlEvents, {
      signal() { markJobProcessFinished(paths, "runner_race_job", "terminated"); }
    });
    const terminated = await raceService.control(context("terminate-race-request"), {
      jobId: "runner_race_job",
      action: "terminate",
      expectedRevision: 1,
      idempotencyKey: "job-control-terminate-race-01"
    });
    assert.equal(terminated.state, "terminated");
    assert.equal(terminated.revision, 2);
    assert.equal(controlEvents.listForJob("runner_race_job").length, 1);

    trackJobProcess(paths, { jobId: "concurrent_job", pid: 41006, label: "concurrent fixture" });
    const concurrentSignals: NodeJS.Signals[] = [];
    const concurrentService = new JobProcessControlService(paths, repositories, controlEvents, {
      signal(_pid, signal) { concurrentSignals.push(signal); }
    });
    const first = concurrentService.control(context("concurrent-first"), {
      jobId: "concurrent_job",
      action: "pause",
      expectedRevision: 1,
      idempotencyKey: "job-control-concurrent-01"
    });
    await assert.rejects(
      concurrentService.control(context("concurrent-second"), {
        jobId: "concurrent_job",
        action: "pause",
        expectedRevision: 1,
        idempotencyKey: "job-control-concurrent-02"
      }),
      (error) => assertServiceCode(error, "JOB_PROCESS_CONTROL_IN_PROGRESS")
    );
    await first;
    assert.deepEqual(concurrentSignals, ["SIGSTOP"]);

    const columns = continuity.sqlite
      .prepare("PRAGMA table_info(operational_activity_control_events)")
      .all() as Array<{ name: string }>;
    const columnNames = columns.map((column) => column.name);
    for (const forbidden of ["pid", "command", "path", "instructions", "stdout", "stderr"]) {
      assert.equal(columnNames.includes(forbidden), false, `control audit must not persist ${forbidden}`);
    }
    continuity.sqlite.exec("PRAGMA wal_checkpoint(PASSIVE)");
    for (const candidate of [databasePath, `${databasePath}-wal`]) {
      if (!fs.existsSync(candidate)) continue;
      const bytes = fs.readFileSync(candidate);
      assert.equal(bytes.includes(Buffer.from("raw-operator-id-must-not-persist")), false);
      assert.equal(bytes.includes(Buffer.from("pause-request")), false);
    }
  } finally {
    continuity.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function verifyHttpContract(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-job-control-http-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(root, "README.md"), "# Job process control HTTP fixture\n", "utf8");

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-job-control-owner" });
  operatorStore.close();

  const original = {
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH
  };
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-job-control-machine";
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(paths.runtimeDir, "missing-config.json");

  const deliveredSignals: NodeJS.Signals[] = [];
  const app = buildServer(paths, {
    jobProcessSignalAdapter: {
      signal(_pid, signal) { deliveredSignals.push(signal); }
    }
  });
  try {
    trackJobProcess(paths, { jobId: "api_control_job", pid: 42001, label: "api control fixture" });
    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-job-control-owner" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const loginBody = login.json() as { csrfToken: string };
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0];

    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/jobs/api_control_job/control",
      headers: { cookie },
      payload: {
        action: "pause",
        expectedRevision: 1,
        idempotencyKey: "job-control-http-no-csrf"
      }
    });
    assert.equal(noCsrf.statusCode, 403, noCsrf.body);

    const operatorPause = await app.inject({
      method: "POST",
      url: "/api/jobs/api_control_job/control",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: {
        action: "pause",
        expectedRevision: 1,
        idempotencyKey: "job-control-http-operator"
      }
    });
    assert.equal(operatorPause.statusCode, 200, operatorPause.body);
    const operatorBody = operatorPause.json() as { state: string; revision: number; replayed: boolean };
    assert.equal(operatorBody.state, "paused");
    assert.equal(operatorBody.revision, 2);
    assert.equal(operatorBody.replayed, false);

    const machineResume = await app.inject({
      method: "POST",
      url: "/api/jobs/api_control_job/control",
      headers: { authorization: "Bearer test-token-job-control-machine" },
      payload: {
        action: "resume",
        expectedRevision: 2,
        idempotencyKey: "job-control-http-machine"
      }
    });
    assert.equal(machineResume.statusCode, 200, machineResume.body);
    assert.equal((machineResume.json() as { revision: number }).revision, 3);

    const stale = await app.inject({
      method: "POST",
      url: "/api/jobs/api_control_job/control",
      headers: { authorization: "Bearer test-token-job-control-machine" },
      payload: {
        action: "pause",
        expectedRevision: 1,
        idempotencyKey: "job-control-http-stale"
      }
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.match(stale.body, /REVISION_CONFLICT/);

    const legacyMissing = await app.inject({
      method: "POST",
      url: "/api/jobs/missing_job/control/terminate",
      headers: { authorization: "Bearer test-token-job-control-machine" }
    });
    assert.equal(legacyMissing.statusCode, 200, legacyMissing.body);
    assert.equal((legacyMissing.json() as { ok: boolean }).ok, false);

    trackJobProcess(paths, { jobId: "legacy_completed_job", pid: 42002, label: "legacy completed fixture" });
    markJobProcessFinished(paths, "legacy_completed_job", "completed");
    const legacyInvalidState = await app.inject({
      method: "POST",
      url: "/api/jobs/legacy_completed_job/control/pause",
      headers: { authorization: "Bearer test-token-job-control-machine" }
    });
    assert.equal(legacyInvalidState.statusCode, 200, legacyInvalidState.body);
    const legacyInvalidBody = legacyInvalidState.json() as { ok: boolean; state: string; message: string };
    assert.equal(legacyInvalidBody.ok, false);
    assert.equal(legacyInvalidBody.state, "completed");
    assert.equal(typeof legacyInvalidBody.message, "string");
    assert.equal(deliveredSignals.length, 2);
  } finally {
    await app.close();
    process.env.CHATCOCKPIT_API_TOKEN = original.token;
    process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
  }

  const auditDatabase = new ContinuityDatabase({ path: continuityDatabasePath(paths.runtimeDir) });
  try {
    const events = new OperationalActivityControlEventRepository(auditDatabase).listForJob("api_control_job");
    assert.equal(events.length, 2);
    assert.equal(events[0]?.actorType, "local-ui");
    assert.match(events[0]?.actorIdentityHash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(events[1]?.actorType, "rest-api");
    assert.equal(events[1]?.actorIdentityHash, null);
    assert.notEqual(events[0]?.requestIdentityHash, events[1]?.requestIdentityHash);
  } finally {
    auditDatabase.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function verifyWebAndOpenApiContract(): void {
  const api = fs.readFileSync(new URL("../web/src/api.ts", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const webTypes = fs.readFileSync(new URL("../web/src/types.ts", import.meta.url), "utf8");
  const openApi = fs.readFileSync(new URL("../openapi/chatcockpit.openapi.yaml", import.meta.url), "utf8");
  assert.match(api, /`\/api\/jobs\/\$\{encodeURIComponent\(id\)\}\/control`/);
  assert.match(api, /expectedRevision: number/);
  assert.match(api, /idempotencyKey: string/);
  assert.doesNotMatch(api, /control\/\$\{encodeURIComponent\(action\)\}/);
  assert.match(app, /expectedRevision = targetJob\.process\.revision/);
  assert.match(app, /job\.process\.control\.web:/);
  assert.match(app, /jobControlKeys/);
  assert.match(webTypes, /interface JobProcessInfo[\s\S]*?revision: number/);
  assert.match(openApi, /operationId: controlJobProcess/);
  assert.match(openApi, /operationId: controlJobLegacy[\s\S]*?deprecated: true/);
}

await verifyServiceContract();
await verifyHttpContract();
verifyWebAndOpenApiContract();
process.stdout.write("VERIFY_JOB_PROCESS_CONTROL_CONTRACT_OK\n");
