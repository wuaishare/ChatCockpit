import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildRuntimeResourceId } from "../src/application/runtime-resource-hash.ts";
import { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceInventoryAdapter
} from "../src/application/runtime-resource-types.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import {
  buildContinuityRepositories,
  type ContinuityRepositories
} from "../src/continuity/repositories/index.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type {
  RuntimeMcpServerProjection,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection
} from "../src/runtime/codex/runtime-adapter.ts";
import { CodexResourceInventoryAdapter } from "../src/runtime/resources/codex-resource-inventory-adapter.ts";
import { CodexRuntimeProfileAdapter } from "../src/runtime/resources/codex-runtime-profile-adapter.ts";
import { RuntimeProfileRegistry } from "../src/runtime/resources/runtime-profile-registry.ts";
import { RuntimeResourceInventoryAdapterRegistry } from "../src/runtime/resources/runtime-resource-inventory-adapter-registry.ts";

const PROJECT_ID = "project_codex_plugin_inventory_live";
const WORKSPACE_ID = "workspace_codex_plugin_inventory_live";
const REPO_ID = "codex-plugin-inventory-live";

interface CodexPluginInventoryRuntime {
  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]>;
  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]>;
  listCodexPlugins(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]>;
  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary>;
}

export interface CodexPluginInventoryLiveRuntimeBundle {
  profile: RuntimeProfileDescriptor;
  runtime: CodexPluginInventoryRuntime;
  observedProviderMethods: Set<string>;
  close(): Promise<void>;
}

export interface CodexPluginInventoryLiveProofOptions {
  workspaceRoot?: string;
  createRuntime?: (
    repositories: ContinuityRepositories,
    workspaceId: string
  ) => Promise<CodexPluginInventoryLiveRuntimeBundle>;
}

export interface CodexPluginInventoryLiveProofSummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableVersion: string | null;
  snapshotStatus: string;
  providerInstalledUniqueCount: number;
  authoritativeInstalledResourceCount: number;
  authoritativePluginResourceCount: number;
  missingInstalledResourceCount: 0;
  diagnosticsFailed: string[];
  observedProviderMethods: string[];
  mutationMethodsObserved: [];
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
}

class TrackingMutationSurfaceClient extends CodexAppServerClient {
  constructor(
    command: string,
    private readonly observed: Set<string>
  ) {
    super({ command, requestTimeoutMs: 60_000 });
  }

  override request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    this.observed.add(method);
    return super.request<T>(method, params);
  }
}

class TrackingPluginRuntime implements CodexPluginInventoryRuntime {
  lastPlugins: RuntimePluginProjection[] = [];

  constructor(private readonly delegate: CodexPluginInventoryRuntime) {}

  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]> {
    return this.delegate.listCodexSkills(input);
  }

  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]> {
    return this.delegate.listCodexMcpServers();
  }

  async listCodexPlugins(
    input?: RuntimePluginListInput
  ): Promise<RuntimePluginProjection[]> {
    this.lastPlugins = await this.delegate.listCodexPlugins(input);
    return this.lastPlugins;
  }

  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary> {
    return this.delegate.readCodexResourceConfigSummary();
  }
}

async function createRealRuntime(
  repositories: ContinuityRepositories
): Promise<CodexPluginInventoryLiveRuntimeBundle> {
  const observedProviderMethods = new Set<string>();
  const appServerAdapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces,
    createClient: (resolution) =>
      new TrackingMutationSurfaceClient(
        resolution.command,
        observedProviderMethods
      )
  });
  const router = new RuntimeRouter(appServerAdapter);
  const profileAdapter = new CodexRuntimeProfileAdapter(router);
  const profiles = await profileAdapter.listProfiles();
  const profile = profiles[0];
  assert.ok(profile, "Codex Runtime Profile was not produced");
  return {
    profile,
    runtime: router,
    observedProviderMethods,
    close: () => router.close()
  };
}

function createWorkspaceTruth(
  repositories: ContinuityRepositories,
  workspaceRoot: string
): void {
  const now = new Date().toISOString();
  const project = repositories.projects.create({
    id: PROJECT_ID,
    slug: "codex-plugin-inventory-live",
    displayName: "Codex Plugin Inventory Live Proof",
    now
  });
  repositories.workspaces.create({
    id: WORKSPACE_ID,
    projectId: project.id,
    repoId: REPO_ID,
    privatePath: workspaceRoot,
    branch: null,
    headCommit: null,
    dirty: false,
    status: "ready",
    now
  });
}

function installedResourceId(
  profile: RuntimeProfileDescriptor,
  plugin: RuntimePluginProjection
): string {
  const externalId = `plugin:${plugin.id}`;
  const identityExternalId = plugin.sourceIdentityHash
    ? `${externalId}:source:${plugin.sourceIdentityHash}`
    : externalId;
  return buildRuntimeResourceId({
    runtimeProfileId: profile.id,
    kind: "plugin",
    externalId: identityExternalId
  });
}

function assertProviderSurface(methods: Set<string>): string[] {
  const allowed = new Set([
    "skills/list",
    "mcpServerStatus/list",
    "plugin/installed",
    "plugin/list",
    "config/read"
  ]);
  const forbiddenMutationMethods = [
    "plugin/install",
    "plugin/uninstall",
    "marketplace/add",
    "marketplace/remove",
    "marketplace/upgrade",
    "plugin/search",
    "turn/start"
  ];
  for (const method of methods) {
    assert.equal(
      allowed.has(method),
      true,
      `Unexpected provider method observed during Plugin inventory proof: ${method}`
    );
  }
  assert.equal(methods.has("plugin/installed"), true);
  assert.equal(methods.has("plugin/list"), true);
  for (const method of forbiddenMutationMethods) {
    assert.equal(methods.has(method), false, `Forbidden provider method observed: ${method}`);
  }
  return forbiddenMutationMethods.filter((method) => methods.has(method));
}

