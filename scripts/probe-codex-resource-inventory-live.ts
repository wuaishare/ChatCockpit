import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceInventoryAdapter
} from "../src/application/runtime-resource-types.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories, type ContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { runtimeResourceInventoryProjectionSchema } from "../src/contracts/runtime-resources.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
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

const PROJECT_ID = "project_codex_resource_live";
const WORKSPACE_ID = "workspace_codex_resource_live";
const REPO_ID = "codex-resource-live";

interface CodexResourceRuntime {
  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]>;
  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]>;
  listCodexPlugins(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]>;
  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary>;
}

interface LiveRuntimeBundle {
  profile: RuntimeProfileDescriptor;
  runtime: CodexResourceRuntime;
  close(): Promise<void>;
}

export interface CodexResourceInventoryLiveProofOptions {
  workspaceRoot?: string;
  createRuntime?: (
    repositories: ContinuityRepositories,
    workspaceId: string
  ) => Promise<LiveRuntimeBundle>;
}

export interface CodexResourceInventoryLiveProofSummary {
  ok: true;
  providerKind: string;
  protocolKind: string;
  executableVersion: string | null;
  compatibilityStatus: string;
  snapshotStatus: string;
  skillCount: number;
  mcpServerCount: number;
  pluginCount: number;
  adapterCount: number;
  agentCount: number;
  diagnosticsReady: string[];
  diagnosticsDegraded: string[];
  diagnosticsFailed: string[];
  readSurfacesObserved: string[];
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
}

class TrackingResourceRuntime implements CodexResourceRuntime {
  readonly observed = new Set<string>();

  constructor(private readonly delegate: CodexResourceRuntime) {}

  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]> {
    this.observed.add("skills/list");
    return this.delegate.listCodexSkills(input);
  }

  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]> {
    this.observed.add("mcpServerStatus/list");
    return this.delegate.listCodexMcpServers();
  }

  listCodexPlugins(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]> {
    this.observed.add("plugin/list");
    return this.delegate.listCodexPlugins(input);
  }

  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary> {
    this.observed.add("config/read");
    return this.delegate.readCodexResourceConfigSummary();
  }
}

