import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildServer } from "../src/server/app.ts";
import { runGit } from "./test-support/git.ts";
import { listenTestServer } from "./test-support/server.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function initGitRepo(repoRoot: string): void {
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.email", "tokenpilot-mcp@example.invalid"]);
  runGit(repoRoot, ["config", "user.name", "TokenPilot MCP Test"]);
  runGit(repoRoot, ["add", "README.md", "src/catalog-fixture.ts"]);
  runGit(repoRoot, ["commit", "-m", "init"]);
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  if (dataLines.length > 0) {
    return JSON.parse(dataLines.join("\n")) as JsonRpcResponse;
  }

  return JSON.parse(body) as JsonRpcResponse;
}

async function postMcp(
  baseUrl: string,
  payload: Record<string, unknown>,
  options: { token?: string; path?: "/mcp" | "/tokenpilot/mcp" } = {}
): Promise<{ response: Response; message: JsonRpcResponse }> {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-06-18"
  });
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${baseUrl}${options.path ?? "/mcp"}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  return {
    response,
    message: parseMcpResponse(body)
  };
}

async function runMcpSmoke(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-mcp-smoke-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# MCP fixture\n", "utf8");
  fs.writeFileSync(
    path.join(repoRoot, "src", "catalog-fixture.ts"),
    "export const mcpNeedle = 'tokenpilot-mcp-smoke';\n",
    "utf8"
  );
  fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=must-not-leak\n", "utf8");
  initGitRepo(repoRoot);

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "mcp-smoke-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaceAllowlist: [repoRoot],
        repoMappings: {
          tokenpilot: {
            path: repoRoot
          }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  const originalToken = process.env.TOKENPILOT_API_TOKEN;
  const originalExposed = process.env.TOKENPILOT_EXPOSED;
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  process.env.TOKENPILOT_API_TOKEN = "test-token";
  process.env.TOKENPILOT_EXPOSED = "true";

  const app = buildServer(paths);
  let testServer: Awaited<ReturnType<typeof listenTestServer>> | null = null;

  try {
    testServer = await listenTestServer(app);
    const baseUrl = testServer.baseUrl;

    const restPost = async <T>(route: string, body: unknown): Promise<T> => {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as T & {
        error?: { code: string; message: string };
      };
      assert.equal(
        response.ok,
        true,
        `REST ${route} failed: ${JSON.stringify(payload)}`
      );
      return payload;
    };

    const unauthorized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "tools/list",
        params: {}
      })
    });
    assert.equal(unauthorized.status, 401);
    const unauthorizedBody = (await unauthorized.json()) as {
      error: { code: string };
    };
    assert.equal(unauthorizedBody.error.code, "UNAUTHORIZED");

    const initialize = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "tokenpilot-mcp-smoke",
            version: "1.0.0"
          }
        }
      },
      { token: "test-token" }
    );
    assert.equal(initialize.response.status, 200);
    assert.equal(initialize.message.error, undefined);
    assert.equal(
      (initialize.message.result?.serverInfo as { name: string }).name,
      "tokenpilot"
    );

    const list = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      },
      { token: "test-token", path: "/tokenpilot/mcp" }
    );
    assert.equal(list.response.status, 200);
    const tools = list.message.result?.tools as Array<{
      name: string;
      annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
    }>;
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        "tokenpilot.asyncJob.queue",
        "tokenpilot.direct.executors.list",
        "tokenpilot.document.appendVersion",
        "tokenpilot.document.create",
        "tokenpilot.document.get",
        "tokenpilot.document.list",
        "tokenpilot.document.updateStatus",
        "tokenpilot.document.version.get",
        "tokenpilot.evidence.record",
        "tokenpilot.files.edit",
        "tokenpilot.files.list",
        "tokenpilot.files.read",
        "tokenpilot.files.readBatch",
        "tokenpilot.files.write",
        "tokenpilot.git.commit",
        "tokenpilot.git.diff",
        "tokenpilot.git.status",
        "tokenpilot.host.command.decide",
        "tokenpilot.host.command.execute",
        "tokenpilot.host.command.prepare",
        "tokenpilot.host.files.read",
        "tokenpilot.host.mutation.decide",
        "tokenpilot.host.mutation.execute",
        "tokenpilot.host.mutation.prepare",
        "tokenpilot.host.process.decide",
        "tokenpilot.host.process.execute",
        "tokenpilot.host.process.list",
        "tokenpilot.host.process.prepare",
        "tokenpilot.host.process.read",
        "tokenpilot.host.roots.list",
        "tokenpilot.handoff.accept",
        "tokenpilot.handoff.cancel",
        "tokenpilot.handoff.fork",
        "tokenpilot.handoff.prepare",
        "tokenpilot.lease.acquire",
        "tokenpilot.lease.release",
        "tokenpilot.project.get",
        "tokenpilot.project.list",
        "tokenpilot.runtime.capabilities",
        "tokenpilot.search.code",
        "tokenpilot.codex.approval.respond",
        "tokenpilot.codex.events.read",
        "tokenpilot.codex.session.bind",
        "tokenpilot.codex.session.fork",
        "tokenpilot.codex.session.resume",
        "tokenpilot.codex.thread.list",
        "tokenpilot.codex.thread.read",
        "tokenpilot.codex.turn.interrupt",
        "tokenpilot.codex.turn.start",
        "tokenpilot.session.get",
        "tokenpilot.session.start",
        "tokenpilot.shell.run",
        "tokenpilot.task.bindDocuments",
        "tokenpilot.task.complete",
        "tokenpilot.task.create",
        "tokenpilot.task.get",
        "tokenpilot.task.submitReview",
        "tokenpilot.workspace.snapshot"
      ].sort()
    );
    const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const rawDownstreamName of [
      "start_process",
      "read_process_output",
      "interact_with_process",
      "force_terminate",
      "list_sessions",
      "list_processes",
      "kill_process"
    ]) {
      assert.equal(toolByName.has(rawDownstreamName), false);
    }
    for (const name of [
      "tokenpilot.direct.executors.list",
      "tokenpilot.document.get",
      "tokenpilot.document.list",
      "tokenpilot.document.version.get",
      "tokenpilot.files.list",
      "tokenpilot.files.read",
      "tokenpilot.files.readBatch",
      "tokenpilot.git.diff",
      "tokenpilot.git.status",
      "tokenpilot.host.files.read",
      "tokenpilot.host.process.list",
      "tokenpilot.host.process.read",
      "tokenpilot.host.roots.list",
      "tokenpilot.project.get",
      "tokenpilot.project.list",
      "tokenpilot.runtime.capabilities",
      "tokenpilot.search.code",
      "tokenpilot.codex.events.read",
      "tokenpilot.codex.thread.list",
      "tokenpilot.codex.thread.read",
      "tokenpilot.session.get",
      "tokenpilot.task.get",
      "tokenpilot.workspace.snapshot"
    ]) {
      assert.equal(toolByName.get(name)?.annotations.readOnlyHint, true);
      assert.equal(toolByName.get(name)?.annotations.destructiveHint, false);
    }
    assert.equal(toolByName.get("tokenpilot.files.write")?.annotations.readOnlyHint, false);
    assert.equal(toolByName.get("tokenpilot.files.write")?.annotations.destructiveHint, true);
    assert.equal(toolByName.get("tokenpilot.files.edit")?.annotations.readOnlyHint, false);
    assert.equal(toolByName.get("tokenpilot.files.edit")?.annotations.destructiveHint, false);
    assert.equal(toolByName.get("tokenpilot.shell.run")?.annotations.destructiveHint, true);
    assert.equal(
      toolByName.get("tokenpilot.host.command.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("tokenpilot.host.command.execute")?.annotations.destructiveHint,
      true
    );
    assert.equal(
      toolByName.get("tokenpilot.host.mutation.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("tokenpilot.host.mutation.execute")?.annotations.destructiveHint,
      true
    );
    assert.equal(
      toolByName.get("tokenpilot.host.process.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("tokenpilot.host.process.execute")?.annotations.destructiveHint,
      true
    );
    for (const name of [
      "tokenpilot.host.command.prepare",
      "tokenpilot.host.command.decide",
      "tokenpilot.host.command.execute",
      "tokenpilot.host.mutation.prepare",
      "tokenpilot.host.mutation.decide",
      "tokenpilot.host.mutation.execute",
      "tokenpilot.host.process.prepare",
      "tokenpilot.host.process.decide",
      "tokenpilot.host.process.execute",
      "tokenpilot.host.process.read",
      "tokenpilot.host.process.list"
    ]) {
      assert.equal(toolByName.get(name)?.annotations.idempotentHint, true);
      assert.equal(toolByName.get(name)?.annotations.openWorldHint, false);
    }
    assert.equal(toolByName.get("tokenpilot.git.commit")?.annotations.destructiveHint, false);
    assert.equal(toolByName.get("tokenpilot.lease.acquire")?.annotations.destructiveHint, true);
    for (const name of [
      "tokenpilot.document.appendVersion",
      "tokenpilot.document.create",
      "tokenpilot.document.updateStatus",
      "tokenpilot.codex.session.bind",
      "tokenpilot.codex.session.fork",
      "tokenpilot.codex.session.resume",
      "tokenpilot.codex.turn.interrupt",
      "tokenpilot.asyncJob.queue",
      "tokenpilot.evidence.record",
      "tokenpilot.handoff.accept",
      "tokenpilot.handoff.cancel",
      "tokenpilot.handoff.fork",
      "tokenpilot.handoff.prepare",
      "tokenpilot.host.command.decide",
      "tokenpilot.host.command.prepare",
      "tokenpilot.host.mutation.decide",
      "tokenpilot.host.mutation.prepare",
      "tokenpilot.host.process.decide",
      "tokenpilot.host.process.prepare",
      "tokenpilot.lease.release",
      "tokenpilot.session.start",
      "tokenpilot.task.bindDocuments",
      "tokenpilot.task.complete",
      "tokenpilot.task.create",
      "tokenpilot.task.submitReview"
    ]) {
      assert.equal(toolByName.get(name)?.annotations.readOnlyHint, false);
      assert.equal(toolByName.get(name)?.annotations.destructiveHint, false);
    }
    assert.equal(
      toolByName.get("tokenpilot.task.complete")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("tokenpilot.task.complete")?.annotations.openWorldHint,
      false
    );
    assert.equal(
      toolByName.get("tokenpilot.task.submitReview")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("tokenpilot.task.submitReview")?.annotations.openWorldHint,
      false
    );
    assert.equal(
      toolByName.get("tokenpilot.asyncJob.queue")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("tokenpilot.asyncJob.queue")?.annotations.openWorldHint,
      false
    );
    for (const name of [
      "tokenpilot.codex.approval.respond",
      "tokenpilot.codex.turn.start"
    ]) {
      assert.equal(toolByName.get(name)?.annotations.readOnlyHint, false);
      assert.equal(toolByName.get(name)?.annotations.destructiveHint, true);
    }

    const read = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "tokenpilot.files.read",
          arguments: {
            repoId: "tokenpilot",
            path: "README.md"
          }
        }
      },
      { token: "test-token" }
    );
    assert.equal(read.response.status, 200);
    const readResult = read.message.result as {
      isError?: boolean;
      structuredContent: {
        ok: boolean;
        file: { content: string };
        execution: {
          lane: string;
          modelLoopOwner: string;
          executor: string;
          operationId: string;
        };
      };
    };
    assert.equal(readResult.isError, undefined);
    assert.equal(readResult.structuredContent.ok, true);
    assert.match(readResult.structuredContent.file.content, /MCP fixture/);
    assert.equal(readResult.structuredContent.execution.lane, "chat-direct");
    assert.equal(readResult.structuredContent.execution.modelLoopOwner, "chatgpt");
    assert.equal(readResult.structuredContent.execution.executor, "tokenpilot-direct");

    const restReadResponse = await fetch(`${baseUrl}/api/files/read`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        path: "README.md"
      })
    });
    assert.equal(restReadResponse.status, 200);
    const restRead = (await restReadResponse.json()) as typeof readResult.structuredContent;
    assert.equal(restRead.file.content, readResult.structuredContent.file.content);
    assert.equal(restRead.execution.lane, "chat-direct");
    assert.equal(restRead.execution.modelLoopOwner, "chatgpt");
    assert.equal(restRead.execution.executor, "tokenpilot-direct");

    const blocked = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "tokenpilot.files.read",
          arguments: {
            repoId: "tokenpilot",
            path: ".env"
          }
        }
      },
      { token: "test-token" }
    );
    assert.equal(blocked.response.status, 200);
    const blockedResult = blocked.message.result as {
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
        };
      };
    };
    assert.equal(blockedResult.isError, true);
    assert.equal(blockedResult.structuredContent.error.code, "FILES_READ_BLOCKED");
    assert.doesNotMatch(JSON.stringify(blockedResult), /must-not-leak/);

    const projectsResponse = await fetch(`${baseUrl}/api/continuity/projects`, {
      headers: { authorization: "Bearer test-token" }
    });
    assert.equal(projectsResponse.status, 200);
    const projectsBody = (await projectsResponse.json()) as {
      ok: true;
      projects: Array<{
        project: { id: string };
        workspaces: Array<{ id: string }>;
      }>;
    };
    const project = projectsBody.projects[0]?.project;
    const workspace = projectsBody.projects[0]?.workspaces[0];
    assert.ok(project);
    assert.ok(workspace);

    const taskResult = await restPost<{
      ok: true;
      task: { id: string; revision: number };
    }>("/api/continuity/tasks", {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "MCP Chat Direct mutation task",
      goal: "Verify MCP mutation requires a Session-bound Writer Lease",
      priority: "high",
      idempotencyKey: "mcp-chat-direct-task-0001"
    });
    const sessionResult = await restPost<{
      ok: true;
      session: { id: string; revision: number };
      task: { revision: number };
    }>("/api/continuity/sessions/start", {
      taskId: taskResult.task.id,
      title: "MCP Chat Direct writer session",
      mode: "chat-direct",
      expectedTaskRevision: taskResult.task.revision,
      idempotencyKey: "mcp-chat-direct-session-0001"
    });
    await restPost("/api/continuity/leases/acquire", {
      sessionId: sessionResult.session.id,
      holderId: "mcp-chat-direct-holder",
      expiresAt: "2099-01-01T00:00:00.000Z",
      idempotencyKey: "mcp-chat-direct-lease-0001"
    });
    const competingTaskResult = await restPost<{
      ok: true;
      task: { id: string; revision: number };
    }>("/api/continuity/tasks", {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Competing MCP Chat Direct task",
      goal: "Prove a second Session cannot use another Session's Writer Lease",
      priority: "normal",
      idempotencyKey: "mcp-chat-direct-task-competing-0001"
    });
    const competingSessionResult = await restPost<{
      ok: true;
      session: { id: string };
    }>("/api/continuity/sessions/start", {
      taskId: competingTaskResult.task.id,
      title: "Competing MCP Chat Direct session",
      mode: "chat-direct",
      expectedTaskRevision: competingTaskResult.task.revision,
      idempotencyKey: "mcp-chat-direct-session-competing-0001"
    });

    const competingEdit = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "tokenpilot.files.edit",
          arguments: {
            repoId: "tokenpilot",
            sessionId: competingSessionResult.session.id,
            path: "README.md",
            search: "MCP fixture",
            replace: "MCP competing",
            idempotencyKey: "edit-readme-competing-0001"
          }
        }
      },
      { token: "test-token" }
    );
    const competingEditResult = competingEdit.message.result as {
      isError: boolean;
      structuredContent: { error: { code: string } };
    };
    assert.equal(competingEditResult.isError, true);
    assert.equal(
      competingEditResult.structuredContent.error.code,
      "WRITER_LEASE_CONFLICT"
    );
    assert.equal(
      fs.readFileSync(path.join(repoRoot, "README.md"), "utf8"),
      "# MCP fixture\n"
    );

    const missingLeaseShell = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "tokenpilot.shell.run",
          arguments: {
            repoId: "tokenpilot",
            command: "git",
            args: ["add", "README.md"],
            idempotencyKey: "shell-missing-session-0001"
          }
        }
      },
      { token: "test-token" }
    );
    const missingLeaseShellResult = missingLeaseShell.message.result as {
      isError: boolean;
      structuredContent: { error: { code: string } };
    };
    assert.equal(missingLeaseShellResult.isError, true);
    assert.equal(
      missingLeaseShellResult.structuredContent.error.code,
      "WRITER_LEASE_REQUIRED"
    );

    const missingLeaseRestResponse = await fetch(`${baseUrl}/api/shell/run`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        command: "git",
        args: ["add", "README.md"]
      })
    });
    assert.equal(missingLeaseRestResponse.status, 409);
    const missingLeaseRest = (await missingLeaseRestResponse.json()) as {
      error: { code: string };
    };
    assert.equal(missingLeaseRest.error.code, "WRITER_LEASE_REQUIRED");

    const editPayload = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "tokenpilot.files.edit",
        arguments: {
          repoId: "tokenpilot",
          sessionId: sessionResult.session.id,
          path: "README.md",
          search: "MCP fixture",
          replace: "MCP updated",
          idempotencyKey: "edit-readme-0001"
        }
      }
    };
    const firstEdit = await postMcp(
      baseUrl,
      { ...editPayload, id: 5 },
      { token: "test-token" }
    );
    const firstEditResult = firstEdit.message.result as {
      isError?: boolean;
      structuredContent: {
        changedPaths: string[];
        execution: {
          lane: string;
          modelLoopOwner: string;
          executor: string;
          operationId: string;
        };
        idempotency: {
          replayed: boolean;
        };
      };
    };
    assert.equal(firstEditResult.isError, undefined);
    assert.deepEqual(firstEditResult.structuredContent.changedPaths, ["README.md"]);
    assert.equal(firstEditResult.structuredContent.execution.lane, "chat-direct");
    assert.equal(firstEditResult.structuredContent.execution.modelLoopOwner, "chatgpt");
    assert.equal(firstEditResult.structuredContent.execution.executor, "tokenpilot-direct");
    assert.equal(firstEditResult.structuredContent.idempotency.replayed, false);
    assert.equal(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8"), "# MCP updated\n");

    const replayEdit = await postMcp(
      baseUrl,
      { ...editPayload, id: 6 },
      { token: "test-token" }
    );
    const replayEditResult = replayEdit.message.result as {
      isError?: boolean;
      structuredContent: {
        changedPaths: string[];
        execution: {
          operationId: string;
        };
        idempotency: {
          replayed: boolean;
        };
      };
    };
    assert.equal(replayEditResult.isError, undefined);
    assert.deepEqual(replayEditResult.structuredContent.changedPaths, ["README.md"]);
    assert.equal(
      replayEditResult.structuredContent.execution.operationId,
      firstEditResult.structuredContent.execution.operationId
    );
    assert.equal(replayEditResult.structuredContent.idempotency.replayed, true);
    assert.equal(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8"), "# MCP updated\n");

    const conflictingEdit = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "tokenpilot.files.edit",
          arguments: {
            repoId: "tokenpilot",
            sessionId: sessionResult.session.id,
            path: "README.md",
            search: "MCP updated",
            replace: "MCP conflict",
            idempotencyKey: "edit-readme-0001"
          }
        }
      },
      { token: "test-token" }
    );
    const conflictingEditResult = conflictingEdit.message.result as {
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
        };
      };
    };
    assert.equal(conflictingEditResult.isError, true);
    assert.equal(
      conflictingEditResult.structuredContent.error.code,
      "IDEMPOTENCY_KEY_REUSED"
    );
    assert.equal(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8"), "# MCP updated\n");

    const blockedShell = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "tokenpilot.shell.run",
          arguments: {
            repoId: "tokenpilot",
            sessionId: sessionResult.session.id,
            command: "node",
            args: ["--version"],
            idempotencyKey: "shell-blocked-0001"
          }
        }
      },
      { token: "test-token" }
    );
    const blockedShellResult = blockedShell.message.result as {
      isError: boolean;
      structuredContent: {
        error: {
          code: string;
        };
      };
    };
    assert.equal(blockedShellResult.isError, true);
    assert.equal(
      blockedShellResult.structuredContent.error.code,
      "SHELL_COMMAND_BLOCKED"
    );
  } finally {
    await testServer?.close();
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
    if (originalToken === undefined) {
      delete process.env.TOKENPILOT_API_TOKEN;
    } else {
      process.env.TOKENPILOT_API_TOKEN = originalToken;
    }
    if (originalExposed === undefined) {
      delete process.env.TOKENPILOT_EXPOSED;
    } else {
      process.env.TOKENPILOT_EXPOSED = originalExposed;
    }
  }
}

await runMcpSmoke();
process.stdout.write("VERIFY_MCP_SMOKE_OK\n");
