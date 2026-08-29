import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChatDirectService } from "../src/application/chat-direct-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { McpIdempotencyStore } from "../src/mcp/idempotency-store.ts";
import { buildWorkspaceWriteTools } from "../src/mcp/tools/workspace-write.ts";

function execution(operationId: string) {
  return {
    lane: "chat-direct" as const,
    modelLoopOwner: "chatgpt" as const,
    executionScope: "workspace" as const,
    executor: "codex-app-server-standalone",
    selectionMode: "automatic" as const,
    operationId,
    changedPaths: [],
    evidenceBundleId: null
  };
}

async function verifyWorkspaceProcessMcp(): Promise<void> {
  const runtimeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-workspace-process-mcp-")
  );
  let execCalls = 0;
  let lastExecNetworkAccess: boolean | undefined;
  let inputCalls = 0;
  let terminateCalls = 0;

  const fakeChatDirect = {
    async workspaceExec(
      _context: unknown,
      payload: { repoId: string; networkAccess?: boolean }
    ) {
      execCalls += 1;
      lastExecNetworkAccess = payload.networkAccess;
      return {
        ok: true as const,
        repoId: payload.repoId,
        processId: "process_fixture_1",
        state: "running" as const,
        execution: execution("op_workspace_exec")
      };
    },
    async workspaceProcessRead(_context: unknown, payload: { repoId: string; processId: string }) {
      return {
        ok: true as const,
        repoId: payload.repoId,
        processId: payload.processId,
        state: "completed" as const,
        exitCode: 0,
        errorCode: null,
        chunks: [
          {
            sequence: 0,
            stream: "stdout" as const,
            content: "managed output\n",
            capReached: false
          }
        ],
        nextCursor: 1,
        execution: execution("op_workspace_read")
      };
    },
    async workspaceProcessInput(_context: unknown, payload: { repoId: string; processId: string }) {
      inputCalls += 1;
      return {
        ok: true as const,
        repoId: payload.repoId,
        processId: payload.processId,
        accepted: true as const,
        execution: execution("op_workspace_input")
      };
    },
    async workspaceProcessTerminate(_context: unknown, payload: { repoId: string; processId: string }) {
      terminateCalls += 1;
      return {
        ok: true as const,
        repoId: payload.repoId,
        processId: payload.processId,
        terminationRequested: true as const,
        execution: execution("op_workspace_terminate")
      };
    }
  } as unknown as ChatDirectService;

  const tools = buildWorkspaceWriteTools(
    {
      chatDirect: fakeChatDirect,
      idempotency: new McpIdempotencyStore(runtimeDir)
    },
    "chatcockpit"
  );
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const context = buildOperationContext({
    requestId: "verify-workspace-process-mcp",
    actorType: "remote-mcp",
    authorizationGrantId: "grant_workspace_process_mcp",
    publicProjection: true,
    now: "2026-08-27T01:00:00.000Z"
  });

  const execTool = byName.get("chatcockpit.workspace.exec");
  const readTool = byName.get("chatcockpit.workspace.process.read");
  const controlTool = byName.get("chatcockpit.workspace.process.control");
  assert.ok(execTool);
  assert.ok(readTool);
  assert.ok(controlTool);
  assert.equal(execTool.annotations.destructiveHint, true);
  assert.equal(execTool.annotations.openWorldHint, true);
  assert.match(JSON.stringify(execTool.inputSchema), /executionMode/);
  assert.match(JSON.stringify(execTool.inputSchema), /host-managed/);
  assert.equal(readTool.annotations.readOnlyHint, true);
  assert.equal(readTool.annotations.openWorldHint, false);
  assert.equal(controlTool.annotations.destructiveHint, true);
  assert.equal(controlTool.annotations.openWorldHint, true);

  const execInput = {
    repoId: "primary",
    command: "git",
    args: ["fetch", "origin"],
    networkAccess: true,
    idempotencyKey: "workspace-exec-fixture-0001"
  };
  const firstExec = await execTool.execute(context, execInput);
  assert.equal(firstExec.isError, undefined);
  assert.equal(firstExec.structuredContent.processId, "process_fixture_1");
  assert.deepEqual(firstExec.structuredContent.idempotency, {
    key: execInput.idempotencyKey,
    replayed: false
  });
  const replayExec = await execTool.execute(context, execInput);
  assert.equal(replayExec.isError, undefined);
  assert.equal((replayExec.structuredContent.idempotency as { replayed: boolean }).replayed, true);
  assert.equal(execCalls, 1);
  assert.equal(lastExecNetworkAccess, true);

  const read = await readTool.execute(context, {
    repoId: "primary",
    processId: "process_fixture_1",
    cursor: 0,
    limit: 20
  });
  assert.equal(read.isError, undefined);
  assert.equal(read.structuredContent.state, "completed");
  assert.equal(read.structuredContent.nextCursor, 1);

  const inputArgs = {
    repoId: "primary",
    processId: "process_fixture_1",
    action: "input" as const,
    input: "yes\n",
    closeStdin: false,
    idempotencyKey: "workspace-process-input-0001"
  };
  const input = await controlTool.execute(context, inputArgs);
  assert.equal(input.isError, undefined);
  assert.equal(input.structuredContent.action, "input");
  assert.equal(input.structuredContent.accepted, true);
  const replayInput = await controlTool.execute(context, inputArgs);
  assert.equal(replayInput.isError, undefined);
  assert.equal((replayInput.structuredContent.idempotency as { replayed: boolean }).replayed, true);
  assert.equal(inputCalls, 1);

  const terminate = await controlTool.execute(context, {
    repoId: "primary",
    processId: "process_fixture_1",
    action: "terminate",
    idempotencyKey: "workspace-process-terminate-0001"
  });
  assert.equal(terminate.isError, undefined);
  assert.equal(terminate.structuredContent.action, "terminate");
  assert.equal(terminate.structuredContent.terminationRequested, true);
  assert.equal(terminateCalls, 1);

  fs.rmSync(runtimeDir, { recursive: true, force: true });
}

await verifyWorkspaceProcessMcp();
process.stdout.write("VERIFY_WORKSPACE_PROCESS_MCP_OK\n");
