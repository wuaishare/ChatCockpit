import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
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
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-resource-api-"));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Runtime Resource API fixture\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "chatcockpit.openapi.yaml"),
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml")
  );

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "resource-api-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [repoRoot],
        repoMappings: { primary: { path: repoRoot } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const previous = {
    config: process.env.CHATCOCKPIT_CONFIG_PATH,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    resourceMutationsExposed: process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  delete process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED;

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
      target: {
        id: string;
        kind: string;
        locality: string;
        platform: string;
        architecture: string;
      };
      providers: Array<{
        id: string;
        providerKind: string;
        protocolKind: string;
        capabilities: string[];
      }>;
      profiles: Array<{ id: string; providerKind: string; executableVersion: string | null }>;
      management: {
        target: { id: string };
        providers: Array<{
          id: string;
          targetId: string;
          providerKind: string;
          catalogId: string | null;
          supportTier: "managed" | "observed" | "connected" | "catalog-only";
          detectionStatus: string;
          version: string | null;
          health: string;
          configurationStatus: string;
          exposureStatus: string;
          allowedLifecycleOperations: Array<
            "install" | "update" | "configure" | "start" | "stop" | "restart"
          >;
          verification: { status: string; source: string };
        }>;
      };
    }>("GET", "/api/resources/runtime-profiles");
    assert.deepEqual(profiles.target, {
      id: "local-device",
      kind: "device",
      locality: "local",
      platform: process.platform,
      architecture: process.arch
    });
    assert.equal(JSON.stringify(profiles.target).includes("hostname"), false);
    assert.equal(profiles.providers.length, 1);
    assert.equal(profiles.providers[0]?.providerKind, "codex");
    assert.equal(profiles.providers[0]?.id, profiles.profiles[0]?.id);
    assert.equal("executableVersion" in profiles.providers[0]!, false);
    assert.equal(profiles.profiles.length, 1);
    const profile = profiles.profiles[0]!;
    assert.equal(profile.providerKind, "codex");
    assert.equal(profile.executableVersion, "codex-cli resource-api-fixture");
    assert.equal(profiles.management.target.id, "local-device");
    assert.equal(profiles.management.providers.length, 2);
    const managedProvider = profiles.management.providers.find(
      (entry) => entry.id === profile.id
    );
    assert.ok(managedProvider);
    assert.equal(managedProvider.targetId, "local-device");
    assert.equal(managedProvider.providerKind, "codex");
    assert.equal(managedProvider.catalogId, null);
    assert.equal(managedProvider.supportTier, "observed");
    assert.equal(managedProvider.detectionStatus, "detected");
    assert.equal(managedProvider.version, "codex-cli resource-api-fixture");
    assert.equal(managedProvider.health, "ready");
    assert.equal(managedProvider.configurationStatus, "provider-native");
    assert.equal(managedProvider.exposureStatus, "not-applicable");
    assert.deepEqual(managedProvider.allowedLifecycleOperations, []);
    assert.equal(managedProvider.verification.status, "verified");
    assert.equal(managedProvider.verification.source, "runtime-profile");
    const desktopCatalog = profiles.management.providers.find(
      (entry) => entry.catalogId === "desktop-commander"
    );
    assert.ok(desktopCatalog);
    assert.equal(desktopCatalog.supportTier, "catalog-only");
    assert.equal(desktopCatalog.detectionStatus, "not-observed");
    assert.equal(desktopCatalog.configurationStatus, "not-configured");
    assert.equal(desktopCatalog.version, null);
    assert.deepEqual(desktopCatalog.allowedLifecycleOperations, []);
    assert.doesNotMatch(
      JSON.stringify(profiles.management),
      /"(?:command|args|environment|env|transport|endpoint|credential|url)"\s*:/i,
      "Provider management REST projection must not expose private execution configuration fields"
    );

    const providerManagement = await rest<{
      ok: true;
      target: { id: string };
      providers: Array<{
        id: string;
        providerKind: string;
        catalogId: string | null;
        supportTier: "managed" | "observed" | "connected" | "catalog-only";
        version: string | null;
        exposureStatus: string;
        allowedLifecycleOperations: Array<
          "install" | "update" | "configure" | "start" | "stop" | "restart"
        >;
      }>;
    }>("GET", "/api/resources/providers");
    assert.equal(providerManagement.target.id, "local-device");
    assert.equal(providerManagement.providers.length, 2);
    const providerManagementCodex = providerManagement.providers.find(
      (entry) => entry.id === profile.id
    );
    assert.ok(providerManagementCodex);
    assert.equal(providerManagementCodex.providerKind, "codex");
    assert.equal(providerManagementCodex.supportTier, "observed");
    assert.equal(
      providerManagementCodex.version,
      "codex-cli resource-api-fixture"
    );
    assert.equal(providerManagementCodex.exposureStatus, "not-applicable");
    assert.deepEqual(providerManagementCodex.allowedLifecycleOperations, []);
    const providerManagementDesktop = providerManagement.providers.find(
      (entry) => entry.catalogId === "desktop-commander"
    );
    assert.ok(providerManagementDesktop);
    assert.equal(providerManagementDesktop.supportTier, "catalog-only");
    assert.equal(providerManagementDesktop.version, null);
    assert.deepEqual(providerManagementDesktop.allowedLifecycleOperations, []);

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
      mutationWritesEnabled: boolean;
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
    assert.equal(restInventory.mutationWritesEnabled, false);

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
      expectedSnapshotId: restInventory.snapshot.id,
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

    process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED = "true";
    const enabledInventory = await rest<typeof restInventory>(
      "POST",
      "/api/resources/inventory",
      inventoryInput
    );
    assert.equal(enabledInventory.replayed, true);
    assert.equal(enabledInventory.mutationWritesEnabled, true);

    const forgedActor = await rawRest("POST", "/api/resources/mutations/prepare", {
      operation: "skill.disable",
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      resourceId: skill.id,
      expectedSnapshotId: restInventory.snapshot.id,
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
      expectedSnapshotId: restInventory.snapshot.id,
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
      expectedSnapshotId: restInventory.snapshot.id,
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
      expectedSnapshotId: restInventory.snapshot.id,
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
      snapshot: { id: string };
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
    process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_REST_LIFECYCLE_OK\n");

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
      expectedSnapshotId: refreshed.snapshot.id,
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
      "chatcockpit.resources.inventory",
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
    }>("chatcockpit.resources.inspect", { target: "profiles" });
    assert.equal(mcpProfiles.profiles[0]?.id, profile.id);
    const mcpSnapshot = await mcp<{
      snapshot: { id: string };
    }>("chatcockpit.resources.inspect", {
      target: "snapshot",
      id: restInventory.snapshot.id
    });
    assert.equal(mcpSnapshot.snapshot.id, restInventory.snapshot.id);
    const mcpResource = await mcp<{
      resource: { id: string };
      snapshot: { id: string };
    }>("chatcockpit.resources.inspect", {
      target: "resource",
      id: resourceId
    });
    assert.equal(mcpResource.resource.id, resourceId);

    const openapiResponse = await fetch(`${baseUrl}/openapi.yaml`);
    assert.equal(openapiResponse.status, 200);
    const openapiText = await openapiResponse.text();
    for (const operationId of [
      "listRuntimeResourceProfiles",
      "listCapabilityProviders",
      "prepareRuntimeResourceMutation",
      "decideRuntimeResourceMutation",
      "executeRuntimeResourceMutation",
      "getRuntimeResourceMutationApproval",
      "getRuntimeResourceMutationExecution",
      "listRuntimeResourceMutationActivity"
    ]) {
      assert.match(openapiText, new RegExp(`operationId: ${operationId}`));
    }
    assert.match(openapiText, /CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true/);
    assert.match(openapiText, /CapabilityProviderManagementProjection/);
    assert.match(openapiText, /supportTier/);
    assert.match(openapiText, /catalog-only/);
    assert.match(openapiText, /provider-catalog/);
    assert.match(openapiText, /allowedLifecycleOperations/);
    assert.match(openapiText, /desiredState/);
    assert.match(openapiText, /observedState/);
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
    if (previous.config === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = previous.config;
    if (previous.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = previous.token;
    if (previous.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = previous.exposed;
    if (previous.resourceMutationsExposed === undefined) {
      delete process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED;
    } else {
      process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED =
        previous.resourceMutationsExposed;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

await run();
