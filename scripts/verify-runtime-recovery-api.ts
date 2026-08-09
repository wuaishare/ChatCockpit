import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildServer } from "../src/server/app.ts";
import { listenTestServer } from "./test-support/server.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length ? dataLines.join("\n") : body) as JsonRpcResponse;
}

async function run(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-recovery-api-"));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Runtime Recovery API fixture\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "tokenpilot.openapi.yaml"),
    path.join(repoRoot, "openapi", "tokenpilot.openapi.yaml")
  );

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "recovery-api-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspaceAllowlist: [repoRoot],
        repoMappings: { tokenpilot: { path: repoRoot } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const previous = {
    config: process.env.TOKENPILOT_CONFIG_PATH,
    token: process.env.TOKENPILOT_API_TOKEN,
    exposed: process.env.TOKENPILOT_EXPOSED
  };
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  process.env.TOKENPILOT_API_TOKEN = "test-token";
  process.env.TOKENPILOT_EXPOSED = "true";

  const app = buildServer(paths);
  let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;
  let rpcId = 1;

  try {
    server = await listenTestServer(app);
    const baseUrl = server.baseUrl;
    const rest = async <T>(
      method: "GET" | "POST",
      route: string,
      body?: unknown
    ): Promise<T> => {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          authorization: "Bearer test-token",
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const payload = (await response.json()) as T & {
        error?: { code: string; message: string };
      };
      assert.equal(
        response.ok,
        true,
        `${method} ${route} failed: ${JSON.stringify(payload)}`
      );
      return payload;
    };
    const mcp = async <T>(name: string, args: unknown): Promise<T> => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: rpcId++,
          method: "tools/call",
          params: { name, arguments: args }
        })
      });
      assert.equal(response.status, 200);
      const message = parseMcpResponse(await response.text());
      assert.equal(message.error, undefined, JSON.stringify(message.error));
      const result = message.result as {
        isError?: boolean;
        structuredContent: T & { error?: { code: string; message: string } };
      };
      assert.equal(
        result.isError,
        undefined,
        `MCP ${name} failed: ${JSON.stringify(result.structuredContent)}`
      );
      return result.structuredContent;
    };

    const projects = await rest<{
      projects: Array<{
        project: { id: string };
        workspaces: Array<{ id: string }>;
      }>;
    }>("GET", "/api/continuity/projects");
    const project = projects.projects[0]!.project;
    const workspace = projects.projects[0]!.workspaces[0]!;

    const createdTask = await rest<{
      task: { id: string; revision: number };
    }>("POST", "/api/continuity/tasks", {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Runtime Recovery API",
      goal: "Prove Recovery REST/MCP production composition",
      priority: "normal",
      idempotencyKey: "recovery-api-task-0001"
    });
    const startedSession = await rest<{
      session: { id: string; revision: number };
      task: { id: string; revision: number };
    }>("POST", "/api/continuity/sessions/start", {
      taskId: createdTask.task.id,
      title: "Runtime Recovery Chat Direct",
      mode: "chat-direct",
      expectedTaskRevision: createdTask.task.revision,
      idempotencyKey: "recovery-api-session-0001"
    });

    const restAssessment = await rest<{
      ok: true;
      attempt: { id: string; revision: number; status: string };
      assessment: {
        classification: string;
        assessmentHash: string;
        availableActions: string[];
      };
      replayed: boolean;
    }>("POST", "/api/recovery/assess", {
      workspaceId: workspace.id,
      taskId: startedSession.task.id,
      sessionId: startedSession.session.id,
      providerKind: "chat-direct",
      idempotencyKey: "recovery-api-assess-rest-0001"
    });
    assert.equal(restAssessment.replayed, false);
    assert.equal(restAssessment.attempt.status, "prepared");
    assert.equal(restAssessment.assessment.classification, "healthy");
    assert.deepEqual(restAssessment.assessment.availableActions, ["continue-chat-direct"]);

    const restExecution = await rest<{
      ok: true;
      attempt: { id: string; status: string; selectedAction: string };
      action: string;
      replayed: boolean;
    }>("POST", "/api/recovery/execute", {
      recoveryId: restAssessment.attempt.id,
      assessmentHash: restAssessment.assessment.assessmentHash,
      expectedRecoveryRevision: restAssessment.attempt.revision,
      action: "continue-chat-direct",
      idempotencyKey: "recovery-api-execute-rest-0001"
    });
    assert.equal(restExecution.attempt.status, "applied");
    assert.equal(restExecution.attempt.selectedAction, "continue-chat-direct");
    assert.equal(restExecution.action, "continue-chat-direct");

    const readAttempt = await rest<{
      attempt: { id: string; status: string };
    }>("GET", `/api/recovery/attempts/${restAssessment.attempt.id}`);
    assert.equal(readAttempt.attempt.status, "applied");
    const listed = await rest<{
      attempts: Array<{ id: string }>;
    }>("GET", `/api/recovery/attempts?taskId=${startedSession.task.id}`);
    assert.equal(
      listed.attempts.some((attempt) => attempt.id === restAssessment.attempt.id),
      true
    );

    const mcpAssessment = await mcp<typeof restAssessment>(
      "tokenpilot.recovery.assess",
      {
        workspaceId: workspace.id,
        taskId: startedSession.task.id,
        sessionId: startedSession.session.id,
        providerKind: "chat-direct",
        idempotencyKey: "recovery-api-assess-mcp-0001"
      }
    );
    assert.equal(mcpAssessment.assessment.classification, "healthy");
    const mcpExecution = await mcp<typeof restExecution>(
      "tokenpilot.recovery.execute",
      {
        recoveryId: mcpAssessment.attempt.id,
        assessmentHash: mcpAssessment.assessment.assessmentHash,
        expectedRecoveryRevision: mcpAssessment.attempt.revision,
        action: "continue-chat-direct",
        idempotencyKey: "recovery-api-execute-mcp-0001"
      }
    );
    assert.equal(mcpExecution.attempt.status, "applied");
    assert.equal(mcpExecution.action, "continue-chat-direct");

    const serialized = JSON.stringify({ restAssessment, restExecution, mcpAssessment, mcpExecution });
    assert.equal(serialized.includes(repoRoot), false);
    assert.equal(serialized.includes("test-token"), false);

    process.stdout.write("VERIFY_RUNTIME_RECOVERY_API_OK\n");
  } finally {
    if (server) await server.close();
    await app.close().catch(() => undefined);
    if (previous.config === undefined) delete process.env.TOKENPILOT_CONFIG_PATH;
    else process.env.TOKENPILOT_CONFIG_PATH = previous.config;
    if (previous.token === undefined) delete process.env.TOKENPILOT_API_TOKEN;
    else process.env.TOKENPILOT_API_TOKEN = previous.token;
    if (previous.exposed === undefined) delete process.env.TOKENPILOT_EXPOSED;
    else process.env.TOKENPILOT_EXPOSED = previous.exposed;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

await run();
