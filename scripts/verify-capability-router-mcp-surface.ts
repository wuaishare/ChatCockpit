import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CapabilityRouterCatalogService } from "../src/application/capability-router-catalog-service.js";
import { CapabilityRouterReadInvocationService } from "../src/application/capability-router-read-invocation-service.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";
import type {
  DownstreamMcpCapabilitySnapshot,
  DownstreamMcpClient,
} from "../src/direct/downstream-mcp-types.js";
import { buildCapabilityRouterMcpTools } from "../src/mcp/tools/capability-router.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-router-mcp-"));
const runtimeDir = path.join(root, "runtime");
const configPath = path.join(root, "direct-executors.json");
const executorId = "downstream-mcp:router-mcp-fixture";
const privateEndpoint = "https://private-router-surface.example.invalid/mcp";

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      executors: [
        {
          id: executorId,
          displayName: "Router MCP Fixture",
          transport: {
            kind: "streamable-http",
            url: privateEndpoint,
            timeoutMs: 1000,
          },
          mappings: [
            {
              capability: "files.read",
              toolName: "read_file",
              scopes: ["host"],
              access: ["read"],
            },
          ],
          router: {
            enabled: true,
            tools: [
              { toolName: "read_file", mode: "read" },
              { toolName: "write_file", mode: "mutation" },
            ],
          },
        },
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const snapshot: DownstreamMcpCapabilitySnapshot = {
  schemaVersion: 1,
  executorId,
  displayName: "Router MCP Fixture",
  protocolFamily: "mcp-streamable-http",
  protocolVersion: "2025-03-26",
  serverName: "router-mcp-server",
  serverVersion: "1.0.0",
  probedAt: "2026-08-19T00:00:00.000Z",
  health: "ready",
  toolsObserved: ["read_file", "write_file"],
  toolCatalog: [
    {
      name: "read_file",
      description: "Read one provider-native fixture",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      outputSchema: null,
      annotations: { readOnlyHint: true, destructiveHint: false },
      metadataStatus: "ready",
    },
    {
      name: "write_file",
      description: "Write one provider-native fixture",
      inputSchema: { type: "object" },
      outputSchema: null,
      annotations: { destructiveHint: true },
      metadataStatus: "ready",
    },
  ],
  mappings: [
    {
      capability: "files.read",
      toolName: "read_file",
      scopes: ["host"],
      access: ["read"],
      status: "verified",
      errorCode: null,
    },
  ],
};
new DownstreamMcpCapabilityStore(runtimeDir).write(snapshot);

let calls = 0;
const client: DownstreamMcpClient = {
  async initialize() {
    return {
      name: "router-mcp-server",
      version: "1.0.0",
      protocolVersion: "2025-03-26",
    };
  },
  async listTools() {
    return {
      server: await this.initialize(),
      tools: [
        {
          name: "read_file",
          description: "Read one provider-native fixture",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
        {
          name: "write_file",
          description: "Write one provider-native fixture",
          inputSchema: { type: "object" },
          annotations: { destructiveHint: true },
        },
      ],
    };
  },
  async callTool(name, args) {
    calls += 1;
    assert.equal(name, "read_file");
    assert.deepEqual(args, { path: "fixture.txt" });
    return {
      content: [
        { type: "text", text: "fixture text" },
        { type: "image", data: "private-image", mimeType: "image/png" },
      ],
      structuredContent: { count: 1 },
      isError: false,
    };
  },
  async close() {},
};

const context = buildOperationContext({
  actorType: "remote-mcp",
  actorId: "fixture-client",
  requestId: "router-surface-fixture",
  publicProjection: true,
  now: "2026-08-19T00:00:00.000Z",
});

try {
  const catalog = new CapabilityRouterCatalogService(runtimeDir, configPath);
  const reads = new CapabilityRouterReadInvocationService(
    runtimeDir,
    configPath,
    () => client,
  );
  const tools = buildCapabilityRouterMcpTools({ catalog, reads });
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "chatcockpit.capabilities.inspect",
    "chatcockpit.capabilities.list",
    "chatcockpit.capabilities.mutation.execute",
    "chatcockpit.capabilities.mutation.inspect",
    "chatcockpit.capabilities.mutation.prepare",
    "chatcockpit.capabilities.read.invoke",
  ]);
  assert.equal(
    tools.some((tool) => tool.name.includes("mutation.decide")),
    false,
  );
  assert.equal(
    tools.some((tool) => tool.name === "read_file"),
    false,
  );
  assert.equal(
    tools.some((tool) => tool.name === "write_file"),
    false,
  );

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(byName.get("chatcockpit.capabilities.list")?.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(
    byName.get("chatcockpit.capabilities.read.invoke")?.annotations,
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  );

  const list = await byName
    .get("chatcockpit.capabilities.list")!
    .execute(context, {});
  assert.equal(list.isError, undefined);
  const listText = JSON.stringify(list.structuredContent);
  assert.equal(listText.includes("read_file"), true);
  assert.equal(listText.includes("write_file"), true);
  assert.equal(listText.includes(privateEndpoint), false);
  assert.equal(listText.includes('"inputSchema"'), false);

  const inspect = await byName
    .get("chatcockpit.capabilities.inspect")!
    .execute(context, {
      executorId,
      toolName: "read_file",
    });
  assert.equal(inspect.isError, undefined);
  const inspection = inspect.structuredContent as {
    inputSchema?: Record<string, unknown>;
  };
  assert.equal(inspection.inputSchema?.type, "object");
  assert.equal(JSON.stringify(inspection).includes(privateEndpoint), false);

  const invoked = await byName
    .get("chatcockpit.capabilities.read.invoke")!
    .execute(context, {
      executorId,
      toolName: "read_file",
      arguments: { path: "fixture.txt" },
    });
  assert.equal(invoked.isError, undefined);
  assert.equal(calls, 1);
  assert.equal(
    (invoked.structuredContent as { text?: string }).text,
    "fixture text",
  );
  assert.equal(JSON.stringify(invoked).includes("private-image"), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CAPABILITY_ROUTER_MCP_SURFACE_OK\n");