async function createRealRuntime(
  repositories: ContinuityRepositories
): Promise<LiveRuntimeBundle> {
  const adapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces
  });
  const router = new RuntimeRouter(adapter);
  const profileAdapter = new CodexRuntimeProfileAdapter(router);
  const profiles = await profileAdapter.listProfiles();
  const profile = profiles[0];
  assert.ok(profile, "Codex Runtime Profile was not produced");
  return {
    profile,
    runtime: router,
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
    slug: "codex-resource-live",
    displayName: "Codex Resource Inventory Live Proof",
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

export async function runCodexResourceInventoryLiveProof(
  options: CodexResourceInventoryLiveProofOptions = {}
): Promise<CodexResourceInventoryLiveProofSummary> {
  const workspaceRoot = fs.realpathSync(options.workspaceRoot ?? process.cwd());
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  createWorkspaceTruth(repositories, workspaceRoot);

  let bundle: LiveRuntimeBundle | null = null;
  try {
    bundle = options.createRuntime
      ? await options.createRuntime(repositories, WORKSPACE_ID)
      : await createRealRuntime(repositories);

    assert.equal(bundle.profile.providerKind, "codex");
    assert.equal(bundle.profile.protocolKind, "native-app-server");
    assert.equal(
      ["ready", "degraded"].includes(bundle.profile.compatibilityStatus),
      true,
      `Codex Runtime Profile is ${bundle.profile.compatibilityStatus}: ${bundle.profile.publicReason ?? "no public reason"}`
    );

    const trackingRuntime = new TrackingResourceRuntime(bundle.runtime);
    const liveInventoryAdapter = new CodexResourceInventoryAdapter(trackingRuntime);
    const liveProjection = await liveInventoryAdapter.inventory({
      profile: bundle.profile,
      workspaceId: WORKSPACE_ID
    });
    const projectionValidation =
      runtimeResourceInventoryProjectionSchema.safeParse(liveProjection);
    if (!projectionValidation.success) {
      const issues = projectionValidation.error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join(".") || "projection"}: ${issue.code} ${issue.message}`)
        .join("; ");
      throw new Error(`Live Codex Resource projection failed public schema validation: ${issues}`);
    }
    const resourceIdCounts = new Map<string, number>();
    for (const resource of projectionValidation.data.resources) {
      resourceIdCounts.set(resource.id, (resourceIdCounts.get(resource.id) ?? 0) + 1);
    }
    const duplicateIds = [...resourceIdCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id);
    if (duplicateIds.length > 0) {
      const duplicateResources = projectionValidation.data.resources
        .filter((resource) => duplicateIds.includes(resource.id))
        .slice(0, 12)
        .map((resource) => `${resource.kind}:${resource.externalId}`)
        .join(", ");
      throw new Error(`Live Codex Resource projection contains duplicate identities: ${duplicateResources}`);
    }
    const inventoryAdapter: RuntimeResourceInventoryAdapter = {
      providerKind: liveInventoryAdapter.providerKind,
      protocolKind: liveInventoryAdapter.protocolKind,
      inventory: async () => projectionValidation.data
    };
    const profiles = new RuntimeProfileRegistry([
      {
        sourceKind: "codex-live-proof",
        listProfiles: async () => [bundle!.profile]
      }
    ]);
    const service = new RuntimeResourceInventoryService(
      repositories,
      profiles,
      new RuntimeResourceInventoryAdapterRegistry([inventoryAdapter])
    );

    const result = await service.inventory({
      runtimeProfileId: bundle.profile.id,
      workspaceId: WORKSPACE_ID,
      idempotencyKey: "codex-resource-live-proof"
    });

    const diagnosticBySource = new Map(
      result.diagnostics.map((diagnostic) => [diagnostic.source, diagnostic])
    );
    for (const source of ["codex-skills", "codex-mcp", "codex-plugins", "codex-config"]) {
      assert.equal(
        diagnosticBySource.get(source)?.status,
        "ready",
        `${source} live inventory is not ready: ${diagnosticBySource.get(source)?.message ?? "missing diagnostic"}`
      );
    }
    assert.equal(
      ["ready", "partial"].includes(result.snapshot.status),
      true,
      `Unexpected Runtime Resource snapshot status: ${result.snapshot.status}`
    );
    if (result.snapshot.status === "partial") {
      const degradedDiagnostics = result.diagnostics.filter(
        (diagnostic) => diagnostic.status === "degraded"
      );
      assert.equal(
        degradedDiagnostics.length > 0,
        true,
        "Partial live snapshot requires an explicit degraded diagnostic"
      );
      assert.equal(
        degradedDiagnostics.every((diagnostic) =>
          ["codex-resource-budget", "codex-resource-deduplication"].includes(
            diagnostic.source
          )
        ),
        true,
        "Partial live snapshot is only accepted for explicit bounded/deduplicated public projection diagnostics"
      );
    }
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.status === "failed"),
      false,
      "Live Codex Resource Inventory must not contain failed source diagnostics"
    );
    assert.equal(result.replayed, false);
    assert.equal(result.snapshot.runtimeProfileId, bundle.profile.id);
    assert.equal(result.snapshot.items.length, result.resources.length);
    assert.deepEqual(
      [...trackingRuntime.observed].sort(),
      ["config/read", "mcpServerStatus/list", "plugin/list", "skills/list"].sort()
    );

    const publicJson = JSON.stringify({
      profile: result.profile,
      resources: result.resources,
      diagnostics: result.diagnostics,
      snapshot: result.snapshot
    });
    assert.equal(
      publicJson.includes(workspaceRoot),
      false,
      "Runtime Resource public projection leaked the private Workspace path"
    );
    for (const forbidden of [
      "SKILL.md",
      "marketplace.json",
      "rawConfig",
      "inputSchema"
    ]) {
      assert.equal(publicJson.includes(forbidden), false, `Live projection leaked ${forbidden}`);
    }

    const counts = new Map<string, number>();
    for (const resource of result.resources) {
      counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
    }

    return {
      ok: true,
      providerKind: result.profile.providerKind,
      protocolKind: result.profile.protocolKind,
      executableVersion: result.profile.executableVersion,
      compatibilityStatus: result.profile.compatibilityStatus,
      snapshotStatus: result.snapshot.status,
      skillCount: counts.get("skill") ?? 0,
      mcpServerCount: counts.get("mcp-server") ?? 0,
      pluginCount: counts.get("plugin") ?? 0,
      adapterCount: counts.get("runtime-adapter") ?? 0,
      agentCount: counts.get("acp-agent") ?? 0,
      diagnosticsReady: result.diagnostics
        .filter((diagnostic) => diagnostic.status === "ready")
        .map((diagnostic) => diagnostic.source)
        .sort(),
      diagnosticsDegraded: result.diagnostics
        .filter((diagnostic) => diagnostic.status === "degraded")
        .map((diagnostic) => diagnostic.source)
        .sort(),
      diagnosticsFailed: result.diagnostics
        .filter((diagnostic) => diagnostic.status === "failed")
        .map((diagnostic) => diagnostic.source)
        .sort(),
      readSurfacesObserved: [...trackingRuntime.observed].sort(),
      turnStartObserved: false,
      privateWorkspacePathProjected: false
    };
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
  runCodexResourceInventoryLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_RESOURCE_INVENTORY_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`CODEX_RESOURCE_INVENTORY_LIVE_PROOF_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
