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
import type { CodexPluginMutationAdapter } from "../src/runtime/resources/codex-plugin-mutation-adapter.ts";
import type { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";
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

let skillEnabled = true;
let skillMutationCalls = 0;
let mutationNow = "2026-08-11T00:00:00.000Z";

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
      enabled: skillEnabled,
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

const fakeSkillMutationAdapter = {
  setEnabled: async (input: { desiredEnabled: boolean }) => {
    skillMutationCalls += 1;
    skillEnabled = input.desiredEnabled;
    return { effectiveEnabled: input.desiredEnabled };
  }
} as unknown as CodexSkillMutationAdapter;

const fakePluginMutationAdapter = {
  install: async () => {
    throw new Error("Runtime Resource API fixture must not install a Plugin");
  },
  uninstall: async () => {
    throw new Error("Runtime Resource API fixture must not uninstall a Plugin");
  }
} as unknown as CodexPluginMutationAdapter;

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
    exposed: process.env.TOKENPILOT_EXPOSED,
    resourceMutationsExposed: process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED
  };
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  process.env.TOKENPILOT_API_TOKEN = "test-token";
  process.env.TOKENPILOT_EXPOSED = "true";
  delete process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED;

  const app = buildServer(paths, {
    codexAdapter: fakeCodex,
    codexSkillMutationAdapter: fakeSkillMutationAdapter,
    codexPluginMutationAdapter: fakePluginMutationAdapter,
    runtimeResourceMutationNow: () => mutationNow,
    acpRegistryAdapter: null
  });
  let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;
  let rpcId = 1;

  try {
    server = await listenTestServer(app);
    const baseUrl = server.baseUrl;
    const rawRest = async (
      method: "GET" | "POST",
      route: string,
      body?: unknown,
      token = "test-token"
    ) =>
      fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    const rest = async <T>(
      method: "GET" | "POST",
      route: string,
      body?: unknown
    ): Promise<T> => {
      const response = await rawRest(method, route, body);
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
      snapshot: {
        id: string;
        status: string;
        fingerprint: string;
        items: Array<{ resourceId: string }>;
      };
      resources: Array<{
        id: string;
        kind: string;
        displayName: string;
        fingerprint: string;
        enabled: boolean | null;
      }>;
      mutationEligibility: Array<{
        resourceId: string;
        snapshotId: string;
        operations: Array<{
          operation: string;
          eligible: boolean;
          code: string;
        }>;
      }>;
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

    const skill = restInventory.resources.find((resource) => resource.kind === "skill")!;
    const skillEligibility = restInventory.mutationEligibility.find(
      (entry) => entry.resourceId === skill.id
    )!;
    assert.equal(skillEligibility.snapshotId, restInventory.snapshot.id);
    assert.equal(
      skillEligibility.operations.find((entry) => entry.operation === "skill.disable")
        ?.eligible,
      true
    );

    const blockedPrepare = await rawRest("POST", "/api/resources/mutations/prepare", {
      operation: "skill.disable",
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: skill.fingerprint,
      idempotencyKey: "resource-api-mutation-prepare-blocked-0001"
    });
    assert.equal(blockedPrepare.status, 403);
    assert.equal(
      ((await blockedPrepare.json()) as { error: { code: string } }).error.code,
      "RUNTIME_RESOURCE_MUTATION_EXPOSURE_DISABLED"
    );
    assert.equal(skillMutationCalls, 0);

    const stillReadable = await rest<{ ok: true; snapshot: { id: string } }>(
      "GET",
      `/api/resources/snapshots/${restInventory.snapshot.id}`
    );
    assert.equal(stillReadable.snapshot.id, restInventory.snapshot.id);

    process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED = "true";

    const forgedActor = await rawRest("POST", "/api/resources/mutations/prepare", {
      operation: "skill.disable",
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: skill.fingerprint,
      idempotencyKey: "resource-api-mutation-prepare-forged-actor-0001",
      requestedActorType: "remote-mcp"
    });
    assert.equal(forgedActor.status, 400);
    assert.equal(skillMutationCalls, 0);

    const stalePrepare = await rawRest("POST", "/api/resources/mutations/prepare", {
      operation: "skill.disable",
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: "f".repeat(64),
      idempotencyKey: "resource-api-mutation-prepare-stale-0001"
    });
    assert.equal(stalePrepare.status, 409);
    assert.equal(
      ((await stalePrepare.json()) as { error: { code: string } }).error.code,
      "RUNTIME_RESOURCE_MUTATION_STALE"
    );
    assert.equal(skillMutationCalls, 0);

    const strictSelector = await rawRest("POST", "/api/resources/mutations/prepare", {
      operation: "skill.disable",
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: skill.fingerprint,
      idempotencyKey: "resource-api-mutation-prepare-strict-0001",
      remotePluginId: "must-be-rejected"
    });
    assert.equal(strictSelector.status, 400);
    assert.equal(skillMutationCalls, 0);

    const prepareBody = {
      operation: "skill.disable" as const,
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: skill.fingerprint,
      idempotencyKey: "resource-api-mutation-prepare-0001"
    };
    const prepared = await rest<{
      ok: true;
      approval: {
        id: string;
        status: string;
        revision: number;
        requestedActor: { type: string; identityHash: string | null } | null;
      };
      replayed: boolean;
    }>("POST", "/api/resources/mutations/prepare", prepareBody);
    assert.equal(prepared.replayed, false);
    assert.equal(prepared.approval.status, "pending");
    assert.equal(prepared.approval.requestedActor?.type, "rest-api");
    const preparedReplay = await rest<typeof prepared>(
      "POST",
      "/api/resources/mutations/prepare",
      prepareBody
    );
    assert.equal(preparedReplay.replayed, true);
    assert.equal(preparedReplay.approval.id, prepared.approval.id);

    const approvalRead = await rest<{
      ok: true;
      approval: { id: string; status: string };
    }>(
      "GET",
      `/api/resources/mutations/approvals/${prepared.approval.id}?workspaceId=${encodeURIComponent(workspace.id)}`
    );
    assert.equal(approvalRead.approval.status, "pending");

    const decisionBody = {
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved" as const,
      idempotencyKey: "resource-api-mutation-decision-0001"
    };
    const decision = await rest<{
      ok: true;
      approval: {
        id: string;
        status: string;
        revision: number;
        decidedActor: { type: string } | null;
      };
      replayed: boolean;
    }>("POST", "/api/resources/mutations/decision", decisionBody);
    assert.equal(decision.approval.status, "approved");
    assert.equal(decision.approval.decidedActor?.type, "rest-api");
    assert.equal(
      (await rest<typeof decision>("POST", "/api/resources/mutations/decision", decisionBody))
        .replayed,
      true
    );

    const executeBody = {
      approvalId: decision.approval.id,
      expectedApprovalRevision: decision.approval.revision,
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: skill.fingerprint,
      idempotencyKey: "resource-api-mutation-execute-0001"
    };
    const executed = await rest<{
      ok: true;
      execution: {
        id: string;
        verificationStatus: string;
        executedActor: { type: string } | null;
      };
      replayed: boolean;
    }>("POST", "/api/resources/mutations/execute", executeBody);
    assert.equal(executed.execution.verificationStatus, "verified");
    assert.equal(executed.execution.executedActor?.type, "rest-api");
    assert.equal(skillMutationCalls, 1);
    const executeReplay = await rest<typeof executed>(
      "POST",
      "/api/resources/mutations/execute",
      executeBody
    );
    assert.equal(executeReplay.replayed, true);
    assert.equal(skillMutationCalls, 1);

    const consumedExecute = await rawRest("POST", "/api/resources/mutations/execute", {
      ...executeBody,
      idempotencyKey: "resource-api-mutation-execute-consumed-0002"
    });
    assert.equal(consumedExecute.status, 409);
    assert.equal(
      ((await consumedExecute.json()) as { error: { code: string } }).error.code,
      "RUNTIME_RESOURCE_MUTATION_APPROVAL_CONSUMED"
    );
    assert.equal(skillMutationCalls, 1);

    const executionRead = await rest<{
      ok: true;
      execution: { id: string; verificationStatus: string };
    }>(
      "GET",
      `/api/resources/mutations/executions/${executed.execution.id}?workspaceId=${encodeURIComponent(workspace.id)}`
    );
    assert.equal(executionRead.execution.verificationStatus, "verified");
    const activity = await rest<{
      ok: true;
      approvals: Array<{ id: string }>;
      executions: Array<{ id: string }>;
    }>(
      "GET",
      `/api/resources/mutations/activity?workspaceId=${encodeURIComponent(workspace.id)}&resourceId=${encodeURIComponent(skill.id)}&limit=10`
    );
    assert.equal(activity.approvals.some((entry) => entry.id === prepared.approval.id), true);
    assert.equal(activity.executions.some((entry) => entry.id === executed.execution.id), true);
    const aliasedActivity = await rest<typeof activity>(
      "GET",
      `/tokenpilot/api/resources/mutations/activity?workspaceId=${encodeURIComponent(workspace.id)}&resourceId=${encodeURIComponent(skill.id)}&limit=10`
    );
    assert.deepEqual(aliasedActivity, activity);

    const refreshed = await rest<{
      ok: true;
      resources: Array<{
        id: string;
        enabled: boolean | null;
        fingerprint: string;
      }>;
    }>("POST", "/api/resources/inventory", {
      ...inventoryInput,
      idempotencyKey: "resource-api-inventory-after-mutation-0001"
    });
    assert.equal(
      refreshed.resources.find((resource) => resource.id === skill.id)?.enabled,
      false
    );

    mutationNow = "2026-08-11T00:01:00.000Z";
    const refreshedSkill = refreshed.resources.find((resource) => resource.id === skill.id)!;
    const expiring = await rest<{
      ok: true;
      approval: { id: string; revision: number; status: string };
    }>("POST", "/api/resources/mutations/prepare", {
      operation: "skill.enable",
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedFingerprint: refreshedSkill.fingerprint,
      idempotencyKey: "resource-api-mutation-prepare-expiring-0001"
    });
    assert.equal(expiring.approval.status, "pending");
    mutationNow = "2026-08-11T00:07:00.000Z";
    const expiredDecision = await rawRest("POST", "/api/resources/mutations/decision", {
      approvalId: expiring.approval.id,
      expectedRevision: expiring.approval.revision,
      decision: "approved",
      idempotencyKey: "resource-api-mutation-decision-expired-0001"
    });
    assert.equal(expiredDecision.status, 409);
    assert.equal(
      ((await expiredDecision.json()) as { error: { code: string } }).error.code,
      "RUNTIME_RESOURCE_MUTATION_APPROVAL_EXPIRED"
    );
    assert.equal(skillMutationCalls, 1);

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

    const openapiResponse = await fetch(`${baseUrl}/openapi.yaml`);
    assert.equal(openapiResponse.status, 200);
    const openapiText = await openapiResponse.text();
    for (const operationId of [
      "prepareRuntimeResourceMutation",
      "decideRuntimeResourceMutation",
      "executeRuntimeResourceMutation",
      "getRuntimeResourceMutationApproval",
      "getRuntimeResourceMutationExecution",
      "listRuntimeResourceMutationActivity"
    ]) {
      assert.match(openapiText, new RegExp(`operationId: ${operationId}`));
    }
    assert.match(openapiText, /TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED=true/);
    for (const forbidden of [
      "remotePluginId",
      "remoteMarketplaceName",
      "marketplacePath",
      "installUrl"
    ]) {
      assert.equal(openapiText.includes(forbidden), false, `OpenAPI leaked ${forbidden}`);
    }

    const serialized = JSON.stringify({
      profiles,
      restInventory,
      prepared,
      approvalRead,
      decision,
      executed,
      executionRead,
      activity,
      refreshed,
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
    for (const forbidden of [
      "mutationHash",
      "requestedRequestIdentityHash",
      "decidedRequestIdentityHash",
      "executedRequestIdentityHash",
      "remotePluginId",
      "marketplacePath",
      "installUrl"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `REST projection leaked ${forbidden}`);
    }

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
    if (previous.resourceMutationsExposed === undefined) {
      delete process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED;
    } else {
      process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED =
        previous.resourceMutationsExposed;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

await run();