function assertPublicSafe(value: unknown, workspaceRoot: string): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes(workspaceRoot), false, "Plugin live proof leaked Workspace path");
  for (const forbidden of [
    "marketplace.json",
    "sourceIdentityHash",
    "remoteMarketplaceName",
    "authorizationUrl",
    "rawConfig"
  ]) {
    assert.equal(json.includes(forbidden), false, `Plugin live proof leaked ${forbidden}`);
  }
}

export async function runCodexPluginInventoryLiveProof(
  options: CodexPluginInventoryLiveProofOptions = {}
): Promise<CodexPluginInventoryLiveProofSummary> {
  const workspaceRoot = fs.realpathSync(options.workspaceRoot ?? process.cwd());
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  createWorkspaceTruth(repositories, workspaceRoot);

  let bundle: CodexPluginInventoryLiveRuntimeBundle | null = null;
  try {
    bundle = options.createRuntime
      ? await options.createRuntime(repositories, WORKSPACE_ID)
      : await createRealRuntime(repositories);
    assert.equal(bundle.profile.providerKind, "codex");
    assert.equal(bundle.profile.protocolKind, "native-app-server");
    assert.equal(
      ["ready", "degraded"].includes(bundle.profile.compatibilityStatus),
      true,
      `Codex Runtime Profile is ${bundle.profile.compatibilityStatus}`
    );

    const trackingRuntime = new TrackingPluginRuntime(bundle.runtime);
    const adapter = new CodexResourceInventoryAdapter(trackingRuntime);
    const inventoryAdapter: RuntimeResourceInventoryAdapter = {
      providerKind: adapter.providerKind,
      protocolKind: adapter.protocolKind,
      inventory: (input) => adapter.inventory(input)
    };
    const profiles = new RuntimeProfileRegistry([
      {
        sourceKind: "codex-plugin-inventory-live-proof",
        listProfiles: async () => [bundle!.profile]
      }
    ]);
    const inventory = new RuntimeResourceInventoryService(
      repositories,
      profiles,
      new RuntimeResourceInventoryAdapterRegistry([inventoryAdapter])
    );

    const result = await inventory.inventory({
      runtimeProfileId: bundle.profile.id,
      workspaceId: WORKSPACE_ID,
      idempotencyKey: `codex-plugin-inventory-live:${crypto.randomUUID()}`
    });

    const installedPlugins = trackingRuntime.lastPlugins.filter(
      (plugin) => plugin.installed === true
    );
    const expectedInstalledResourceIds = new Set(
      installedPlugins.map((plugin) => installedResourceId(bundle!.profile, plugin))
    );
    const authoritativeInstalledResources = result.resources.filter(
      (resource) => resource.kind === "plugin" && resource.installed === true
    );
    const authoritativeInstalledResourceIds = new Set(
      authoritativeInstalledResources.map((resource) => resource.id)
    );
    const missingInstalledResourceIds = [...expectedInstalledResourceIds].filter(
      (resourceId) => !authoritativeInstalledResourceIds.has(resourceId)
    );
    assert.equal(
      missingInstalledResourceIds.length,
      0,
      `Authoritative Plugin Resource snapshot omitted ${missingInstalledResourceIds.length} installed provider identities`
    );
    assert.equal(
      authoritativeInstalledResourceIds.size,
      expectedInstalledResourceIds.size,
      "Authoritative installed Plugin Resource count diverged from provider installed truth"
    );

    const diagnosticsFailed = result.diagnostics
      .filter((diagnostic) => diagnostic.status === "failed")
      .map((diagnostic) => diagnostic.source)
      .sort();
    assert.deepEqual(diagnosticsFailed, []);
    const mutationMethodsObserved = assertProviderSurface(
      bundle.observedProviderMethods
    );
    assert.deepEqual(mutationMethodsObserved, []);

    const summary: CodexPluginInventoryLiveProofSummary = {
      ok: true,
      providerKind: "codex",
      protocolKind: "native-app-server",
      executableVersion: bundle.profile.executableVersion,
      snapshotStatus: result.snapshot.status,
      providerInstalledUniqueCount: expectedInstalledResourceIds.size,
      authoritativeInstalledResourceCount: authoritativeInstalledResourceIds.size,
      authoritativePluginResourceCount: result.resources.filter(
        (resource) => resource.kind === "plugin"
      ).length,
      missingInstalledResourceCount: 0,
      diagnosticsFailed,
      observedProviderMethods: [...bundle.observedProviderMethods].sort(),
      mutationMethodsObserved: [],
      turnStartObserved: false,
      privateWorkspacePathProjected: false
    };
    assertPublicSafe(summary, workspaceRoot);
    return summary;
  } finally {
    await bundle?.close().catch(() => undefined);
    database.close();
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return invoked === fs.realpathSync(new URL(import.meta.url).pathname);
}

if (isMainModule()) {
  runCodexPluginInventoryLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_PLUGIN_INVENTORY_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`CODEX_PLUGIN_INVENTORY_LIVE_PROOF_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
