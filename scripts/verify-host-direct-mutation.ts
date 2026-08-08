import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

function expectServiceCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

function verifyDirectMutationPersistence(): void {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-mutation-")
  );
  const database = new ContinuityDatabase({
    path: path.join(sandbox, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);

  try {
    assert.equal(database.schemaVersion(), 8);

    const pending = repositories.directMutationApprovals.create({
      operation: "files.write",
      rootId: "fixture",
      relativePath: "notes/new.txt",
      mutationHash: "a".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      targetKind: "pure-host",
      workspaceId: null,
      repoId: null,
      sessionId: null,
      publicSummary: {
        operation: "files.write",
        target: "fixture/notes/new.txt",
        targetKind: "pure-host"
      },
      expiresAt: "2026-08-08T12:05:00.000Z",
      now: "2026-08-08T12:00:00.000Z"
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.revision, 1);
    assert.equal(pending.scope, "host");
    assert.equal(pending.targetKind, "pure-host");
    assert.equal(pending.workspaceId, null);
    assert.doesNotMatch(JSON.stringify(pending), /\/Users\//);

    const approved = repositories.directMutationApprovals.decide({
      id: pending.id,
      decision: "approved",
      expectedRevision: pending.revision,
      now: "2026-08-08T12:01:00.000Z"
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.revision, 2);
    assert.equal(approved.decidedAt, "2026-08-08T12:01:00.000Z");

    const consumed = repositories.directMutationApprovals.consume({
      id: approved.id,
      expectedRevision: approved.revision,
      now: "2026-08-08T12:02:00.000Z"
    });
    assert.equal(consumed.status, "consumed");
    assert.equal(consumed.revision, 3);
    assert.equal(consumed.consumedAt, "2026-08-08T12:02:00.000Z");
    expectServiceCode(
      () =>
        repositories.directMutationApprovals.consume({
          id: consumed.id,
          expectedRevision: consumed.revision,
          now: "2026-08-08T12:03:00.000Z"
        }),
      "HOST_MUTATION_APPROVAL_CONSUMED"
    );

    const expiring = repositories.directMutationApprovals.create({
      operation: "files.edit",
      rootId: "fixture",
      relativePath: "notes/edit.txt",
      mutationHash: "b".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      targetKind: "pure-host",
      workspaceId: null,
      repoId: null,
      sessionId: null,
      publicSummary: {
        operation: "files.edit",
        target: "fixture/notes/edit.txt",
        targetKind: "pure-host"
      },
      expiresAt: "2026-08-08T12:01:00.000Z",
      now: "2026-08-08T12:00:00.000Z"
    });
    const expired = repositories.directMutationApprovals.expireIfNeeded(
      expiring.id,
      "2026-08-08T12:02:00.000Z"
    );
    assert.equal(expired.status, "expired");
    expectServiceCode(
      () =>
        repositories.directMutationApprovals.decide({
          id: expired.id,
          decision: "approved",
          expectedRevision: expired.revision,
          now: "2026-08-08T12:02:00.000Z"
        }),
      "HOST_MUTATION_APPROVAL_EXPIRED"
    );

    const deniedPending = repositories.directMutationApprovals.create({
      operation: "files.write",
      rootId: "fixture",
      relativePath: "notes/denied.txt",
      mutationHash: "c".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      targetKind: "pure-host",
      workspaceId: null,
      repoId: null,
      sessionId: null,
      publicSummary: { target: "fixture/notes/denied.txt" },
      expiresAt: "2026-08-08T12:05:00.000Z",
      now: "2026-08-08T12:00:00.000Z"
    });
    const denied = repositories.directMutationApprovals.decide({
      id: deniedPending.id,
      decision: "denied",
      expectedRevision: deniedPending.revision,
      now: "2026-08-08T12:01:00.000Z"
    });
    assert.equal(denied.status, "denied");
    expectServiceCode(
      () =>
        repositories.directMutationApprovals.consume({
          id: denied.id,
          expectedRevision: denied.revision,
          now: "2026-08-08T12:02:00.000Z"
        }),
      "HOST_MUTATION_APPROVAL_REQUIRED"
    );

    const audit = repositories.directMutationAudit.create({
      operation: "files.write",
      rootId: "fixture",
      relativePath: "notes/new.txt",
      beforeHash: null,
      afterHash: "d".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      approvalId: consumed.id,
      status: "succeeded",
      errorCode: null,
      startedAt: "2026-08-08T12:01:30.000Z",
      completedAt: "2026-08-08T12:02:00.000Z",
      now: "2026-08-08T12:02:00.000Z"
    });
    assert.equal(audit.status, "succeeded");
    assert.equal(audit.approvalId, consumed.id);
    assert.equal(
      repositories.directMutationAudit.get(audit.id).afterHash,
      "d".repeat(64)
    );
    assert.doesNotMatch(JSON.stringify(audit), new RegExp(sandbox));
  } finally {
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

verifyDirectMutationPersistence();
process.stdout.write("VERIFY_HOST_DIRECT_MUTATION_OK\n");
