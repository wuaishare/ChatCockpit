import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DirectCapabilityBroker } from "../src/direct/capability-broker.ts";
import {
  buildDesktopCommanderExecutorConfig,
  DESKTOP_COMMANDER_CAPABILITY_MAPPINGS,
  DESKTOP_COMMANDER_EXECUTOR_ID,
  DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL,
  DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL,
  DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
  DESKTOP_COMMANDER_START_PROCESS_TOOL
} from "../src/direct/adapters/desktop-commander.ts";
import { buildConfiguredDirectCapabilityBroker } from "../src/direct/broker-factory.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { loadDownstreamMcpExecutorsConfig } from "../src/direct/downstream-mcp-config.ts";
import {
  DownstreamMcpExecutionError,
  DownstreamMcpExecutionRegistry
} from "../src/direct/downstream-mcp-executor.ts";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import {
  DownstreamMcpClientError,
  DownstreamMcpStdioClient
} from "../src/direct/downstream-mcp-stdio-client.ts";
import { probeDownstreamMcpExecutor } from "../src/direct/downstream-mcp-probe.ts";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.ts";
import { projectDownstreamMcpToolCatalog } from "../src/direct/downstream-mcp-tool-catalog.ts";
import { createDownstreamMcpExecutorSource } from "../src/direct/executor-sources.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);

function client(mode = "normal", timeoutMs = 1_000): DownstreamMcpStdioClient {
  return new DownstreamMcpStdioClient({
    command: process.execPath,
    args: [fixturePath, mode],
    timeoutMs,
    maxBufferBytes: 256 * 1024,
    maxStderrBytes: 16 * 1024
  });
}

function clientPid(value: DownstreamMcpStdioClient): number | null {
  return value.pid;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processExists(pid);
}

async function assertClientError(
  promise: Promise<unknown>,
  code: DownstreamMcpClientError["code"]
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DownstreamMcpClientError);
    assert.equal(error.code, code);
    return true;
  });
}

