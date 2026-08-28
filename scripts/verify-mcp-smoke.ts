import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { buildServer } from "../src/server/app.ts";
import { runGit } from "./test-support/git.ts";
import { listenTestServer } from "./test-support/server.ts";
import { classifyMcpToolSurface, isDefaultCoreMcpTool } from "../src/mcp/tool-surface.ts";

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
  runGit(repoRoot, ["config", "user.email", "chatcockpit-mcp@example.invalid"]);
  runGit(repoRoot, ["config", "user.name", "ChatCockpit MCP Test"]);
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
  options: { token?: string; path?: string } = {}
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
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-mcp-smoke-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# MCP fixture\n", "utf8");
  fs.writeFileSync(
    path.join(repoRoot, "src", "catalog-fixture.ts"),
    "export const mcpNeedle = 'chatcockpit-mcp-smoke';\n",
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
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [repoRoot],
        repoMappings: {
          primary: {
            path: repoRoot
          }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  const originalToken = process.env.CHATCOCKPIT_API_TOKEN;
  const originalExposed = process.env.CHATCOCKPIT_EXPOSED;
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token";
  process.env.CHATCOCKPIT_EXPOSED = "true";

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
            name: "chatcockpit-mcp-smoke",
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
      "chatcockpit"
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
      outputSchema?: Record<string, unknown>;
    }>;
    assert.equal(
      tools.every((tool) => tool.name.startsWith("chatcockpit.")),
      true
    );
    assert.deepEqual(
      tools.map((tool) => tool.name.replace(/^chatcockpit\./, "")).sort(),
      [
        "asyncJob.queue",
        "capabilities.inspect",
        "capabilities.list",
        "capabilities.mutation.execute",
        "capabilities.mutation.inspect",
        "capabilities.mutation.prepare",
        "capabilities.read.invoke",
        "devices.targets.list",
        "devices.runtime.lifecycle.execute",
        "devices.runtime.operation.get",
        "devices.runtime.status",
        "direct.executors.list",
        "document.appendVersion",
        "document.create",
        "document.get",
        "document.list",
        "document.updateStatus",
        "document.version.get",
        "evidence.record",
        "files.edit",
        "files.list",
        "files.read",
        "files.readBatch",
        "files.write",
        "git.commit",
        "git.diff",
        "git.status",
        "host.command.decide",
        "host.command.execute",
        "host.command.prepare",
        "host.files.read",
        "host.mutation.decide",
        "host.mutation.execute",
        "host.mutation.prepare",
        "host.process.decide",
        "host.process.execute",
        "host.process.list",
        "host.process.prepare",
        "host.process.read",
        "host.roots.list",
        "handoff.accept",
        "handoff.cancel",
        "handoff.fork",
        "handoff.prepare",
        "lease.acquire",
        "lease.release",
        "project.get",
        "project.list",
        "recovery.assess",
        "recovery.execute",
        "resources.inspect",
        "resources.inventory",
        "runtime.capabilities",
        "runtime.restart",
        "runtime.restart.read",
        "search.code",
        "codex.account.status",
        "codex.context.read",
        "codex.approval.respond",
        "codex.events.read",
        "codex.session.bind",
        "codex.session.fork",
        "codex.session.resume",
        "codex.thread.approvals.list",
        "codex.thread.events.read",
        "codex.thread.fork",
        "codex.thread.list",
        "codex.thread.read",
        "codex.thread.resume",
        "codex.thread.start",
        "codex.thread.turn.interrupt",
        "codex.thread.turn.start",
        "codex.turn.interrupt",
        "codex.turn.start",
        "continuity.capsule",
        "continuity.importedContext.read",
        "session.get",
        "session.start",
        "shell.run",
        "workspace.exec",
        "workspace.process.control",
        "workspace.process.read",
        "task.bindDocuments",
        "task.complete",
        "task.create",
        "task.get",
        "task.submitReview",
        "tools.discover",
        "tools.invoke",
        "trajectory.read",
        "workspace.snapshot"
      ].sort()
    );
    assert.equal(tools.length, 91, "Full compatibility surface must retain all 91 configured tools");

    const coreList = await postMcp(
      baseUrl,
      { jsonrpc: "2.0", id: "core-list", method: "tools/list", params: {} },
      { token: "test-token", path: "/mcp" }
    );
    assert.equal(coreList.response.status, 200);
    const coreTools = coreList.message.result?.tools as typeof tools;
    assert.equal(coreTools.length, 20);
    assert.equal(coreTools.every((tool) => isDefaultCoreMcpTool(tool.name)), true);
    assert.equal(coreTools.some((tool) => tool.name === "chatcockpit.tools.discover"), true);
    assert.equal(coreTools.some((tool) => tool.name === "chatcockpit.tools.invoke"), true);
    assert.equal(
      coreTools.every((tool) => Boolean(tool.outputSchema)),
      true,
      "Every canonical /mcp core tool must declare outputSchema"
    );
    assert.equal(coreTools.some((tool) => tool.name === "chatcockpit.codex.thread.turn.start"), false);

    const fullList = await postMcp(
      baseUrl,
      { jsonrpc: "2.0", id: "full-list", method: "tools/list", params: {} },
      { token: "test-token", path: "/mcp/full" }
    );
    assert.equal(fullList.response.status, 200);
    const fullTools = fullList.message.result?.tools as typeof tools;
    assert.deepEqual(
      fullTools.map((tool) => tool.name).sort(),
      tools.map((tool) => tool.name).sort()
    );

    const codexPackList = await postMcp(
      baseUrl,
      { jsonrpc: "2.0", id: "codex-pack-list", method: "tools/list", params: {} },
      { token: "test-token", path: "/mcp/packs/codex-native" }
    );
    assert.equal(codexPackList.response.status, 200);
    const codexPackTools = codexPackList.message.result?.tools as typeof tools;
    assert.equal(codexPackTools.length, 31);
    assert.equal(codexPackTools.some((tool) => tool.name === "chatcockpit.codex.thread.turn.start"), true);
    assert.equal(codexPackTools.some((tool) => tool.name === "chatcockpit.codex.turn.start"), false);

    const discover = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: "discover-codex",
        method: "tools/call",
        params: { name: "chatcockpit.tools.discover", arguments: { pack: "codex-native" } }
      },
      { token: "test-token", path: "/mcp" }
    );
    assert.equal(discover.response.status, 200);
    assert.equal(discover.message.error, undefined);
    const discoverResult = discover.message.result as {
      structuredContent: {
        ok: true;
        surface: {
          defaultCoreCount: number;
          fullToolCount: number;
          selectedPack: { id: string; endpointPath: string; toolSuffixes: string[] };
        };
      };
    };
    assert.equal(discoverResult.structuredContent.surface.defaultCoreCount, 20);
    assert.equal(discoverResult.structuredContent.surface.fullToolCount, 91);
    assert.equal(discoverResult.structuredContent.surface.selectedPack.id, "codex-native");
    assert.equal(discoverResult.structuredContent.surface.selectedPack.endpointPath, "/mcp/packs/codex-native");
    assert.equal(discoverResult.structuredContent.surface.selectedPack.toolSuffixes.length, 11);
    assert.equal(discoverResult.structuredContent.surface.selectedPack.toolSuffixes.includes("codex.context.read"), true);
    assert.equal(discoverResult.structuredContent.surface.selectedPack.toolSuffixes.includes("codex.thread.turn.start"), true);
    assert.equal(discoverResult.structuredContent.surface.selectedPack.toolSuffixes.includes("codex.turn.start"), false);

    const discoverEvidence = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: "discover-evidence-record",
        method: "tools/call",
        params: {
          name: "chatcockpit.tools.discover",
          arguments: { pack: "continuity-governance", tool: "evidence.record" }
        }
      },
      { token: "test-token", path: "/mcp" }
    );
    assert.equal(discoverEvidence.response.status, 200);
    assert.equal(discoverEvidence.message.error, undefined);
    const discoverEvidenceResult = discoverEvidence.message.result as {
      isError?: boolean;
      structuredContent: {
        surface: {
          selectedTool: {
            suffix: string;
            annotations: { readOnlyHint: boolean; destructiveHint: boolean };
            inputSchema: Record<string, unknown>;
            outputSchema: Record<string, unknown> | null;
          } | null;
        };
      };
    };
    assert.equal(discoverEvidenceResult.isError, undefined);
    assert.equal(discoverEvidenceResult.structuredContent.surface.selectedTool?.suffix, "evidence.record");
    assert.equal(discoverEvidenceResult.structuredContent.surface.selectedTool?.annotations.readOnlyHint, false);
    assert.equal(discoverEvidenceResult.structuredContent.surface.selectedTool?.annotations.destructiveHint, false);
    assert.match(
      JSON.stringify(discoverEvidenceResult.structuredContent.surface.selectedTool?.inputSchema),
      /expectedTaskRevision/
    );

    const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.deepEqual(
      tools.filter((tool) => classifyMcpToolSurface(tool.name) === null),
      [],
      "Every model-visible MCP tool must have an explicit surface classification"
    );
    assert.equal(
      tools.filter((tool) => isDefaultCoreMcpTool(tool.name)).length,
      20,
      "The default surface must classify exactly 20 core tools including governed workspace processes and deferred-tool invocation"
    );
    assert.equal(toolByName.has("chatcockpit.capabilities.mutation.decide"), false);
    for (const mutationToolName of [
      "chatcockpit.resources.mutation.prepare",
      "chatcockpit.resources.mutation.inspect",
      "chatcockpit.resources.mutation.execute",
      "chatcockpit.resources.mutation.decide",
      "chatcockpit.resources.mutation.reconcile"
    ]) {
      assert.equal(
        toolByName.has(mutationToolName),
        false,
        `Exposed MCP smoke without Resource mutation opt-in registered ${mutationToolName}`
      );
    }
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
      "chatcockpit.capabilities.inspect",
      "chatcockpit.capabilities.list",
      "chatcockpit.capabilities.mutation.inspect",
      "chatcockpit.capabilities.read.invoke",
      "chatcockpit.devices.targets.list",
      "chatcockpit.devices.runtime.operation.get",
      "chatcockpit.devices.runtime.status",
      "chatcockpit.direct.executors.list",
      "chatcockpit.document.get",
      "chatcockpit.document.list",
      "chatcockpit.document.version.get",
      "chatcockpit.files.list",
      "chatcockpit.files.read",
      "chatcockpit.files.readBatch",
      "chatcockpit.git.diff",
      "chatcockpit.git.status",
      "chatcockpit.host.files.read",
      "chatcockpit.host.process.list",
      "chatcockpit.host.process.read",
      "chatcockpit.host.roots.list",
      "chatcockpit.project.get",
      "chatcockpit.project.list",
      "chatcockpit.resources.inspect",
      "chatcockpit.runtime.capabilities",
      "chatcockpit.runtime.restart.read",
      "chatcockpit.search.code",
      "chatcockpit.codex.account.status",
      "chatcockpit.codex.events.read",
      "chatcockpit.codex.thread.approvals.list",
      "chatcockpit.codex.thread.events.read",
      "chatcockpit.codex.thread.list",
      "chatcockpit.codex.thread.read",
      "chatcockpit.continuity.capsule",
      "chatcockpit.continuity.importedContext.read",
      "chatcockpit.session.get",
      "chatcockpit.task.get",
      "chatcockpit.trajectory.read",
      "chatcockpit.workspace.snapshot",
      "chatcockpit.workspace.process.read"
    ]) {
      assert.equal(toolByName.get(name)?.annotations.readOnlyHint, true);
      assert.equal(toolByName.get(name)?.annotations.destructiveHint, false);
    }
    assert.equal(
      toolByName.get("chatcockpit.devices.runtime.lifecycle.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.devices.runtime.lifecycle.execute")?.annotations.destructiveHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.devices.runtime.lifecycle.execute")?.annotations.idempotentHint,
      true
    );
    assert.equal(toolByName.get("chatcockpit.runtime.restart")?.annotations.readOnlyHint, false);
    assert.equal(toolByName.get("chatcockpit.runtime.restart")?.annotations.destructiveHint, true);
    assert.equal(toolByName.get("chatcockpit.runtime.restart")?.annotations.idempotentHint, true);
    assert.equal(toolByName.get("chatcockpit.runtime.restart")?.annotations.openWorldHint, false);
    for (const name of ["chatcockpit.trajectory.read", "chatcockpit.continuity.capsule"]) {
      assert.ok(toolByName.get(name)?.outputSchema, `${name} must declare outputSchema`);
    }
    assert.equal(toolByName.get("chatcockpit.files.write")?.annotations.readOnlyHint, false);
    assert.equal(toolByName.get("chatcockpit.files.write")?.annotations.destructiveHint, true);
    assert.equal(toolByName.get("chatcockpit.files.edit")?.annotations.readOnlyHint, false);
    assert.equal(toolByName.get("chatcockpit.files.edit")?.annotations.destructiveHint, false);
    assert.equal(toolByName.get("chatcockpit.shell.run")?.annotations.destructiveHint, true);
    assert.equal(toolByName.get("chatcockpit.workspace.exec")?.annotations.readOnlyHint, false);
    assert.equal(toolByName.get("chatcockpit.workspace.exec")?.annotations.destructiveHint, true);
    assert.equal(toolByName.get("chatcockpit.workspace.exec")?.annotations.openWorldHint, true);
    assert.equal(toolByName.get("chatcockpit.workspace.process.control")?.annotations.readOnlyHint, false);
    assert.equal(toolByName.get("chatcockpit.workspace.process.control")?.annotations.destructiveHint, true);
    assert.equal(toolByName.get("chatcockpit.workspace.process.control")?.annotations.openWorldHint, true);
    assert.equal(
      toolByName.get("chatcockpit.host.command.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.host.command.execute")?.annotations.destructiveHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.host.mutation.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.host.mutation.execute")?.annotations.destructiveHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.host.process.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.host.process.execute")?.annotations.destructiveHint,
      true
    );
    for (const name of [
      "chatcockpit.host.command.prepare",
      "chatcockpit.host.command.decide",
      "chatcockpit.host.command.execute",
      "chatcockpit.host.mutation.prepare",
      "chatcockpit.host.mutation.decide",
      "chatcockpit.host.mutation.execute",
      "chatcockpit.host.process.prepare",
      "chatcockpit.host.process.decide",
      "chatcockpit.host.process.execute",
      "chatcockpit.host.process.read",
      "chatcockpit.host.process.list",
      "chatcockpit.recovery.assess",
      "chatcockpit.recovery.execute",
      "chatcockpit.resources.inspect",
      "chatcockpit.capabilities.inspect",
      "chatcockpit.capabilities.list",
      "chatcockpit.capabilities.mutation.inspect",
      "chatcockpit.capabilities.mutation.prepare"
    ]) {
      assert.equal(toolByName.get(name)?.annotations.idempotentHint, true);
      assert.equal(toolByName.get(name)?.annotations.openWorldHint, false);
    }
    assert.equal(
      toolByName.get("chatcockpit.capabilities.read.invoke")?.annotations.idempotentHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.capabilities.read.invoke")?.annotations.openWorldHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.capabilities.mutation.prepare")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.capabilities.mutation.prepare")?.annotations.destructiveHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.capabilities.mutation.execute")?.annotations.readOnlyHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.capabilities.mutation.execute")?.annotations.destructiveHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.capabilities.mutation.execute")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.capabilities.mutation.execute")?.annotations.openWorldHint,
      true
    );
    assert.equal(toolByName.get("chatcockpit.git.commit")?.annotations.destructiveHint, false);
    assert.equal(toolByName.get("chatcockpit.lease.acquire")?.annotations.destructiveHint, true);
    for (const name of [
      "chatcockpit.document.appendVersion",
      "chatcockpit.document.create",
      "chatcockpit.document.updateStatus",
      "chatcockpit.codex.session.bind",
      "chatcockpit.codex.session.fork",
      "chatcockpit.codex.session.resume",
      "chatcockpit.codex.turn.interrupt",
      "chatcockpit.asyncJob.queue",
      "chatcockpit.evidence.record",
      "chatcockpit.handoff.accept",
      "chatcockpit.handoff.cancel",
      "chatcockpit.handoff.fork",
      "chatcockpit.handoff.prepare",
      "chatcockpit.host.command.decide",
      "chatcockpit.host.command.prepare",
      "chatcockpit.host.mutation.decide",
      "chatcockpit.host.mutation.prepare",
      "chatcockpit.host.process.decide",
      "chatcockpit.host.process.prepare",
      "chatcockpit.lease.release",
      "chatcockpit.recovery.assess",
      "chatcockpit.recovery.execute",
      "chatcockpit.resources.inventory",
      "chatcockpit.session.start",
      "chatcockpit.task.bindDocuments",
      "chatcockpit.task.complete",
      "chatcockpit.task.create",
      "chatcockpit.task.submitReview"
    ]) {
      assert.equal(toolByName.get(name)?.annotations.readOnlyHint, false);
      assert.equal(toolByName.get(name)?.annotations.destructiveHint, false);
    }
    assert.equal(
      toolByName.get("chatcockpit.task.complete")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.task.complete")?.annotations.openWorldHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.task.submitReview")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.task.submitReview")?.annotations.openWorldHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.asyncJob.queue")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.asyncJob.queue")?.annotations.openWorldHint,
      false
    );
    assert.equal(
      toolByName.get("chatcockpit.resources.inventory")?.annotations.idempotentHint,
      true
    );
    assert.equal(
      toolByName.get("chatcockpit.resources.inventory")?.annotations.openWorldHint,
      true
    );
    for (const name of [
      "chatcockpit.codex.approval.respond",
      "chatcockpit.codex.turn.start"
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
          name: "chatcockpit.files.read",
          arguments: {
            repoId: "primary",
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
    assert.equal(readResult.structuredContent.execution.executor, "builtin-direct");

    const restReadResponse = await fetch(`${baseUrl}/api/files/read`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        repoId: "primary",
        path: "README.md"
      })
    });
    assert.equal(restReadResponse.status, 200);
    const restRead = (await restReadResponse.json()) as typeof readResult.structuredContent;
    assert.equal(restRead.file.content, readResult.structuredContent.file.content);
    assert.equal(restRead.execution.lane, "chat-direct");
    assert.equal(restRead.execution.modelLoopOwner, "chatgpt");
    assert.equal(restRead.execution.executor, "builtin-direct");

    const blocked = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "chatcockpit.files.read",
          arguments: {
            repoId: "primary",
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


    const coreReadCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [
      { name: "chatcockpit.project.list", arguments: {} },
      { name: "chatcockpit.project.get", arguments: { projectId: project.id } },
      { name: "chatcockpit.devices.targets.list", arguments: {} },
      { name: "chatcockpit.files.list", arguments: { repoId: "primary", path: "." } },
      {
        name: "chatcockpit.files.readBatch",
        arguments: { repoId: "primary", paths: ["README.md", "src/catalog-fixture.ts"] }
      },
      {
        name: "chatcockpit.search.code",
        arguments: { repoId: "primary", pattern: "mcpNeedle", path: "src" }
      },
      { name: "chatcockpit.git.status", arguments: { repoId: "primary" } },
      { name: "chatcockpit.git.diff", arguments: { repoId: "primary", staged: false } },
      {
        name: "chatcockpit.shell.run",
        arguments: {
          repoId: "primary",
          command: "git",
          args: ["status", "--short"],
          idempotencyKey: "core-read-shell-status-0001"
        }
      }
    ];
    for (const [index, coreCall] of coreReadCalls.entries()) {
      const result = await postMcp(
        baseUrl,
        {
          jsonrpc: "2.0",
          id: `core-read-${index}`,
          method: "tools/call",
          params: coreCall
        },
        { token: "test-token" }
      );
      assert.equal(result.response.status, 200);
      assert.equal(
        (result.message.result as { isError?: boolean }).isError,
        undefined,
        `${coreCall.name} must satisfy its declared outputSchema`
      );
    }

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

    const invokeEvidence = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: "invoke-evidence-record",
        method: "tools/call",
        params: {
          name: "chatcockpit.tools.invoke",
          arguments: {
            tool: "evidence.record",
            input: {
              taskId: taskResult.task.id,
              sessionId: sessionResult.session.id,
              kind: "test",
              label: "Deferred specialist gateway smoke",
              status: "passed",
              required: true,
              summary: "Recorded through compact-core tools.invoke without mounting a second MCP endpoint.",
              expectedTaskRevision: sessionResult.task.revision,
              idempotencyKey: "mcp-tools-invoke-evidence-0001"
            }
          }
        }
      },
      { token: "test-token", path: "/mcp" }
    );
    assert.equal(invokeEvidence.response.status, 200);
    const invokeEvidenceResult = invokeEvidence.message.result as {
      isError?: boolean;
      structuredContent: {
        ok: true;
        tool: string;
        result: {
          ok: true;
          bundle: { id: string };
          item: { id: string; status: string };
          replayed: boolean;
        };
      };
    };
    assert.equal(invokeEvidenceResult.isError, undefined);
    assert.equal(invokeEvidenceResult.structuredContent.tool, "evidence.record");
    assert.equal(invokeEvidenceResult.structuredContent.result.ok, true);
    assert.equal(invokeEvidenceResult.structuredContent.result.item.status, "passed");
    assert.equal(invokeEvidenceResult.structuredContent.result.replayed, false);
    assert.match(invokeEvidenceResult.structuredContent.result.bundle.id, /^evidence_/);

    const replayEvidence = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: "invoke-evidence-record-replay",
        method: "tools/call",
        params: {
          name: "chatcockpit.tools.invoke",
          arguments: {
            tool: "evidence.record",
            input: {
              taskId: taskResult.task.id,
              sessionId: sessionResult.session.id,
              kind: "test",
              label: "Deferred specialist gateway smoke",
              status: "passed",
              required: true,
              summary: "Recorded through compact-core tools.invoke without mounting a second MCP endpoint.",
              expectedTaskRevision: sessionResult.task.revision,
              idempotencyKey: "mcp-tools-invoke-evidence-0001"
            }
          }
        }
      },
      { token: "test-token", path: "/mcp" }
    );
    const replayEvidenceResult = replayEvidence.message.result as typeof invokeEvidenceResult;
    assert.equal(replayEvidenceResult.isError, undefined);
    assert.equal(replayEvidenceResult.structuredContent.result.replayed, true);
    assert.equal(
      replayEvidenceResult.structuredContent.result.bundle.id,
      invokeEvidenceResult.structuredContent.result.bundle.id
    );

    for (const blockedTool of ["project.list", "codex.turn.start"]) {
      const blockedInvoke = await postMcp(
        baseUrl,
        {
          jsonrpc: "2.0",
          id: `invoke-blocked-${blockedTool}`,
          method: "tools/call",
          params: {
            name: "chatcockpit.tools.invoke",
            arguments: { tool: blockedTool, input: {} }
          }
        },
        { token: "test-token", path: "/mcp" }
      );
      assert.equal(blockedInvoke.response.status, 200);
      const blockedInvokeResult = blockedInvoke.message.result as {
        isError: true;
        structuredContent: { error: { code: string } };
      };
      assert.equal(blockedInvokeResult.isError, true);
      assert.equal(blockedInvokeResult.structuredContent.error.code, "SPECIALIST_TOOL_NOT_FOUND");
    }

    for (const coreCall of [
      {
        name: "chatcockpit.trajectory.read",
        arguments: { activityId: sessionResult.session.id, limit: 10 }
      },
      {
        name: "chatcockpit.continuity.capsule",
        arguments: {
          workspaceId: workspace.id,
          taskId: taskResult.task.id,
          activityId: sessionResult.session.id,
          trajectoryLimit: 10
        }
      }
    ]) {
      const result = await postMcp(
        baseUrl,
        {
          jsonrpc: "2.0",
          id: `core-continuity-${coreCall.name}`,
          method: "tools/call",
          params: coreCall
        },
        { token: "test-token" }
      );
      assert.equal(
        (result.message.result as { isError?: boolean }).isError,
        undefined,
        `${coreCall.name} must satisfy its declared outputSchema`
      );
    }

    await restPost("/api/continuity/leases/acquire", {
      sessionId: sessionResult.session.id,
      holderId: "mcp-chat-direct-holder",
      expiresAt: "2099-01-01T00:00:00.000Z",
      idempotencyKey: "mcp-chat-direct-lease-0001"
    });
    const writeCoreResult = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: "core-write",
        method: "tools/call",
        params: {
          name: "chatcockpit.files.write",
          arguments: {
            repoId: "primary",
            sessionId: sessionResult.session.id,
            path: "src/core-output-contract.ts",
            content: "export const coreOutputContract = true;\n",
            idempotencyKey: "core-files-write-0001"
          }
        }
      },
      { token: "test-token" }
    );
    assert.equal(
      (writeCoreResult.message.result as { isError?: boolean }).isError,
      undefined,
      "chatcockpit.files.write must satisfy its declared outputSchema"
    );

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
          name: "chatcockpit.files.edit",
          arguments: {
            repoId: "primary",
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
          name: "chatcockpit.shell.run",
          arguments: {
            repoId: "primary",
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
        repoId: "primary",
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
        name: "chatcockpit.files.edit",
        arguments: {
          repoId: "primary",
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
    assert.equal(firstEditResult.structuredContent.execution.executor, "builtin-direct");
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
          name: "chatcockpit.files.edit",
          arguments: {
            repoId: "primary",
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

    fs.writeFileSync(
      path.join(repoRoot, "src", "catalog-fixture.ts"),
      "export const catalogFixture = 'unstaged-after-edit';\n",
      "utf8"
    );
    const stageReadme = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: "stage-readme-for-core-commit",
        method: "tools/call",
        params: {
          name: "chatcockpit.shell.run",
          arguments: {
            repoId: "primary",
            sessionId: sessionResult.session.id,
            command: "git",
            args: ["add", "README.md"],
            idempotencyKey: "stage-readme-core-commit-0001"
          }
        }
      },
      { token: "test-token" }
    );
    assert.equal((stageReadme.message.result as { isError?: boolean }).isError, undefined);

    const commitCoreResult = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: "core-git-commit",
        method: "tools/call",
        params: {
          name: "chatcockpit.git.commit",
          arguments: {
            repoId: "primary",
            sessionId: sessionResult.session.id,
            message: "verify core MCP output contracts",
            idempotencyKey: "core-git-commit-0001"
          }
        }
      },
      { token: "test-token" }
    );
    const commitCoreStructured = commitCoreResult.message.result as {
      isError?: boolean;
      structuredContent: {
        committed: boolean;
        changedPaths: string[];
      };
    };
    assert.equal(
      commitCoreStructured.isError,
      undefined,
      "chatcockpit.git.commit must satisfy its declared outputSchema"
    );
    assert.equal(commitCoreStructured.structuredContent.committed, true);
    assert.deepEqual(commitCoreStructured.structuredContent.changedPaths, ["README.md"]);
    assert.match(
      spawnSync("git", ["status", "--short"], { cwd: repoRoot, encoding: "utf8" }).stdout,
      /src\/catalog-fixture\.ts/
    );

    const blockedShell = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "chatcockpit.shell.run",
          arguments: {
            repoId: "primary",
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
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
    }
    if (originalToken === undefined) {
      delete process.env.CHATCOCKPIT_API_TOKEN;
    } else {
      process.env.CHATCOCKPIT_API_TOKEN = originalToken;
    }
    if (originalExposed === undefined) {
      delete process.env.CHATCOCKPIT_EXPOSED;
    } else {
      process.env.CHATCOCKPIT_EXPOSED = originalExposed;
    }
  }
}

await runMcpSmoke();
process.stdout.write("VERIFY_MCP_SMOKE_OK\n");
