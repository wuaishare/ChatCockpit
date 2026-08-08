import assert from "node:assert/strict";

import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const NOW = "2026-08-08T14:00:00.000Z";
const LATER = "2026-08-08T14:10:00.000Z";

function expectCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);

try {
  assert.equal(database.schemaVersion(), 9);
  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);

  const pending = repositories.directCommandApprovals.create({
    id: "direct_command_approval_pending",
    rootId: "fixture",
    workdir: "projects/demo",
    command: "git",
    args: ["status", "--short"],
    commandHash: "hash-pending",
    effect: "read",
    timeoutMs: 5000,
    executorId: "downstream-mcp:desktop-commander",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: {
      command: "git status --short",
      workdir: "fixture/projects/demo",
      effect: "read"
    },
    expiresAt: "2026-08-08T14:05:00.000Z",
    now: NOW
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.revision, 1);
  assert.deepEqual(pending.args, ["status", "--short"]);
  assert.equal(pending.timeoutMs, 5000);

  const approved = repositories.directCommandApprovals.decide({
    id: pending.id,
    decision: "approved",
    expectedRevision: pending.revision,
    now: NOW
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.revision, 2);

  expectCode(
    () =>
      repositories.directCommandApprovals.decide({
        id: approved.id,
        decision: "denied",
        expectedRevision: approved.revision,
        now: NOW
      }),
    "HOST_COMMAND_APPROVAL_INVALID"
  );

  const consumed = repositories.directCommandApprovals.consume({
    id: approved.id,
    expectedRevision: approved.revision,
    now: NOW
  });
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.revision, 3);
  expectCode(
    () =>
      repositories.directCommandApprovals.consume({
        id: consumed.id,
        expectedRevision: consumed.revision,
        now: NOW
      }),
    "HOST_COMMAND_APPROVAL_CONSUMED"
  );

  const deniedPending = repositories.directCommandApprovals.create({
    rootId: "fixture",
    workdir: ".",
    command: "pwd",
    args: [],
    commandHash: "hash-denied",
    effect: "read",
    timeoutMs: 1000,
    executorId: "downstream-mcp:desktop-commander",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { command: "pwd", effect: "read" },
    expiresAt: "2026-08-08T14:05:00.000Z",
    now: NOW
  });
  const denied = repositories.directCommandApprovals.decide({
    id: deniedPending.id,
    decision: "denied",
    expectedRevision: deniedPending.revision,
    now: NOW
  });
  assert.equal(denied.status, "denied");
  expectCode(
    () =>
      repositories.directCommandApprovals.consume({
        id: denied.id,
        expectedRevision: denied.revision,
        now: NOW
      }),
    "HOST_COMMAND_APPROVAL_REQUIRED"
  );

  const expiring = repositories.directCommandApprovals.create({
    rootId: "fixture",
    workdir: ".",
    command: "pwd",
    args: [],
    commandHash: "hash-expired",
    effect: "read",
    timeoutMs: 1000,
    executorId: "downstream-mcp:desktop-commander",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { command: "pwd", effect: "read" },
    expiresAt: "2026-08-08T14:01:00.000Z",
    now: NOW
  });
  const expired = repositories.directCommandApprovals.expireIfNeeded(
    expiring.id,
    LATER
  );
  assert.equal(expired.status, "expired");
  expectCode(
    () =>
      repositories.directCommandApprovals.decide({
        id: expiring.id,
        decision: "approved",
        expectedRevision: expiring.revision,
        now: LATER
      }),
    "HOST_COMMAND_APPROVAL_EXPIRED"
  );

  const audit = repositories.directCommandAudit.create({
    id: "direct_command_audit_fixture",
    rootId: "fixture",
    workdir: "projects/demo",
    commandHash: consumed.commandHash,
    effect: consumed.effect,
    executorId: consumed.executorId,
    approvalId: consumed.id,
    exitCode: 0,
    timedOut: false,
    status: "succeeded",
    errorCode: null,
    startedAt: NOW,
    completedAt: NOW,
    now: NOW
  });
  assert.equal(audit.status, "succeeded");
  assert.equal(audit.exitCode, 0);
  assert.equal(audit.timedOut, false);
  assert.deepEqual(
    repositories.directCommandAudit.listByApproval(consumed.id).map((entry) => entry.id),
    [audit.id]
  );

  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  process.stdout.write("VERIFY_HOST_DIRECT_COMMAND_OK\n");
} finally {
  database.close();
}
