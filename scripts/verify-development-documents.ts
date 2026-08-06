import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildServer } from "../src/server/app.ts";

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

async function verifyDevelopmentDocuments(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-documents-"));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Document fixture\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "tokenpilot.openapi.yaml"),
    path.join(repoRoot, "openapi", "tokenpilot.openapi.yaml")
  );

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "documents-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaceAllowlist: [repoRoot],
        repoMappings: { tokenpilot: { path: repoRoot } }
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
  let listening = false;
  let rpcId = 1;

  try {
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    listening = true;

    const rest = async <T>(
      method: "GET" | "POST",
      route: string,
      body?: unknown
    ): Promise<T> => {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          authorization: "Bearer test-token",
          ...(body ? { "content-type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const text = await response.text();
      assert.equal(response.status, 200, `${method} ${route}: ${text}`);
      return JSON.parse(text) as T;
    };

    const mcp = async <T>(toolName: string, args: unknown): Promise<T> => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: rpcId++,
          method: "tools/call",
          params: { name: toolName, arguments: args }
        })
      });
      assert.equal(response.status, 200);
      const message = parseMcpResponse(await response.text());
      assert.equal(message.error, undefined, JSON.stringify(message.error));
      const content = message.result?.content as Array<{ text?: string }>;
      return JSON.parse(content[0]?.text ?? "{}") as T;
    };

    const projects = await rest<{
      projects: Array<{
        project: { id: string };
        workspaces: Array<{ id: string }>;
      }>;
    }>("GET", "/api/continuity/projects?status=active");
    const projectId = projects.projects[0]?.project.id;
    const workspaceId = projects.projects[0]?.workspaces[0]?.id;
    assert.ok(projectId);
    assert.ok(workspaceId);

    const privatePathFixture = ["", "Users", "private", "workspace"].join("/");
    const secretFixture = ["fixture", "secret", "value"].join("-");
    const specInput = {
      projectId,
      workspaceId,
      kind: "spec" as const,
      title: "Durable continuity requirements",
      contentMarkdown:
        `# Requirements\n\nInspect ${privatePathFixture} and never print API_KEY=${secretFixture}.\n`,
      changeSummary: "Initial requirements",
      idempotencyKey: "document-create-spec-0001"
    };
    const restSpec = await rest<{
      document: { id: string; kind: string; status: string; currentVersion: number; revision: number };
      currentContent: { contentMarkdown: string; contentHash: string; version: number };
      versions: Array<{ version: number; contentHash: string }>;
      replayed: boolean;
    }>("POST", "/api/continuity/documents", specInput);
    const mcpSpec = await mcp<typeof restSpec>(
      "tokenpilot.document.create",
      specInput
    );
    assert.equal(restSpec.replayed, false);
    assert.equal(mcpSpec.replayed, true);
    assert.equal(mcpSpec.document.id, restSpec.document.id);
    assert.equal(restSpec.document.kind, "spec");
    assert.equal(restSpec.document.currentVersion, 1);
    assert.match(restSpec.currentContent.contentHash, /^[a-f0-9]{64}$/);
    assert.match(restSpec.currentContent.contentMarkdown, /<private-path>/);
    assert.match(restSpec.currentContent.contentMarkdown, /API_KEY=<redacted>/);
    assert.equal(JSON.stringify(restSpec).includes(secretFixture), false);
    assert.equal(JSON.stringify(restSpec).includes(privatePathFixture), false);

    const createConflict = await fetch(`${baseUrl}/api/continuity/documents`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ ...specInput, title: "Different title" })
    });
    assert.equal(createConflict.status, 409);
    const createConflictBody = (await createConflict.json()) as {
      error: { code: string };
    };
    assert.equal(createConflictBody.error.code, "IDEMPOTENCY_CONFLICT");

    const planInput = {
      projectId,
      workspaceId,
      kind: "plan" as const,
      title: "Durable continuity implementation",
      contentMarkdown: "# Plan\n\n1. Persist documents.\n2. Bind task versions.\n",
      changeSummary: "Initial plan",
      idempotencyKey: "document-create-plan-0001"
    };
    const restPlan = await rest<typeof restSpec>(
      "POST",
      "/api/continuity/documents",
      planInput
    );
    assert.equal(restPlan.document.kind, "plan");

    async function transition(
      document: typeof restSpec,
      status: "ready" | "approved",
      key: string
    ): Promise<typeof restSpec> {
      const input = {
        documentId: document.document.id,
        status,
        expectedRevision: document.document.revision,
        idempotencyKey: key
      };
      const first = await rest<typeof restSpec>(
        "POST",
        "/api/continuity/documents/update-status",
        input
      );
      const replay = await mcp<typeof restSpec>(
        "tokenpilot.document.updateStatus",
        input
      );
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.document.revision, first.document.revision);
      return first;
    }

    const readySpec = await transition(restSpec, "ready", "document-ready-spec-0001");
    const approvedSpec = await transition(
      readySpec,
      "approved",
      "document-approved-spec-0001"
    );
    const readyPlan = await transition(restPlan, "ready", "document-ready-plan-0001");
    const approvedPlan = await transition(
      readyPlan,
      "approved",
      "document-approved-plan-0001"
    );

    const task = await rest<{
      task: { id: string; revision: number; specId: string | null; specVersion: number | null };
    }>("POST", "/api/continuity/tasks", {
      projectId,
      workspaceId,
      title: "Implement durable document workflow",
      goal: "Use explicit Spec and Plan version pins",
      priority: "high",
      idempotencyKey: "document-task-create-0001"
    });
    const bindInput = {
      taskId: task.task.id,
      specId: approvedSpec.document.id,
      planId: approvedPlan.document.id,
      expectedTaskRevision: task.task.revision,
      idempotencyKey: "document-task-bind-0001"
    };
    const restBinding = await rest<{
      task: {
        id: string;
        revision: number;
        specId: string;
        specVersion: number;
        planId: string;
        planVersion: number;
      };
      replayed: boolean;
    }>("POST", "/api/continuity/tasks/bind-documents", bindInput);
    const mcpBinding = await mcp<typeof restBinding>(
      "tokenpilot.task.bindDocuments",
      bindInput
    );
    assert.equal(restBinding.replayed, false);
    assert.equal(mcpBinding.replayed, true);
    assert.equal(restBinding.task.specVersion, 1);
    assert.equal(restBinding.task.planVersion, 1);

    const relationConflict = await fetch(
      `${baseUrl}/api/continuity/tasks/bind-documents`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          taskId: task.task.id,
          specId: approvedPlan.document.id,
          planId: approvedPlan.document.id,
          expectedTaskRevision: restBinding.task.revision,
          idempotencyKey: "document-task-bind-invalid-0001"
        })
      }
    );
    assert.equal(relationConflict.status, 400);
    const relationConflictBody = (await relationConflict.json()) as {
      error: { code: string };
    };
    assert.equal(
      relationConflictBody.error.code,
      "CONTINUITY_DOCUMENT_RELATION_INVALID"
    );

    const appendInput = {
      documentId: approvedSpec.document.id,
      contentMarkdown:
        "# Requirements v2\n\nPreserve document history and task version pins.\n",
      changeSummary: "Add stale-binding requirement",
      expectedRevision: approvedSpec.document.revision,
      idempotencyKey: "document-append-spec-0001"
    };
    const appended = await rest<typeof restSpec>(
      "POST",
      "/api/continuity/documents/append-version",
      appendInput
    );
    const appendedReplay = await mcp<typeof restSpec>(
      "tokenpilot.document.appendVersion",
      appendInput
    );
    assert.equal(appended.document.currentVersion, 2);
    assert.equal(appended.document.status, "draft");
    assert.equal(appendedReplay.replayed, true);

    const taskAfterAppend = await rest<{
      task: { specId: string; specVersion: number; planVersion: number };
    }>("GET", `/api/continuity/tasks/${encodeURIComponent(task.task.id)}`);
    assert.equal(taskAfterAppend.task.specId, approvedSpec.document.id);
    assert.equal(taskAfterAppend.task.specVersion, 1);
    assert.equal(taskAfterAppend.task.planVersion, 1);

    const list = await rest<{
      documents: Array<{
        document: { id: string; kind: string; currentVersion: number };
        currentVersion: { contentHash: string };
        currentContent?: unknown;
      }>;
    }>(
      "GET",
      `/api/continuity/documents?workspaceId=${encodeURIComponent(workspaceId)}`
    );
    assert.equal(list.documents.length, 2);
    assert.ok(list.documents.every((document) => !("currentContent" in document)));

    const oldVersion = await mcp<{
      version: { version: number; contentMarkdown: string; contentHash: string };
    }>("tokenpilot.document.version.get", {
      documentId: approvedSpec.document.id,
      version: 1
    });
    assert.equal(oldVersion.version.version, 1);
    assert.match(oldVersion.version.contentMarkdown, /<private-path>/);
    assert.match(oldVersion.version.contentMarkdown, /API_KEY=<redacted>/);

    const openapiResponse = await fetch(`${baseUrl}/openapi.yaml`, {
      headers: { authorization: "Bearer test-token" }
    });
    assert.equal(openapiResponse.status, 200);
    const openapi = await openapiResponse.text();
    for (const operationId of [
      "listDevelopmentDocuments",
      "createDevelopmentDocument",
      "getDevelopmentDocument",
      "getDevelopmentDocumentVersion",
      "appendDevelopmentDocumentVersion",
      "updateDevelopmentDocumentStatus",
      "bindTaskDevelopmentDocuments"
    ]) {
      assert.match(String(openapi), new RegExp(`operationId: ${operationId}`));
    }
  } finally {
    if (listening) await app.close();
    if (originalConfigPath === undefined) delete process.env.TOKENPILOT_CONFIG_PATH;
    else process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    if (originalToken === undefined) delete process.env.TOKENPILOT_API_TOKEN;
    else process.env.TOKENPILOT_API_TOKEN = originalToken;
    if (originalExposed === undefined) delete process.env.TOKENPILOT_EXPOSED;
    else process.env.TOKENPILOT_EXPOSED = originalExposed;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

await verifyDevelopmentDocuments();
process.stdout.write("VERIFY_DEVELOPMENT_DOCUMENTS_OK\n");
