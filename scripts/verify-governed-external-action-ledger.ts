import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../src/application/service-error.js";
import { ContinuityDatabase, LATEST_CONTINUITY_SCHEMA_VERSION } from "../src/continuity/database.js";
import {
  GovernanceDatabase,
  LATEST_GOVERNANCE_SCHEMA_VERSION
} from "../src/governance/database.js";
import { GovernedExternalActionRepository } from "../src/governance/governed-external-action-repository.js";

function hashArguments(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function assertServiceCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, code);
  return true;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-governed-action-"));
const continuityPath = path.join(root, "continuity.sqlite");
const governancePath = continuityPath;
const continuityDatabase = new ContinuityDatabase({ path: continuityPath });
const database = new GovernanceDatabase({ path: governancePath });
const repository = new GovernedExternalActionRepository(database);
const secretArgument = "raw-secret-argument-must-not-persist";
const argumentsHash = hashArguments({ token: secretArgument, value: 7 });
const actor = {
  actorType: "remote-mcp" as const,
  actorIdentityHash: "a".repeat(64),
  requestIdentityHash: "b".repeat(64)
};

try {
  assert.equal(LATEST_CONTINUITY_SCHEMA_VERSION, 19);
  assert.equal(continuityDatabase.schemaVersion(), 19);
  assert.equal(LATEST_GOVERNANCE_SCHEMA_VERSION, 1);
  assert.equal(database.schemaVersion(), 1);
  const continuityTables = continuityDatabase.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'governed_external_action_%'"
    )
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    continuityTables.map((entry) => entry.name).sort(),
    ["governed_external_action_approvals", "governed_external_action_executions"],
    "Governed external actions must share the current physical SQLite during reset migration"
  );
  const columns = database.sqlite
    .prepare("PRAGMA table_info(governed_external_action_approvals)")
    .all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === "arguments_json"), false);
  assert.equal(columns.some((column) => column.name === "arguments_hash"), true);

  const pending = repository.createApproval({
    id: "external_action_approval_fixture",
    targetId: "local-device",
    providerId: "downstream-mcp:fixture",
    toolName: "write_file",
    argumentsHash,
    publicSummary: {
      providerDisplayName: "Fixture Provider",
      toolName: "write_file",
      action: "Provider-native mutation"
    },
    requestedActor: actor,
    expiresAt: "2026-08-19T01:05:00.000Z",
    now: "2026-08-19T01:00:00.000Z"
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.revision, 1);
  assert.equal(pending.argumentsHash, argumentsHash);
  assert.deepEqual(pending.requestedActor, actor);
  assert.equal(repository.countPending("2026-08-19T01:01:00.000Z"), 1);

  database.sqlite.exec("PRAGMA wal_checkpoint(PASSIVE)");
  for (const candidate of [governancePath, `${governancePath}-wal`]) {
    if (!fs.existsSync(candidate)) continue;
    const databaseBytes = fs.readFileSync(candidate);
    assert.equal(databaseBytes.includes(Buffer.from(secretArgument, "utf8")), false);
  }

  assert.throws(
    () =>
      repository.decide({
        id: pending.id,
        expectedRevision: 99,
        decision: "approved",
        now: "2026-08-19T01:01:00.000Z"
      }),
    (error) => assertServiceCode(error, "REVISION_CONFLICT")
  );

  const approved = repository.decide({
    id: pending.id,
    expectedRevision: pending.revision,
    decision: "approved",
    decidedActor: {
      actorType: "local-ui",
      actorIdentityHash: "c".repeat(64),
      requestIdentityHash: "d".repeat(64)
    },
    now: "2026-08-19T01:01:00.000Z"
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.revision, 2);
  assert.equal(approved.decidedActor.actorType, "local-ui");

  const consumed = repository.consume({
    id: approved.id,
    expectedRevision: approved.revision,
    now: "2026-08-19T01:02:00.000Z"
  });
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.revision, 3);

  assert.throws(
    () =>
      repository.consume({
        id: consumed.id,
        expectedRevision: consumed.revision,
        now: "2026-08-19T01:02:30.000Z"
      }),
    (error) =>
      assertServiceCode(error, "GOVERNED_EXTERNAL_ACTION_APPROVAL_CONSUMED")
  );

  const execution = repository.createExecution({
    id: "external_action_execution_fixture",
    approvalId: consumed.id,
    executedActor: actor,
    now: "2026-08-19T01:03:00.000Z"
  });
  assert.equal(execution.verificationStatus, "executing");
  assert.equal(execution.argumentsHash, argumentsHash);
  assert.equal(execution.finishedAt, null);

  assert.throws(
    () =>
      repository.createExecution({
        id: "external_action_execution_duplicate",
        approvalId: consumed.id,
        executedActor: actor,
        now: "2026-08-19T01:03:01.000Z"
      }),
    /UNIQUE constraint failed/
  );

  const finished = repository.finishExecution({
    id: execution.id,
    status: "succeeded",
    now: "2026-08-19T01:03:10.000Z"
  });
  assert.equal(finished.verificationStatus, "succeeded");
  assert.equal(finished.errorCode, null);
  assert.equal(finished.finishedAt, "2026-08-19T01:03:10.000Z");

  assert.throws(
    () =>
      repository.finishExecution({
        id: execution.id,
        status: "failed-external",
        now: "2026-08-19T01:03:20.000Z"
      }),
    (error) =>
      assertServiceCode(error, "GOVERNED_EXTERNAL_ACTION_EXECUTION_INVALID")
  );

  const expires = repository.createApproval({
    id: "external_action_approval_expires",
    targetId: "local-device",
    providerId: "downstream-mcp:fixture",
    toolName: "delete_file",
    argumentsHash: "e".repeat(64),
    publicSummary: { toolName: "delete_file" },
    expiresAt: "2026-08-19T02:01:00.000Z",
    now: "2026-08-19T02:00:00.000Z"
  });
  const expired = repository.expireIfNeeded(
    expires.id,
    "2026-08-19T02:02:00.000Z"
  );
  assert.equal(expired.status, "expired");

  const staleCandidate = repository.createApproval({
    id: "external_action_approval_stale",
    targetId: "local-device",
    providerId: "downstream-mcp:fixture",
    toolName: "rename_file",
    argumentsHash: "f".repeat(64),
    publicSummary: { toolName: "rename_file" },
    expiresAt: "2026-08-19T03:05:00.000Z",
    now: "2026-08-19T03:00:00.000Z"
  });
  const stale = repository.markStale({
    id: staleCandidate.id,
    expectedRevision: staleCandidate.revision,
    now: "2026-08-19T03:01:00.000Z"
  });
  assert.equal(stale.status, "stale");
} finally {
  database.close();
  continuityDatabase.close();
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_GOVERNED_EXTERNAL_ACTION_LEDGER_OK\n");
