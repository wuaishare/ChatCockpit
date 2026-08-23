import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DeviceRuntimeLifecycleService } from "../src/application/device-runtime-lifecycle-service.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { GovernanceDatabase } from "../src/governance/database.js";
import { DeviceRuntimeOperationRepository } from "../src/governance/device-runtime-operation-repository.js";
import { buildGovernanceLedger } from "../src/governance/governance-ledger.js";
import { GovernedExternalActionRepository } from "../src/governance/governed-external-action-repository.js";
import { OperationalActivityProvenanceRepository } from "../src/governance/operational-activity-provenance-repository.js";

const DEVICE_ID = "cc_device_governance_abcdefghijklmnop";
const GRANT_ID = "grant_governance_chatgpt";
const conditions = {
  schemaVersion: 1 as const,
  support: "managed-macos" as const,
  controlPlane: "running" as const,
  runner: "registered" as const,
  processSupervisor: "ready" as const,
  observedAt: "2026-08-24T01:00:00.000Z"
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-runtime-governance-"));
const databasePath = path.join(root, "continuity.sqlite");
try {
  const database = new ContinuityDatabase({ path: databasePath });
  const governanceSchema = new GovernanceDatabase({ path: databasePath });
  governanceSchema.close();
  const repositories = buildContinuityRepositories(database);
  const externalActions = new GovernedExternalActionRepository(database);
  const deviceRuntimeOperations = new DeviceRuntimeOperationRepository(database);
  const activityProvenance = new OperationalActivityProvenanceRepository(database);
  const governance = buildGovernanceLedger(
    repositories,
    externalActions,
    deviceRuntimeOperations,
    activityProvenance
  );

  let presence: "online" | "offline" = "online";
  let executionPolicy: "active" | "paused" = "active";
  let channelAvailable = true;
  let rpcMode: "success" | "transport-loss" | "agent-error" | "reconcile-success" = "success";
  const calls: Array<{ action: string; operationId: string }> = [];
  const targets = {
    resolve(deviceId: string) {
      if (deviceId === "local-device") {
        return {
          id: "local-device", kind: "device" as const, locality: "local" as const,
          displayName: "This device", platform: "darwin", architecture: "arm64",
          presence: "online" as const, executionPolicy: "active" as const,
          executionAvailable: true
        };
      }
      assert.equal(deviceId, DEVICE_ID);
      return {
        id: DEVICE_ID, kind: "device" as const, locality: "remote" as const,
        displayName: "Governance fixture", platform: "darwin", architecture: "arm64",
        presence, executionPolicy, executionAvailable: executionPolicy === "active" && channelAvailable
      };
    }
  };
  const channels = {
    isRuntimeLifecycleRpcAvailable(deviceId: string) {
      return deviceId === DEVICE_ID && channelAvailable;
    }
  };
  const accessPolicy = {
    assertGrantAllowsDevice(grantId: string, deviceId: string) {
      if (grantId !== GRANT_ID || deviceId !== DEVICE_ID) {
        throw new ServiceError("DEVICE_ACCESS_DENIED", "fixture grant denied");
      }
    }
  };
  const rpc = {
    async request(_deviceId: string, input: { operationId: string; action: string }) {
      calls.push({ action: input.action, operationId: input.operationId });
      if (input.action === "status") {
        return { operationId: input.operationId, outcome: "ok" as const, result: conditions };
      }
      if (input.action === "operation.get") {
        assert.equal(rpcMode, "reconcile-success");
        return {
          operationId: input.operationId,
          outcome: "ok" as const,
          result: {
            operationId: input.operationId,
            action: "restart",
            state: "succeeded",
            startedAt: "2026-08-24T01:00:01.000Z",
            completedAt: "2026-08-24T01:00:02.000Z",
            result: conditions,
            errorCode: null
          }
        };
      }
      if (rpcMode === "transport-loss") {
        throw new ServiceError(
          "DEVICE_RUNTIME_LIFECYCLE_REQUEST_TIMEOUT",
          "fixture transport result lost"
        );
      }
      if (rpcMode === "agent-error") {
        return {
          operationId: input.operationId,
          outcome: "error" as const,
          error: { code: "DEVICE_RUNTIME_ACTION_FAILED", message: "fixture action failed" }
        };
      }
      return { operationId: input.operationId, outcome: "ok" as const, result: conditions };
    }
  };

  const service = new DeviceRuntimeLifecycleService(
    governance,
    targets,
    channels,
    rpc,
    accessPolicy
  );
  const chatgpt = buildOperationContext({
    requestId: "req_chatgpt_governance_1",
    actorType: "remote-mcp",
    actorId: "chatgpt",
    authorizationGrantId: GRANT_ID,
    now: "2026-08-24T01:00:00.000Z"
  });

  const first = await service.execute(chatgpt, {
    idempotencyKey: "lifecycle.execute.success.1",
    deviceId: DEVICE_ID,
    action: "restart"
  });
  assert.equal(first.replayed, false);
  assert.equal(first.operation.state, "succeeded");
  assert.deepEqual(calls.map((entry) => entry.action), ["status", "restart"]);
  assert.equal("approvalId" in first.operation, false);
  assert.equal("authorizationGrantId" in first.operation, false);
  assert.equal("requestedActor" in first.operation, false);
  assert.equal("executedActor" in first.operation, false);
  const firstInternal = deviceRuntimeOperations.get(first.operation.operationId);
  const approval = externalActions.getApproval(firstInternal.approvalId);
  assert.equal(approval.status, "consumed");
  assert.equal(approval.requestedActor.actorType, "remote-mcp");
  assert.equal(approval.decidedActor.actorType, "remote-mcp");
  const execution = externalActions.findExecutionByApprovalId(approval.id);
  assert.equal(execution?.verificationStatus, "succeeded");

  const callCountAfterSuccess = calls.length;
  const replay = await service.execute(chatgpt, {
    idempotencyKey: "lifecycle.execute.success.1",
    deviceId: DEVICE_ID,
    action: "restart"
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.operation.operationId, first.operation.operationId);
  assert.equal(calls.length, callCountAfterSuccess);

  rpcMode = "transport-loss";
  const ambiguous = await service.execute(chatgpt, {
    idempotencyKey: "lifecycle.execute.ambiguous.1",
    deviceId: DEVICE_ID,
    action: "restart"
  });
  assert.equal(ambiguous.operation.state, "ambiguous");
  const restartCallsAfterAmbiguous = calls.filter((entry) => entry.action === "restart").length;
  const ambiguousReplay = await service.execute(chatgpt, {
    idempotencyKey: "lifecycle.execute.ambiguous.1",
    deviceId: DEVICE_ID,
    action: "restart"
  });
  assert.equal(ambiguousReplay.replayed, true);
  assert.equal(ambiguousReplay.operation.state, "ambiguous");
  assert.equal(
    calls.filter((entry) => entry.action === "restart").length,
    restartCallsAfterAmbiguous
  );

  rpcMode = "reconcile-success";
  const reconciled = await service.operationGet(chatgpt, {
    operationId: ambiguous.operation.operationId
  });
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.operation.state, "succeeded");
  assert.equal(
    externalActions.findExecutionByApprovalId(deviceRuntimeOperations.get(ambiguous.operation.operationId).approvalId)?.verificationStatus,
    "succeeded"
  );

  executionPolicy = "paused";
  const callsBeforePause = calls.length;
  await assert.rejects(
    () => service.execute(chatgpt, {
      idempotencyKey: "lifecycle.execute.paused.1",
      deviceId: DEVICE_ID,
      action: "restart"
    }),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_EXECUTION_PAUSED"
  );
  assert.equal(calls.length, callsBeforePause);
  const pausedStatus = await service.status(chatgpt, { deviceId: DEVICE_ID });
  assert.equal(pausedStatus.conditions.controlPlane, "running");
  executionPolicy = "active";

  const noGrant = buildOperationContext({
    requestId: "req_chatgpt_no_grant",
    actorType: "remote-mcp",
    actorId: "chatgpt",
    now: "2026-08-24T01:01:00.000Z"
  });
  await assert.rejects(
    () => service.status(noGrant, { deviceId: DEVICE_ID }),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_ACCESS_DENIED"
  );

  channelAvailable = false;
  await assert.rejects(
    () => service.execute(chatgpt, {
      idempotencyKey: "lifecycle.execute.v2.1",
      deviceId: DEVICE_ID,
      action: "restart"
    }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "DEVICE_RUNTIME_LIFECYCLE_UNSUPPORTED"
  );
  channelAvailable = true;
  presence = "offline";
  await assert.rejects(
    () => service.execute(chatgpt, {
      idempotencyKey: "lifecycle.execute.offline.1",
      deviceId: DEVICE_ID,
      action: "restart"
    }),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_RUNTIME_AGENT_OFFLINE"
  );
  presence = "online";

  await assert.rejects(
    () => service.execute(
      buildOperationContext({
        requestId: "req_local_ui_remote_only",
        actorType: "local-ui",
        actorId: "owner",
        now: "2026-08-24T01:02:00.000Z"
      }),
      {
        idempotencyKey: "lifecycle.execute.local-device.1",
        deviceId: "local-device" as never,
        action: "restart"
      }
    ),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "DEVICE_RUNTIME_REMOTE_TARGET_REQUIRED"
  );

  const controlRows = database.sqlite.prepare(`
    SELECT COUNT(*) AS count FROM operational_activity_control_events
  `).get() as { count: number };
  assert.equal(Number(controlRows.count), 0);
  database.close();
  process.stdout.write("VERIFY_DEVICE_RUNTIME_LIFECYCLE_GOVERNANCE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
