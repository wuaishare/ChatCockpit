import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildOperationContext } from "../src/application/operation-context.ts";
import type { RuntimeResourceMutationPublicService } from "../src/application/runtime-resource-mutation-public-service.ts";
import type { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildRuntimeResourceMutationMcpTools } from "../src/mcp/tools/runtime-resource-mutations.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeMcpServerProjection,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillProjection
} from "../src/runtime/codex/runtime-adapter.ts";
import type { CodexPluginMutationAdapter } from "../src/runtime/resources/codex-plugin-mutation-adapter.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";
import { buildServer } from "../src/server/app.ts";
import { listenTestServer } from "./test-support/server.ts";

const API_TOKEN = "test-token";

interface ListedTool {
  name: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

function parseMcpResponse(body: string): Record<string, unknown> {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length > 0 ? dataLines.join("\n") : body) as Record<
    string,
    unknown
  >;
}

async function listTools(baseUrl: string): Promise<ListedTool[]> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${API_TOKEN}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    })
  });
  assert.equal(response.status, 200);
  const message = parseMcpResponse(await response.text()) as {
    result?: { tools?: ListedTool[] };
    error?: unknown;
  };
  assert.equal(message.error, undefined);
  assert.ok(message.result?.tools);
  return message.result.tools;
}

async function catalogFor(exposureEnabled: boolean, repoRoot: string): Promise<ListedTool[]> {
  if (exposureEnabled) {
    process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED = "true";
  } else {
    delete process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED;
  }
  const paths = buildPaths(repoRoot);
  const app = buildServer(paths);
  const server = await listenTestServer(app);
  try {
    return await listTools(server.baseUrl);
  } finally {
    await server.close();
  }
}

const notUsed = async (): Promise<never> => {
  throw new Error("Runtime Resource MCP mutation fixture method not used");
};

