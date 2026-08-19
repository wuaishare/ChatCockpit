import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CapabilityRouterReadInvocationService } from "../src/application/capability-router-read-invocation-service.js";
import { projectCapabilityRouterReadResult } from "../src/application/capability-router-result-projection.js";
import { ServiceError } from "../src/application/service-error.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";
import type {
  DownstreamMcpCapabilitySnapshot,
  DownstreamMcpClient
} from "../src/direct/downstream-mcp-types.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-router-read-"));
const runtimeDir = path.join(root, "runtime");
const configPath = path.join(root, "direct-executors.json");
const executorId = "downstream-mcp:router-read-fixture";

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      executors: [
        {
          id: executorId,
          displayName: "Router Read Fixture",
          transport: {
            kind: "streamable-http",
            url: "https://private-router-provider.example.invalid/mcp",
            timeoutMs: 1000
          },
          mappings: [
            {
              capability: "files.read",
              toolName: "read_file",
              scopes: ["host"],
              access: ["read"]
            }
          ],
          router: {
            enabled: true,
            tools: [
              { toolName: "read_file", mode: "read" },
              { toolName: "write_file", mode: "mutation" },
              { toolName: "unsafe_read", mode: "read" },
              { toolName: "metadata_limited", mode: "read" }
            ]
          }
        }
      ]
    },
    null,
    2
  )}\n`,
  "utf8"
);

const snapshot: DownstreamMcpCapabilitySnapshot = {
  schemaVersion: 1,
  executorId,
  displayName: "Router Read Fixture",
  protocolFamily: "mcp-streamable-http",
  protocolVersion: "2025-03-26",
  serverName: "router-read-server",
  serverVersion: "1.0.0",
  probedAt: "2026-08-19T00:00:00.000Z",
  health: "ready",
  toolsObserved: ["metadata_limited", "read_file", "unsafe_read", "write_file"],
  toolCatalog: [
    {
      name: "read_file",
      description: "Read a fixture",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false
      },
      outputSchema: null,
      annotations: { readOnlyHint: true, destructiveHint: false },
      metadataStatus: "ready"
    },
    {
      name: "write_file",
      description: "Write a fixture",
      inputSchema: { type: "object" },
      outputSchema: null,
      annotations: { destructiveHint: true },
      metadataStatus: "ready"
    },
    {
      name: "unsafe_read",
      description: "Misclassified unsafe tool",
      inputSchema: { type: "object" },
      outputSchema: null,
      annotations: { destructiveHint: true },
      metadataStatus: "ready"
    },
    {
      name: "metadata_limited",
      description: "Schema was too large during probe",
      inputSchema: null,
      outputSchema: null,
      annotations: null,
      metadataStatus: "bounded"
    }
  ],
  mappings: [
    {
      capability: "files.read",
      toolName: "read_file",
      scopes: ["host"],
      access: ["read"],
      status: "verified",
      errorCode: null
    }
  ]
};
new DownstreamMcpCapabilityStore(runtimeDir).write(snapshot);

let calls = 0;
let closes = 0;
let lastArguments: Record<string, unknown> | null = null;
const client: DownstreamMcpClient = {
  async initialize() {
    return {
      name: "router-read-server",
      version: "1.0.0",
      protocolVersion: "2025-03-26"
    };
  },
  async listTools() {
    return {
      server: await this.initialize(),
      tools: [
        {
          name: "read_file",
          description: "Read a fixture",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false
          },
          annotations: { readOnlyHint: true, destructiveHint: false }
        }
      ]
    };
  },
  async callTool(name, args) {
    calls += 1;
    lastArguments = structuredClone(args);
    assert.equal(name, "read_file");
    return {
      content: [
        { type: "text", text: "fixture text" },
        { type: "image", data: "must-not-be-forwarded", mimeType: "image/png" }
      ],
      structuredContent: { count: 1, privateTransport: "must-not-leak-url" },
      isError: false
    };
  },
  async close() {
    closes += 1;
  }
};

function assertServiceCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, code);
  return true;
}

try {
  const service = new CapabilityRouterReadInvocationService(
    runtimeDir,
    configPath,
    () => client
  );

  await assert.rejects(
    service.invoke({
      executorId,
      toolName: "read_file",
      arguments: { path: 42 }
    }),
    (error) => assertServiceCode(error, "CAPABILITY_ROUTER_ARGUMENTS_INVALID")
  );
  assert.equal(calls, 0);

  await assert.rejects(
    service.invoke({ executorId, toolName: "write_file", arguments: {} }),
    (error) =>
      assertServiceCode(error, "CAPABILITY_ROUTER_MUTATION_REQUIRES_APPROVAL")
  );
  assert.equal(calls, 0);

  await assert.rejects(
    service.invoke({ executorId, toolName: "unsafe_read", arguments: {} }),
    (error) => assertServiceCode(error, "CAPABILITY_ROUTER_TOOL_SAFETY_CONFLICT")
  );
  assert.equal(calls, 0);

  await assert.rejects(
    service.invoke({ executorId, toolName: "metadata_limited", arguments: {} }),
    (error) => assertServiceCode(error, "CAPABILITY_ROUTER_TOOL_NOT_READY")
  );
  assert.equal(calls, 0);

  const result = await service.invoke({
    executorId,
    toolName: "read_file",
    arguments: { path: "fixture.txt" }
  });
  assert.equal(calls, 1);
  assert.equal(closes, 1);
  assert.deepEqual(lastArguments, { path: "fixture.txt" });
  assert.equal(result.executorId, executorId);
  assert.equal(result.providerDisplayName, "Router Read Fixture");
  assert.equal(result.protocolFamily, "mcp-streamable-http");
  assert.equal(result.toolName, "read_file");
  assert.equal(result.isError, false);
  assert.equal(result.text, "fixture text");
  assert.deepEqual(result.structuredContent, {
    count: 1,
    privateTransport: "must-not-leak-url"
  });
  assert.equal(result.omittedContentBlocks, 1);
  assert.equal(result.truncated, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private-router-provider.example.invalid"), false);
  assert.equal(serialized.includes("must-not-be-forwarded"), false);

  let failedCloses = 0;
  const failingService = new CapabilityRouterReadInvocationService(
    runtimeDir,
    configPath,
    () => ({
      ...client,
      async callTool() {
        throw new Error("raw provider failure must stay private");
      },
      async close() {
        failedCloses += 1;
      }
    })
  );
  await assert.rejects(
    failingService.invoke({
      executorId,
      toolName: "read_file",
      arguments: { path: "fixture.txt" }
    }),
    (error) => {
      assertServiceCode(error, "CAPABILITY_ROUTER_PROVIDER_CALL_FAILED");
      assert.equal(
        error instanceof Error && error.message.includes("raw provider failure"),
        false
      );
      return true;
    }
  );
  assert.equal(failedCloses, 1);

  let driftCalls = 0;
  let driftCloses = 0;
  const driftService = new CapabilityRouterReadInvocationService(
    runtimeDir,
    configPath,
    () => ({
      ...client,
      async listTools() {
        return {
          server: await this.initialize(),
          tools: [
            {
              name: "read_file",
              inputSchema: {
                type: "object",
                properties: { path: { type: "number" } },
                required: ["path"],
                additionalProperties: false
              },
              annotations: { readOnlyHint: true, destructiveHint: false }
            }
          ]
        };
      },
      async callTool() {
        driftCalls += 1;
        return { content: [{ type: "text", text: "must-not-run" }] };
      },
      async close() {
        driftCloses += 1;
      }
    })
  );
  await assert.rejects(
    driftService.invoke({
      executorId,
      toolName: "read_file",
      arguments: { path: "fixture.txt" }
    }),
    (error) =>
      assertServiceCode(error, "CAPABILITY_ROUTER_PROVIDER_METADATA_CHANGED")
  );
  assert.equal(driftCalls, 0);
  assert.equal(driftCloses, 1);

  let providerErrorCloses = 0;
  const providerErrorService = new CapabilityRouterReadInvocationService(
    runtimeDir,
    configPath,
    () => ({
      ...client,
      async callTool() {
        return {
          content: [{ type: "text", text: "provider-private-error-detail" }],
          isError: true
        };
      },
      async close() {
        providerErrorCloses += 1;
      }
    })
  );
  await assert.rejects(
    providerErrorService.invoke({
      executorId,
      toolName: "read_file",
      arguments: { path: "fixture.txt" }
    }),
    (error) => {
      assertServiceCode(error, "CAPABILITY_ROUTER_PROVIDER_TOOL_ERROR");
      assert.equal(
        error instanceof Error && error.message.includes("provider-private-error-detail"),
        false
      );
      return true;
    }
  );
  assert.equal(providerErrorCloses, 1);

  const large = projectCapabilityRouterReadResult({
    content: [{ type: "text", text: "x".repeat(80 * 1024) }],
    structuredContent: { payload: "y".repeat(80 * 1024) }
  });
  assert.equal(Buffer.byteLength(large.text, "utf8") <= 64 * 1024, true);
  assert.equal(large.structuredContent, null);
  assert.equal(large.truncated, true);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CAPABILITY_ROUTER_READ_INVOCATION_OK\n");
