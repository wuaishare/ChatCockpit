import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  createDownstreamMcpClient,
  downstreamMcpProtocolFamily
} from "../src/direct/downstream-mcp-client-factory.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpStreamableHttpExecutorConfig
} from "../src/direct/downstream-mcp-config.js";
import { probeDownstreamMcpExecutor } from "../src/direct/downstream-mcp-probe.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "streamable-http-fixture",
    version: "1.0.0"
  });
  server.registerTool(
    "read_file",
    {
      description: "Read a fixture through Streamable HTTP",
      inputSchema: z.object({ path: z.string() })
    },
    async ({ path: requestedPath }) => ({
      content: [{ type: "text", text: `http:${requestedPath}` }]
    })
  );
  return server;
}

const handler = createMcpHandler(() => buildMcpServer());
const nodeServer = http.createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }
    const webRequest = new Request(
      `http://127.0.0.1${request.url ?? "/mcp"}`,
      {
        method: request.method ?? "GET",
        headers,
        ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {})
      }
    );
    const webResponse = await handler.fetch(webRequest);
    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch (error) {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : "fixture failure");
  }
});

await new Promise<void>((resolve) => nodeServer.listen(0, "127.0.0.1", resolve));
const address = nodeServer.address();
assert.ok(address && typeof address === "object");
const endpoint = `http://127.0.0.1:${address.port}/mcp`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-streamable-http-"));

try {
  const configPath = path.join(root, "direct-executors.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        executors: [
          {
            id: "downstream-mcp:http-fixture",
            displayName: "HTTP Fixture",
            transport: {
              kind: "streamable-http",
              url: endpoint,
              timeoutMs: 2_000
            },
            mappings: [
              {
                capability: "files.read",
                toolName: "read_file",
                scopes: ["host"],
                access: ["read"]
              }
            ]
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const config = loadDownstreamMcpExecutorsConfig(configPath);
  assert.equal(config.executors.length, 1);
  const executor = config.executors[0];
  assert.ok(executor);
  assert.equal(executor.transport.kind, "streamable-http");
  assert.equal(downstreamMcpProtocolFamily(executor), "mcp-streamable-http");

  const client = createDownstreamMcpClient(executor);
  const listed = await client.listTools();
  assert.equal(listed.server.name, "streamable-http-fixture");
  assert.ok(listed.tools.some((tool) => tool.name === "read_file"));
  const result = await client.callTool("read_file", { path: "fixture.txt" });
  assert.match(JSON.stringify(result), /http:fixture\.txt/);
  await client.close();

  const store = new DownstreamMcpCapabilityStore(path.join(root, "runtime"));
  const snapshot = await probeDownstreamMcpExecutor({
    client: createDownstreamMcpClient(executor),
    store,
    config: {
      executorId: executor.id,
      displayName: executor.displayName,
      protocolFamily: downstreamMcpProtocolFamily(executor),
      mappings: executor.mappings
    },
    now: "2026-08-19T00:00:00.000Z"
  });
  assert.equal(snapshot.protocolFamily, "mcp-streamable-http");
  assert.equal(snapshot.health, "ready");
  assert.equal(snapshot.toolCatalog[0]?.name, "read_file");
  assert.equal(snapshot.toolCatalog[0]?.metadataStatus, "ready");

  for (const invalidUrl of [
    "http://example.com/mcp",
    "ftp://127.0.0.1/mcp",
    "https://user:secret@example.com/mcp",
    "https://example.com/mcp#fragment"
  ]) {
    const invalidPath = path.join(
      root,
      `invalid-${Buffer.from(invalidUrl).toString("hex").slice(0, 12)}.json`
    );
    fs.writeFileSync(
      invalidPath,
      `${JSON.stringify({
        schemaVersion: 1,
        executors: [
          {
            id: "downstream-mcp:invalid-http",
            displayName: "Invalid HTTP",
            transport: { kind: "streamable-http", url: invalidUrl },
            mappings: [
              {
                capability: "files.read",
                toolName: "read_file",
                scopes: ["host"],
                access: ["read"]
              }
            ]
          }
        ]
      })}\n`,
      "utf8"
    );
    assert.throws(
      () => loadDownstreamMcpExecutorsConfig(invalidPath),
      /failed validation/
    );
  }

  const httpsConfigPath = path.join(root, "https-config.json");
  fs.writeFileSync(
    httpsConfigPath,
    `${JSON.stringify({
      schemaVersion: 1,
      executors: [
        {
          id: "downstream-mcp:https-allowed",
          displayName: "HTTPS Allowed",
          transport: {
            kind: "streamable-http",
            url: "https://mcp.example.invalid/mcp"
          },
          mappings: [
            {
              capability: "files.read",
              toolName: "read_file",
              scopes: ["host"],
              access: ["read"]
            }
          ]
        }
      ]
    })}\n`,
    "utf8"
  );
  const httpsExecutor = loadDownstreamMcpExecutorsConfig(
    httpsConfigPath
  ).executors[0] as DownstreamMcpStreamableHttpExecutorConfig;
  assert.equal(httpsExecutor.transport.kind, "streamable-http");
  assert.equal(httpsExecutor.transport.timeoutMs, 10_000);
} finally {
  await new Promise<void>((resolve, reject) =>
    nodeServer.close((error) => (error ? reject(error) : resolve()))
  );
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_DOWNSTREAM_MCP_STREAMABLE_HTTP_OK\n");
