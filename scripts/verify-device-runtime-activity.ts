import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperationalActivityService } from "../src/application/operational-activity-service.js";
import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { GovernanceDatabase } from "../src/governance/database.js";
import { DeviceRuntimeOperationRepository } from "../src/governance/device-runtime-operation-repository.js";
import { GovernedExternalActionRepository } from "../src/governance/governed-external-action-repository.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-runtime-activity-"));
const paths = buildFixturePaths(root);
ensureWorkspaceDirs(paths);
const databasePath = path.join(paths.runtimeDir, "continuity.sqlite");
const continuity = new ContinuityDatabase({ path: databasePath });
const governance = new GovernanceDatabase({ path: databasePath });
const repositories = buildContinuityRepositories(continuity);
const externalActions = new GovernedExternalActionRepository(continuity);
const operations = new DeviceRuntimeOperationRepository(continuity);
const DEVICE_ID = "cc_device_activity_abcdefghijklmnop";
const GRANT_ID = "grant_device_activity_fixture";
const now = "2026-08-24T03:20:00.000Z";
const conditions = {
  schemaVersion: 1 as const,
  support: "managed-macos" as const,
  controlPlane: "running" as const,
  runner: "registered" as const,
  processSupervisor: "ready" as const,
  observedAt: now
};

try {
  const approval = externalActions.createApproval({
    id: "approval_device_activity_fixture",
    targetId: DEVICE_ID,
    providerId: "device-runtime-lifecycle",
    toolName: "restart",
    argumentsHash: "a".repeat(64),
    publicSummary: { action: "Restart Runtime" },
    requestedActor: {
      actorType: "remote-mcp",
      actorIdentityHash: "b".repeat(64),
      requestIdentityHash: "c".repeat(64)
    },
    expiresAt: "2026-08-24T03:30:00.000Z",
    now
  });
  let operation = operations.create({
    id: "device_runtime_activity_fixture",
    deviceId: DEVICE_ID,
    action: "restart",
    state: "awaiting-approval",
    approvalId: approval.id,
    authorizationGrantId: GRANT_ID,
    requestedActorType: "remote-mcp",
    requestedActorIdentityHash: "b".repeat(64),
    requestedRequestIdentityHash: "c".repeat(64),
    preflightConditions: conditions,
    now
  });
  operation = operations.transition({
    id: operation.id,
    expectedRevision: operation.revision,
    to: "executing",
    executedActor: {
      actorType: "remote-mcp",
      actorIdentityHash: "b".repeat(64),
      requestIdentityHash: "d".repeat(64)
    },
    now: "2026-08-24T03:20:01.000Z"
  });
  operation = operations.transition({
    id: operation.id,
    expectedRevision: operation.revision,
    to: "succeeded",
    postflightConditions: conditions,
    now: "2026-08-24T03:20:02.000Z"
  });
  const service = new OperationalActivityService(
    paths,
    repositories,
    undefined,
    undefined,
    {
      operations,
      resolveDevice(deviceId: string) {
        if (deviceId !== DEVICE_ID) return null;
        return {
          id: DEVICE_ID,
          displayName: "Mac mini M4",
          platform: "darwin",
          architecture: "arm64"
        };
      }
    }
  );
  const snapshot = service.list();
  const activity = snapshot.activities.find((item) => item.id === operation.id);
  assert.ok(activity, "device Runtime operation must project into Operational Activity");
  assert.equal(activity.kind, "device-operation");
  assert.equal(activity.targetDeviceId, DEVICE_ID);
  assert.equal(activity.authorizationGrantId, GRANT_ID);
  assert.equal(activity.job, null);
  assert.equal(activity.runtime, null);
  assert.equal(activity.deviceOperation?.action, "restart");
  assert.equal(activity.deviceOperation?.state, "succeeded");
  assert.equal(activity.deviceOperation?.deviceDisplayName, "Mac mini M4");
  assert.equal(activity.deviceOperation?.actorType, "remote-mcp");
  const serialized = JSON.stringify(activity);
  const localHomeSentinel = String.fromCharCode(47) + "Users" + String.fromCharCode(47);
  for (const forbidden of ["jobId", "pid", "command", "cwd", "stdout", "stderr", localHomeSentinel]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  const timeline = service.timeline(operation.id, 20);
  assert.ok(timeline);
  assert.ok(timeline.events.length >= 1);
  assert.equal(timeline.events.at(-1)?.source, "device-operation");
  assert.equal(timeline.events.at(-1)?.deviceAction, "restart");
  assert.equal(timeline.events.at(-1)?.deviceOperationState, "succeeded");

  const revisions = service.currentDeviceOperationRevisions();
  assert.equal(revisions[operation.id], operation.revision);
  assert.deepEqual(service.listDeviceOperationEventsAfter(revisions), []);
} finally {
  governance.close();
  continuity.close();
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_DEVICE_RUNTIME_ACTIVITY_OK\n");