async function verifyDownstreamMcp(): Promise<void> {
  const stdioClientSource = fs.readFileSync(
    path.resolve("src/direct/downstream-mcp-stdio-client.ts"),
    "utf8"
  );
  assert.match(stdioClientSource, /@modelcontextprotocol\/client/);
  assert.match(stdioClientSource, /@modelcontextprotocol\/client\/stdio/);
  assert.doesNotMatch(stdioClientSource, /node:child_process/);
  assert.doesNotMatch(stdioClientSource, /JSONRPCMessageSchema/);
  assert.doesNotMatch(stdioClientSource, /ReadBuffer/);
  assert.doesNotMatch(stdioClientSource, /serializeMessage/);

  const desktopCommanderConfig = buildDesktopCommanderExecutorConfig({
    packageSpec: "@wonderwhy-er/desktop-commander@1.2.3-test"
  });
  assert.equal(desktopCommanderConfig.id, DESKTOP_COMMANDER_EXECUTOR_ID);
  assert.deepEqual(desktopCommanderConfig.transport.args, [
    "-y",
    "@wonderwhy-er/desktop-commander@1.2.3-test"
  ]);
  assert.deepEqual(
    DESKTOP_COMMANDER_CAPABILITY_MAPPINGS.map((mapping) => [
      mapping.capability,
      mapping.toolName
    ]),
    [
      ["files.read", "read_file"],
      ["files.list", "list_directory"],
      ["files.write", "write_file"],
      ["files.edit", "edit_block"],
      ["shell.exec", DESKTOP_COMMANDER_START_PROCESS_TOOL]
    ]
  );
  assert.equal(
    DESKTOP_COMMANDER_CAPABILITY_MAPPINGS.some(
      (mapping) => mapping.capability === "search.content"
    ),
    false
  );
  assert.equal(DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL, "read_process_output");
  assert.equal(DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL, "force_terminate");
  assert.equal(
    DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL,
    "interact_with_process"
  );

  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-downstream-"));
  const runtimeDir = path.join(storeRoot, ".chatcockpit", "runtime");
  const store = new DownstreamMcpCapabilityStore(runtimeDir);

  try {
    const snapshot = await probeDownstreamMcpExecutor({
      client: client(),
      store,
      now: "2026-08-08T06:00:00.000Z",
      config: {
        executorId: "downstream-mcp:desktop-commander-fixture",
        displayName: "Desktop Commander Fixture",
        mappings: [
          {
            capability: "files.read",
            toolName: "read_file",
            scopes: ["host"],
            access: ["read"]
          },
          {
            capability: "files.write",
            toolName: "write_file",
            scopes: ["host"],
            access: ["write"]
          },
          {
            capability: "files.edit",
            toolName: "missing_edit_tool",
            scopes: ["host"],
            access: ["write"]
          }
        ]
      }
    });

    assert.equal(snapshot.health, "degraded");
    assert.equal(snapshot.serverName, "fake-downstream");
    assert.equal(snapshot.serverVersion, "1.0.0");
    assert.ok(snapshot.toolsObserved.includes("unmapped_private_tool"));
    const readFileCatalog = snapshot.toolCatalog.find(
      (tool) => tool.name === "read_file"
    );
    assert.ok(readFileCatalog);
    assert.equal(readFileCatalog.metadataStatus, "ready");
    assert.equal(
      (
        readFileCatalog.inputSchema?.properties as
          | Record<string, { type?: string }>
          | undefined
      )?.path?.type,
      "string"
    );
    assert.equal(readFileCatalog.description, "Read a file fixture");
    assert.equal(
      snapshot.mappings.find((mapping) => mapping.capability === "files.read")?.status,
      "verified"
    );
    assert.equal(
      snapshot.mappings.find((mapping) => mapping.capability === "files.edit")?.status,
      "missing"
    );

    const persisted = store.read("downstream-mcp:desktop-commander-fixture");
    assert.deepEqual(persisted, snapshot);
    assert.equal(
      persisted?.toolCatalog.find((tool) => tool.name === "read_file")
        ?.metadataStatus,
      "ready"
    );

    const boundedCatalog = projectDownstreamMcpToolCatalog([
      {
        name: "oversized_schema",
        inputSchema: {
          type: "object",
          description: "x".repeat(70 * 1024)
        }
      }
    ]);
    assert.equal(boundedCatalog[0]?.metadataStatus, "bounded");
    assert.equal(boundedCatalog[0]?.inputSchema, null);

    const legacyExecutorId = "downstream-mcp:legacy-summary-fixture";
    const legacySnapshot = {
      ...snapshot,
      executorId: legacyExecutorId,
      displayName: "Legacy Summary Fixture",
      toolsObserved: ["legacy_tool"]
    } as Record<string, unknown>;
    delete legacySnapshot.toolCatalog;
    const legacyPath = path.join(storeRoot, store.publicPath(legacyExecutorId));
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, `${JSON.stringify(legacySnapshot, null, 2)}\n`, "utf8");
    const normalizedLegacy = store.read(legacyExecutorId);
    assert.equal(normalizedLegacy?.toolCatalog.length, 1);
    assert.deepEqual(normalizedLegacy?.toolCatalog[0], {
      name: "legacy_tool",
      description: null,
      inputSchema: null,
      outputSchema: null,
      annotations: null,
      metadataStatus: "legacy-summary-only"
    });
    assert.match(
      store.publicPath("downstream-mcp:desktop-commander-fixture"),
      /^\.chatcockpit\/runtime\/capabilities\/downstream-mcp\//
    );

    const source = createDownstreamMcpExecutorSource(
      store,
      "downstream-mcp:desktop-commander-fixture"
    );
    const descriptor = source.describe();
    assert.equal(descriptor.kind, "downstream-mcp");
    assert.equal(descriptor.health, "degraded");
    assert.deepEqual(descriptor.scopes, ["host"]);
    assert.deepEqual(
      descriptor.capabilities.map((capability) => capability.id).sort(),
      ["files.read", "files.write"]
    );
    const publicDescriptor = JSON.stringify(descriptor);
    assert.doesNotMatch(publicDescriptor, /read_file/);
    assert.doesNotMatch(publicDescriptor, /write_file/);
    assert.doesNotMatch(publicDescriptor, /unmapped_private_tool/);
    assert.doesNotMatch(publicDescriptor, /fixturePath/);

    const broker = new DirectCapabilityBroker([source]);
    const hostRead = broker.resolve({
      capability: "files.read",
      scope: "host",
      access: "read"
    });
    assert.equal(hostRead.executorId, "downstream-mcp:desktop-commander-fixture");
    assert.equal(hostRead.executorKind, "downstream-mcp");

    assert.throws(
      () =>
        broker.resolve({
          capability: "files.edit",
          scope: "host",
          access: "write",
          executorId: "downstream-mcp:desktop-commander-fixture"
        }),
      /does not support files\.edit/
    );

    const normalClient = client();
    const listed = await normalClient.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "read_file"));
    const called = await normalClient.callTool("read_file", { path: "fixture.txt" });
    assert.match(JSON.stringify(called), /called:read_file/);
    await normalClient.close();

    const stubbornClient = client("ignore-sigterm");
    await stubbornClient.initialize();
    const stubbornPid = clientPid(stubbornClient);
    assert.ok(stubbornPid);
    await stubbornClient.close();
    assert.equal(await waitForProcessExit(stubbornPid), true);

    const invalidListClient = client("invalid-list");
    await assertClientError(
      invalidListClient.listTools(),
      "DOWNSTREAM_MCP_RESPONSE_INVALID"
    );
    await invalidListClient.close();

    const invalidProtocolClient = client("invalid-protocol");
    await assertClientError(
      invalidProtocolClient.listTools(),
      "DOWNSTREAM_MCP_PROTOCOL_ERROR"
    );
    await invalidProtocolClient.close();

    const timeoutClient = client("timeout", 100);
    await assertClientError(timeoutClient.listTools(), "DOWNSTREAM_MCP_TIMEOUT");
    await timeoutClient.close();

    const stderrFloodClient = client("stderr-flood", 500);
    await assertClientError(
      stderrFloodClient.initialize(),
      "DOWNSTREAM_MCP_PROTOCOL_ERROR"
    );
    await stderrFloodClient.close();

    const missingExecutableClient = new DownstreamMcpStdioClient({
      command: path.join(storeRoot, "missing-downstream-mcp-executable"),
      timeoutMs: 500
    });
    await assertClientError(
      missingExecutableClient.initialize(),
      "DOWNSTREAM_MCP_START_FAILED"
    );
    await missingExecutableClient.close();

    const exitClient = client("exit", 500);
    await assertClientError(
      exitClient.initialize(),
      "DOWNSTREAM_MCP_DISCONNECTED"
    );
    await exitClient.close();

    const operatorRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "chatcockpit-downstream-operator-")
    );
    const operatorConfigPath = path.join(operatorRoot, "direct-executors.json");
    fs.writeFileSync(
      operatorConfigPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          executors: [
            {
              id: "downstream-mcp:operator-fixture",
              displayName: "Operator Fixture",
              transport: {
                kind: "stdio",
                command: process.execPath,
                args: [fixturePath, "normal"],
                timeoutMs: 1000,
                maxBufferBytes: 262144,
                maxStderrBytes: 16384
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
    const loadedConfig = loadDownstreamMcpExecutorsConfig(operatorConfigPath);
    assert.equal(loadedConfig.executors[0]?.id, "downstream-mcp:operator-fixture");
    const operatorSummaries = await probeConfiguredDownstreamMcpExecutors({
      paths: buildPaths(operatorRoot),
      configPath: operatorConfigPath,
      executorId: "downstream-mcp:operator-fixture"
    });
    assert.deepEqual(operatorSummaries[0]?.verifiedCapabilities, ["files.read"]);
    assert.doesNotMatch(JSON.stringify(operatorSummaries), /read_file/);
    assert.doesNotMatch(JSON.stringify(operatorSummaries), new RegExp(fixturePath));

    const operatorPaths = buildPaths(operatorRoot);
    const configuredBroker = buildConfiguredDirectCapabilityBroker({
      paths: operatorPaths,
      codexStandaloneStore: new CodexStandaloneCapabilityStore(
        operatorPaths.runtimeDir
      ),
      downstreamConfigPath: operatorConfigPath
    });
    assert.deepEqual(
      configuredBroker.catalog().map((executor) => executor.id),
      [
        "codex-app-server-standalone",
        "builtin-direct",
        "downstream-mcp:operator-fixture"
      ]
    );
    const configuredHostRead = configuredBroker.resolve({
      capability: "files.read",
      scope: "host",
      access: "read"
    });
    assert.equal(
      configuredHostRead.executorId,
      "downstream-mcp:operator-fixture"
    );

    const executionRegistry = new DownstreamMcpExecutionRegistry(
      operatorPaths.runtimeDir,
      operatorConfigPath
    );
    const downstreamRead = await executionRegistry.execute({
      executorId: "downstream-mcp:operator-fixture",
      capability: "files.read",
      scope: "host",
      access: "read",
      arguments: { path: "fixture.txt" }
    });
    assert.match(JSON.stringify(downstreamRead.result), /called:read_file/);
    await assert.rejects(
      () =>
        executionRegistry.execute({
          executorId: "downstream-mcp:operator-fixture",
          capability: "search.content",
          scope: "host",
          access: "read",
          arguments: { query: "fixture" }
        }),
      (error) => {
        assert.ok(error instanceof DownstreamMcpExecutionError);
        assert.equal(error.code, "DOWNSTREAM_MAPPING_UNAVAILABLE");
        return true;
      }
    );

    const staleConfig = JSON.parse(
      fs.readFileSync(operatorConfigPath, "utf8")
    ) as {
      executors: Array<{ mappings: Array<{ toolName: string }> }>;
    };
    staleConfig.executors[0]!.mappings[0]!.toolName = "changed_read_file";
    fs.writeFileSync(
      operatorConfigPath,
      `${JSON.stringify(staleConfig, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(
      () =>
        executionRegistry.execute({
          executorId: "downstream-mcp:operator-fixture",
          capability: "files.read",
          scope: "host",
          access: "read",
          arguments: { path: "fixture.txt" }
        }),
      (error) => {
        assert.ok(error instanceof DownstreamMcpExecutionError);
        assert.equal(error.code, "DOWNSTREAM_MAPPING_UNAVAILABLE");
        return true;
      }
    );
    fs.rmSync(operatorRoot, { recursive: true, force: true });

    const emptyStoreRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "chatcockpit-downstream-empty-")
    );
    const emptyStore = new DownstreamMcpCapabilityStore(emptyStoreRoot);
    const unavailable = createDownstreamMcpExecutorSource(
      emptyStore,
      "downstream-mcp:missing"
    ).describe();
    assert.equal(unavailable.health, "unavailable");
    assert.deepEqual(unavailable.capabilities, []);
    fs.rmSync(emptyStoreRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
}

await verifyDownstreamMcp();
process.stdout.write("VERIFY_DOWNSTREAM_MCP_OK\n");
