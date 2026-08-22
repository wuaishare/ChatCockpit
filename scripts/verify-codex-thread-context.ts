import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type { CodexBinaryResolution } from "../src/runtime/codex/binary.ts";

function resolution(command: string): CodexBinaryResolution {
  return {
    command,
    source: "configured",
    version: "codex-cli mock-app-server-1.0.0",
    attempts: [
      {
        source: "configured",
        available: true,
        reason: "codex-cli mock-app-server-1.0.0"
      }
    ]
  };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-thread-context-"));
const workspaceRoot = path.join(tempRoot, "workspace");
const nestedWorkspaceRoot = path.join(workspaceRoot, ".worktrees", "feature");
const databasePath = path.join(tempRoot, "continuity.sqlite");
const fixturePath = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
  "mock-codex-app-server.mjs"
);
fs.mkdirSync(nestedWorkspaceRoot, { recursive: true });

const database = new ContinuityDatabase({ path: databasePath });
const repositories = buildContinuityRepositories(database);
const project = repositories.projects.create({
  id: "project_context",
  slug: "context",
  displayName: "Context",
  now: "2026-08-22T00:00:00.000Z"
});
repositories.workspaces.create({
  id: "workspace_context",
  projectId: project.id,
  repoId: "context",
  privatePath: workspaceRoot,
  kind: "checkout",
  status: "ready",
  now: "2026-08-22T00:00:01.000Z"
});

const env = {
  ...process.env,
  CHATCOCKPIT_MOCK_WORKSPACE_ROOT: workspaceRoot,
  CHATCOCKPIT_MOCK_NESTED_WORKSPACE_ROOT: nestedWorkspaceRoot,
  CHATCOCKPIT_MOCK_INCLUDE_CONTEXT_THREAD: "1"
};
const binary = resolution(process.execPath);
const adapter = new CodexAppServerAdapter({
  workspaces: repositories.workspaces,
  resolveBinary: () => binary,
  createClient: () =>
    new CodexAppServerClient({
      command: process.execPath,
      args: [fixturePath],
      env,
      requestTimeoutMs: 3_000
    })
});

try {
  const first = await adapter.readThreadContext({
    threadId: "thread_context",
    limit: 2
  });
  assert.equal(first.threadId, "thread_context");
  assert.equal(first.workspaceId, "workspace_context");
  assert.equal(first.projectId, "project_context");
  assert.equal(first.repoId, "context");
  assert.deepEqual(
    first.messages.map((message) => message.role),
    ["user", "assistant"]
  );
  assert.equal(first.messages[0]?.text, "Fix the checkout");
  assert.equal(first.messages[1]?.text, "Implemented the fix.");
  assert.ok(first.nextCursor);
  assert.equal(first.truncated, true);
  assert.equal(first.lastTurnId, "turn_context_3");

  const serializedFirst = JSON.stringify(first);
  assert.doesNotMatch(serializedFirst, /private reasoning/);
  assert.doesNotMatch(serializedFirst, /secret-command/);
  assert.doesNotMatch(serializedFirst, /secret-output/);
  assert.doesNotMatch(serializedFirst, /\/private\/path/);
  assert.doesNotMatch(serializedFirst, /must-not-leak-from-unknown-item/);
  assert.doesNotMatch(serializedFirst, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(Buffer.byteLength(serializedFirst, "utf8") <= 64 * 1024);

  const second = await adapter.readThreadContext({
    threadId: "thread_context",
    cursor: first.nextCursor,
    limit: 2
  });
  assert.equal(second.messages.length, 2);
  assert.equal(second.messages[0]?.role, "user");
  assert.equal(second.messages[0]?.truncated, true);
  assert.ok(Buffer.byteLength(second.messages[0]!.text, "utf8") <= 8 * 1024);
  assert.equal(second.messages[1]?.text, "Second visible reply.");
  assert.ok(second.nextCursor);

  const third = await adapter.readThreadContext({
    threadId: "thread_context",
    cursor: second.nextCursor,
    limit: 40
  });
  assert.deepEqual(
    third.messages.map((message) => message.text),
    ["Final visible request.", "Final visible reply."]
  );
  assert.equal(third.nextCursor, null);
  assert.equal(third.truncated, false);
  assert.ok(Buffer.byteLength(JSON.stringify(third), "utf8") <= 64 * 1024);

  const capped = await adapter.readThreadContext({
    threadId: "thread_context_page_cap",
    limit: 40
  });
  assert.ok(capped.messages.length > 0);
  assert.ok(capped.messages.length < 12);
  assert.ok(capped.nextCursor);
  assert.equal(capped.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(capped), "utf8") <= 64 * 1024);
  assert.equal(capped.messages.every((message) => message.truncated), true);

  await assert.rejects(
    () => adapter.readThreadContext({ threadId: "thread_context", cursor: "bad-cursor" }),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "CODEX_THREAD_CONTEXT_CURSOR_INVALID"
      )
  );

  const outside = await adapter.readThreadContext({ threadId: "thread_outside" });
  assert.equal(outside.workspaceId, null);
  assert.equal(outside.messages.length, 0);
  assert.doesNotMatch(JSON.stringify(outside), /private\/external/);
} finally {
  await adapter.close();
  database.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("VERIFY_CODEX_THREAD_CONTEXT_OK");