async function runHttpCrossSurfaceFixture(repoRoot: string): Promise<void> {
  let skillEnabled = true;
  let skillMutationCalls = 0;
  const fakeCodex: CodingRuntimeAdapter = {
    capabilities: async (): Promise<RuntimeCapabilitySnapshot> => ({
      available: true,
      runtime: "codex-app-server",
      binarySource: "chatgpt-app",
      binaryVersion: "codex-cli mcp-mutation-fixture",
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
        name: "mcp-mutation-skill",
        description: "MCP mutation fixture Skill",
        scope: "user",
        enabled: skillEnabled,
        displayName: "MCP Mutation Skill",
        shortDescription: "MCP mutation fixture",
        brandColor: null
      }
    ],
    listMcpServers: async (): Promise<RuntimeMcpServerProjection[]> => [],
    listPlugins: async (): Promise<RuntimePluginProjection[]> => [],
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
  const fakeSkillMutation = {
    setEnabled: async (input: { desiredEnabled: boolean }) => {
      skillMutationCalls += 1;
      skillEnabled = input.desiredEnabled;
      return { effectiveEnabled: skillEnabled };
    }
  } as unknown as CodexSkillMutationAdapter;
  const fakePluginMutation = {
    install: async () => {
      throw new Error("MCP mutation fixture must not install a Plugin");
    },
    uninstall: async () => {
      throw new Error("MCP mutation fixture must not uninstall a Plugin");
    }
  } as unknown as CodexPluginMutationAdapter;

  const app = buildServer(buildPaths(repoRoot), {
    codexAdapter: fakeCodex,
    codexSkillMutationAdapter: fakeSkillMutation,
    codexPluginMutationAdapter: fakePluginMutation,
    acpRegistryAdapter: null
  });
  const server = await listenTestServer(app);
  let rpcId = 100;
  try {
    const rest = async <T>(method: "GET" | "POST", route: string, body?: unknown) => {
      const response = await fetch(`${server.baseUrl}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
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
    const mcp = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const response = await fetch(`${server.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${API_TOKEN}`,
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
      const message = parseMcpResponse(await response.text()) as {
        result?: {
          isError?: boolean;
          structuredContent?: T & { error?: { code?: string; message?: string } };
        };
        error?: unknown;
      };
      assert.equal(message.error, undefined, JSON.stringify(message.error));
      assert.equal(
        message.result?.isError,
        undefined,
        `MCP ${name} failed: ${JSON.stringify(message.result?.structuredContent)}`
      );
      assert.ok(message.result?.structuredContent);
      return message.result.structuredContent;
    };

    const projects = await rest<{
      projects: Array<{ workspaces: Array<{ id: string }> }>;
    }>("GET", "/api/continuity/projects");
    const workspace = projects.projects[0]!.workspaces[0]!;
    const profiles = await rest<{
      profiles: Array<{ id: string; providerKind: string }>;
    }>("GET", "/api/resources/runtime-profiles");
    const profile = profiles.profiles.find((entry) => entry.providerKind === "codex")!;
    const inventory = await rest<{
      snapshot: { id: string };
      resources: Array<{
        id: string;
        kind: string;
        enabled: boolean | null;
        fingerprint: string;
      }>;
    }>("POST", "/api/resources/inventory", {
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      idempotencyKey: "mcp-cross-surface-inventory-0001"
    });
    const skill = inventory.resources.find((resource) => resource.kind === "skill")!;
    assert.equal(skill.enabled, true);

    const prepared = await mcp<{
      ok: true;
      approval: {
        id: string;
        status: string;
        revision: number;
        requestedActor: { type: string } | null;
        decidedActor: { type: string } | null;
      };
      replayed: boolean;
    }>("chatcockpit.resources.mutation.prepare", {
      operation: "skill.disable",
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedSnapshotId: inventory.snapshot.id,
      expectedFingerprint: skill.fingerprint,
      idempotencyKey: "mcp-cross-surface-prepare-0001"
    });
    assert.equal(prepared.replayed, false);
    assert.equal(prepared.approval.status, "pending");
    assert.equal(prepared.approval.requestedActor?.type, "remote-mcp");
    assert.equal(prepared.approval.decidedActor, null);
    assert.equal(skillMutationCalls, 0);

    const decision = await rest<{
      approval: {
        id: string;
        status: string;
        revision: number;
        requestedActor: { type: string } | null;
        decidedActor: { type: string } | null;
      };
    }>("POST", "/api/resources/mutations/decision", {
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved",
      idempotencyKey: "mcp-cross-surface-decision-0001"
    });
    assert.equal(decision.approval.status, "approved");
    assert.equal(decision.approval.requestedActor?.type, "remote-mcp");
    assert.equal(decision.approval.decidedActor?.type, "rest-api");
    assert.equal(skillMutationCalls, 0);

    const executeBody = {
      approvalId: decision.approval.id,
      expectedApprovalRevision: decision.approval.revision,
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: skill.fingerprint,
      idempotencyKey: "mcp-cross-surface-execute-0001"
    };
    const executed = await mcp<{
      execution: {
        id: string;
        verificationStatus: string;
        executedActor: { type: string } | null;
      };
      replayed: boolean;
    }>("chatcockpit.resources.mutation.execute", executeBody);
    assert.equal(executed.replayed, false);
    assert.equal(executed.execution.verificationStatus, "verified");
    assert.equal(executed.execution.executedActor?.type, "remote-mcp");
    assert.equal(skillMutationCalls, 1);
    assert.equal(skillEnabled, false);

    const replay = await mcp<typeof executed>(
      "chatcockpit.resources.mutation.execute",
      executeBody
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.execution.id, executed.execution.id);
    assert.equal(skillMutationCalls, 1);

    const inspected = await mcp<{
      execution: {
        id: string;
        verificationStatus: string;
        executedActor: { type: string } | null;
      };
    }>("chatcockpit.resources.mutation.inspect", {
      target: "execution",
      workspaceId: workspace.id,
      executionId: executed.execution.id
    });
    assert.equal(inspected.execution.id, executed.execution.id);
    assert.equal(inspected.execution.executedActor?.type, "remote-mcp");

    const refreshed = await rest<{
      resources: Array<{ id: string; enabled: boolean | null }>;
    }>("POST", "/api/resources/inventory", {
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      idempotencyKey: "mcp-cross-surface-inventory-after-0001"
    });
    assert.equal(
      refreshed.resources.find((resource) => resource.id === skill.id)?.enabled,
      false
    );
  } finally {
    await server.close();
  }
}

const directCalls = { prepare: 0, execute: 0 };
const directTools = buildRuntimeResourceMutationMcpTools({
  mutations: {
    prepare: async () => {
      directCalls.prepare += 1;
      throw new Error("INVALID_PREPARE_REACHED_SERVICE");
    },
    execute: async () => {
      directCalls.execute += 1;
      throw new Error("INVALID_EXECUTE_REACHED_SERVICE");
    }
  } as unknown as RuntimeResourceMutationService,
  publicMutations: {
    getApproval: () => {
      throw new Error("INVALID_PREPARE_REACHED_PUBLIC_SERVICE");
    },
    getExecution: () => {
      throw new Error("INVALID_EXECUTE_REACHED_PUBLIC_SERVICE");
    },
    activity: () => {
      throw new Error("INVALID_INSPECT_REACHED_PUBLIC_SERVICE");
    }
  } as unknown as RuntimeResourceMutationPublicService
});
const directByName = new Map(directTools.map((tool) => [tool.name, tool]));
assert.equal(directByName.has("chatcockpit.resources.mutation.decide"), false);
assert.equal(directByName.has("chatcockpit.resources.mutation.reconcile"), false);
const directContext = buildOperationContext({
  requestId: "runtime-resource-mcp-mutation-schema-request",
  actorType: "remote-mcp",
  actorId: "fixture-client",
  publicProjection: true,
  now: "2026-08-11T03:10:00.000Z"
});
const invalidPrepare = await directByName
  .get("chatcockpit.resources.mutation.prepare")!
  .execute(directContext, {
    operation: "skill.disable",
    runtimeProfileId: "runtime_profile_fixture",
    workspaceId: "workspace_fixture",
    resourceId: "resource_fixture",
    expectedSnapshotId: "resource_snapshot_fixture",
    expectedFingerprint: "a".repeat(64),
    idempotencyKey: "runtime-resource-mcp-prepare-invalid-0001",
    remotePluginId: "must-not-be-accepted"
  });
assert.equal(invalidPrepare.isError, true);
assert.equal(
  (invalidPrepare.structuredContent.error as { code?: string }).code,
  "VALIDATION_ERROR"
);
assert.equal(directCalls.prepare, 0);
const invalidInspect = await directByName
  .get("chatcockpit.resources.mutation.inspect")!
  .execute(directContext, {
    target: "activity",
    workspaceId: "workspace_fixture",
    marketplacePath: "/private/must-not-be-accepted"
  });
assert.equal(invalidInspect.isError, true);
assert.equal(
  (invalidInspect.structuredContent.error as { code?: string }).code,
  "VALIDATION_ERROR"
);
assert.equal(directCalls.execute, 0);

const repoRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "chatcockpit-runtime-resource-mcp-mutation-")
);
const paths = buildPaths(repoRoot);
ensureWorkspaceDirs(paths);
const configPath = path.join(paths.runtimeDir, "runtime-resource-mcp-mutation-config.json");
fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceAllowlist: [repoRoot],
      repoMappings: {
        primary: { path: repoRoot }
      }
    },
    null,
    2
  )}\n`,
  "utf8"
);

const previous = {
  configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
  apiToken: process.env.CHATCOCKPIT_API_TOKEN,
  exposed: process.env.CHATCOCKPIT_EXPOSED,
  mutationExposed: process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED
};

try {
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = API_TOKEN;
  process.env.CHATCOCKPIT_EXPOSED = "true";

  const closedCatalog = await catalogFor(false, repoRoot);
  for (const forbidden of [
    "chatcockpit.resources.mutation.prepare",
    "chatcockpit.resources.mutation.inspect",
    "chatcockpit.resources.mutation.execute",
    "chatcockpit.resources.mutation.decide",
    "chatcockpit.resources.mutation.reconcile"
  ]) {
    assert.equal(
      closedCatalog.some((tool) => tool.name === forbidden),
      false,
      `Exposed deployment without explicit mutation opt-in registered ${forbidden}`
    );
  }

  const enabledCatalog = await catalogFor(true, repoRoot);
  const mutationTools = enabledCatalog
    .filter((tool) => tool.name.startsWith("chatcockpit.resources.mutation."))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(
    mutationTools.map((tool) => tool.name),
    [
      "chatcockpit.resources.mutation.execute",
      "chatcockpit.resources.mutation.inspect",
      "chatcockpit.resources.mutation.prepare"
    ]
  );
  assert.equal(
    enabledCatalog.some((tool) => tool.name === "chatcockpit.resources.mutation.decide"),
    false
  );
  assert.equal(
    enabledCatalog.some((tool) => tool.name === "chatcockpit.resources.mutation.reconcile"),
    false
  );

  const byName = new Map(mutationTools.map((tool) => [tool.name, tool]));
  assert.deepEqual(byName.get("chatcockpit.resources.mutation.prepare")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
  assert.deepEqual(byName.get("chatcockpit.resources.mutation.inspect")?.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
  assert.deepEqual(byName.get("chatcockpit.resources.mutation.execute")?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true
  });

  await runHttpCrossSurfaceFixture(repoRoot);
} finally {
  if (previous.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = previous.configPath;
  if (previous.apiToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
  else process.env.CHATCOCKPIT_API_TOKEN = previous.apiToken;
  if (previous.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
  else process.env.CHATCOCKPIT_EXPOSED = previous.exposed;
  if (previous.mutationExposed === undefined) {
    delete process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED;
  } else {
    process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED = previous.mutationExposed;
  }
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_MCP_MUTATIONS_OK\n");
