import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeMcpServerProjection,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillProjection
} from "../src/runtime/codex/runtime-adapter.ts";
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

const notUsed = async (): Promise<never> => {
  throw new Error("Runtime Resource API fixture method not used");
};

const fakeCodex: CodingRuntimeAdapter = {
  capabilities: async (): Promise<RuntimeCapabilitySnapshot> => ({
    available: true,
    runtime: "codex-app-server",
    binarySource: "chatgpt-app",
    binaryVersion: "codex-cli resource-api-fixture",
    protocolFamily: "app-server-v2",
    serverProtocolVersion: "2.0",
    stableMethods: ["thread/list", "thread/read", "thread/resume", "thread/fork"],
    experimentalApiEnabled: false,
    standaloneExecution: null
  }),
  listThreads: notUsed,
  readThread: notUsed,
  resumeThread: notUsed,
  forkThread: notUsed,
  startTurn: notUsed,
  interruptTurn: async () => {
    throw new Error("not used");
  },
  listSkills: async (): Promise<RuntimeSkillProjection[]> => [
    {
      name: "api-skill",
      description: "API fixture skill",
      scope: "user",
      enabled: true,
      displayName: "API Skill",
      shortDescription: "API fixture skill",
      brandColor: null
    }
  ],
  listMcpServers: async (): Promise<RuntimeMcpServerProjection[]> => [
    {
      name: "api-mcp",
      title: "API MCP",
      version: "1.0.0",
      authStatus: "unsupported",
      toolCount: 2,
      readOnlyToolCount: 1,
      mutatingToolCount: 1
    }
  ],
  listPlugins: async (): Promise<RuntimePluginProjection[]> => [
    {
      id: "api-plugin@fixture",
      marketplaceName: "fixture",
      name: "api-plugin",
      displayName: "API Plugin",
      description: "API fixture plugin",
      version: "1.0.0",
      availableVersion: "1.0.0",
      installed: true,
      enabled: true,
      availability: "AVAILABLE",
      authPolicy: null,
      category: "Engineering",
      capabilities: ["Read"]
    }
  ],
  readResourceConfigSummary: async (): Promise<RuntimeResourceConfigSummary> => ({
    loaded: true,
    modelProviderConfigured: true,
    sandboxModeConfigured: true,
    desktopConfigPresent: true
  }),
  readStandaloneFile: notUsed,
  writeStandaloneFile: async () => {
    throw new Error("not used");
  },
  listStandaloneDirectory: notUsed,
  executeStandaloneCommand: notUsed,
  respondToServerRequest: async () => {
    throw new Error("not used");
  },
  rejectServerRequest: async () => {
    throw new Error("not used");
  },
  setEventSink: () => undefined,
  close: async () => undefined
};

async function run(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-resource-api-"));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Runtime Resource API fixture\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "tokenpilot.openapi.yaml"),
    path.join(repoRoot, "openapi", "tokenpilot.openapi.yaml")
  );

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "resource-api-config.json");
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

  const app = buildServer(paths, {
    codexAdapter: fakeCodex,
    acpRegistryAdapter: null
  });
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
    const workspace = projects.projects[0]!.workspaces[0]!;

    const profiles = await rest<{
      ok: true;
      profiles: Array<{ id: string; providerKind: string; executableVersion: string | null }>;
    }>("GET", "/api/resources/runtime-profiles");
    assert.equal(profiles.profiles.length, 1);
    const profile = profiles.profiles[0]!;
    assert.equal(profile.providerKind, "codex");
    assert.equal(profile.executableVersion, "codex-cli resource-api-fixture");

    const inventoryInput = {
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      idempotencyKey: "resource-api-inventory-0001"
    };
    const restInventory = await rest<{
      ok: true;
      snapshot: { id: string; status: string; fingerprint: string; items: Array<{ resourceId: string }> };
      resources: Array<{ id: string; kind: string; displayName: string }>;
      replayed: boolean;
      diff: { previousSnapshotId: string | null; added: string[] };
    }>("POST", "/api/resources/inventory", inventoryInput);
    assert.equal(restInventory.replayed, false);
    assert.equal(restInventory.snapshot.status, "ready");
    assert.equal(restInventory.resources.length, 3);
    assert.deepEqual(
      restInventory.resources.map((resource) => resource.kind).sort(),
      ["mcp-server", "plugin", "skill"]
    );
    assert.equal(restInventory.diff.previousSnapshotId, null);

    const mcpReplay = await mcp<typeof restInventory>(
      "tokenpilot.resources.inventory",
      inventoryInput
    );
    assert.equal(mcpReplay.replayed, true);
    assert.equal(mcpReplay.snapshot.id, restInventory.snapshot.id);

    const snapshot = await rest<{
      ok: true;
      snapshot: { id: string; items: Array<{ resourceId: string }> };
    }>("GET", `/api/resources/snapshots/${restInventory.snapshot.id}`);
    assert.equal(snapshot.snapshot.items.length, 3);

    const resourceId = restInventory.resources[0]!.id;
    const inspected = await rest<{
      ok: true;
      resource: { id: string; runtimeProfileId: string };
      snapshot: { id: string };
    }>("GET", `/api/resources/items/${resourceId}`);
    assert.equal(inspected.resource.id, resourceId);
    assert.equal(inspected.resource.runtimeProfileId, profile.id);

    const mcpProfiles = await mcp<{
      profiles: Array<{ id: string; providerKind: string }>;
    }>("tokenpilot.resources.inspect", { target: "profiles" });
    assert.equal(mcpProfiles.profiles[0]?.id, profile.id);
    const mcpSnapshot = await mcp<{
      snapshot: { id: string };
    }>("tokenpilot.resources.inspect", {
      target: "snapshot",
      id: restInventory.snapshot.id
    });
    assert.equal(mcpSnapshot.snapshot.id, restInventory.snapshot.id);
    const mcpResource = await mcp<{
      resource: { id: string };
      snapshot: { id: string };
    }>("tokenpilot.resources.inspect", {
      target: "resource",
      id: resourceId
    });
    assert.equal(mcpResource.resource.id, resourceId);

    const serialized = JSON.stringify({
      profiles,
      restInventory,
      mcpReplay,
      snapshot,
      inspected,
      mcpProfiles,
      mcpSnapshot,
      mcpResource
    });
    assert.equal(serialized.includes(repoRoot), false);
    assert.equal(serialized.includes("test-token"), false);
    assert.equal(serialized.includes("rawConfig"), false);
    assert.equal(serialized.includes("inputSchema"), false);

    process.stdout.write("VERIFY_RUNTIME_RESOURCE_API_OK\n");
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
