import assert from "node:assert/strict";

import { projectOperationalActivityEvent } from "../src/application/operational-activity-event-projector.js";
import type { RuntimeEventRecord } from "../src/continuity/types.js";

function event(
  method: string,
  category: RuntimeEventRecord["category"],
  publicPayload: Record<string, unknown> = {}
): RuntimeEventRecord {
  return {
    sequence: 7,
    id: "event_fixture_opaque",
    runId: "run_fixture",
    sessionId: "session_fixture",
    workspaceId: "workspace_fixture",
    threadId: "thread_fixture",
    turnId: "turn_fixture",
    itemId: null,
    method,
    category,
    publicPayload,
    createdAt: "2026-08-20T03:00:00.000Z"
  };
}

assert.equal(projectOperationalActivityEvent(event("turn/started", "lifecycle", { status: "running" })).kind, "run-started");
assert.equal(projectOperationalActivityEvent(event("turn/completed", "lifecycle", { status: "completed" })).kind, "run-completed");
assert.equal(projectOperationalActivityEvent(event("turn/completed", "lifecycle", { status: "failed", errorCode: "CODEX_TURN_FAILED" })).kind, "run-failed");
assert.equal(projectOperationalActivityEvent(event("turn/completed", "lifecycle", { status: "interrupted" })).kind, "run-interrupted");
assert.equal(projectOperationalActivityEvent(event("item/started", "item", { itemType: "commandExecution" })).kind, "step-started");
assert.equal(projectOperationalActivityEvent(event("item/completed", "item", { itemType: "commandExecution" })).kind, "step-completed");

const approval = projectOperationalActivityEvent(event("item/fileChange/requestApproval", "approval", {
  kind: "file-change",
  status: "pending",
  summary: { reason: "must remain private to the runtime approval surface" }
}));
assert.equal(approval.kind, "approval-required");
assert.equal(approval.approvalKind, "file-change");
assert.equal("summary" in approval, false);

assert.equal(projectOperationalActivityEvent(event("serverRequest/resolved", "approval", { status: "resolved" })).kind, "approval-resolved");
assert.equal(projectOperationalActivityEvent(event("approval/rejectedUnsupported", "approval", { status: "stale" })).kind, "approval-rejected");
assert.equal(projectOperationalActivityEvent(event("guardianWarning", "warning", { code: "POLICY_WARNING" })).kind, "warning");
assert.equal(projectOperationalActivityEvent(event("error", "error", { code: "RUNTIME_FAILED" })).kind, "error");

const unsafe = projectOperationalActivityEvent(event("provider/privateMethod", "other", {
  itemType: "private/workspace",
  code: "secret value with spaces",
  raw: "must never project"
}));
assert.equal(unsafe.kind, "activity");
assert.equal(unsafe.itemType, null);
assert.equal(unsafe.code, null);
assert.equal(JSON.stringify(unsafe).includes("privateMethod"), false);
assert.equal(JSON.stringify(unsafe).includes("private/workspace"), false);
assert.equal(JSON.stringify(unsafe).includes("must never project"), false);

process.stdout.write("VERIFY_OPERATIONAL_ACTIVITY_EVENT_PROJECTOR_OK\n");
