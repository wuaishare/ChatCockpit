import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor,
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
import { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";
import { RuntimeProfileRegistry } from "../src/runtime/resources/runtime-profile-registry.ts";
import { RuntimeResourceInventoryAdapterRegistry } from "../src/runtime/resources/runtime-resource-inventory-adapter-registry.ts";

const OPT_IN_ENV = "TOKENPILOT_CODEX_SKILL_MUTATION_PROOF";
const OPT_IN_VALUE = "I_UNDERSTAND_REVERSIBLE_MUTATION";
const PROJECT_ID = "project_codex_skill_mutation_live";
const WORKSPACE_ID = "workspace_codex_skill_mutation_live";
const REPO_ID = "codex-skill-mutation-live";

interface CodexResourceRuntime {
  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]>;
  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]>;
  listCodexPlugins(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]>;
  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary>;
}

export interface CodexSkillMutationLiveRuntimeBundle {
  profile: RuntimeProfileDescriptor;
  runtime: CodexResourceRuntime;
  mutationAdapter: CodexSkillMutationAdapter;
  observedProviderMethods: Set<string>;
  close(): Promise<void>;
}

export interface CodexSkillMutationLiveProofOptions {
  workspaceRoot?: string;
  requireOptIn?: boolean;
  createRuntime?: (
    repositories: ContinuityRepositories,
    workspaceId: string
  ) => Promise<CodexSkillMutationLiveRuntimeBundle>;
}

export interface CodexSkillMutationLiveProofSummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableVersion: string | null;
  resourceId: string;
  resourceScope: "workspace" | "user";
  originalEnabled: boolean;
  transitionedEnabled: boolean;
  restoredEnabled: boolean;
  initialSnapshotId: string;
  transitionSnapshotId: string;
  finalSnapshotId: string;
  transitionVerification: "verified";
  restoreVerification: "verified";
  observedProviderMethods: string[];
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
  restoredFingerprintMatchesOriginal: true;
}

class TrackingResourceRuntime implements CodexResourceRuntime {
  constructor(
    private readonly delegate: CodexResourceRuntime,
    private readonly observed: Set<string>
  ) {}

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

class TrackingMutationClient extends CodexAppServerClient {
  constructor(
    command: string,
    private readonly observed: Set<string>
  ) {
    super({ command });
  }

  override request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    this.observed.add(method);
    return super.request<T>(method, params);
  }
}

async function createRealRuntime(
  repositories: ContinuityRepositories
): Promise<CodexSkillMutationLiveRuntimeBundle> {
  const observedProviderMethods = new Set<string>();
  const appServerAdapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces
  });
  const router = new RuntimeRouter(appServerAdapter);
  const profileAdapter = new CodexRuntimeProfileAdapter(router);
  const profiles = await profileAdapter.listProfiles();
  const profile = profiles[0];
  assert.ok(profile, "Codex Runtime Profile was not produced");

  return {
    profile,
    runtime: new TrackingResourceRuntime(router, observedProviderMethods),
    mutationAdapter: new CodexSkillMutationAdapter({
      workspaces: repositories.workspaces,
      createClient: (resolution) =>
        new TrackingMutationClient(resolution.command, observedProviderMethods)
    }),
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
    slug: "codex-skill-mutation-live",
    displayName: "Codex Skill Mutation Live Proof",
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

function selectCandidate(resources: RuntimeResourceDescriptor[]): RuntimeResourceDescriptor {
  const candidates = resources
    .filter(
      (resource) =>
        resource.kind === "skill" &&
        resource.installed === true &&
        resource.compatibilityStatus === "ready" &&
        typeof resource.enabled === "boolean" &&
        (resource.scope === "workspace" || resource.scope === "user")
    )
    .sort((left, right) => {
      const rank = (resource: RuntimeResourceDescriptor): number => {
        if (resource.scope === "workspace" && resource.enabled === false) return 0;
        if (resource.scope === "user" && resource.enabled === false) return 1;
        if (resource.scope === "workspace") return 2;
        return 3;
      };
      return (
        rank(left) - rank(right) ||
        left.externalId.localeCompare(right.externalId) ||
        left.id.localeCompare(right.id)
      );
    });
  const candidate = candidates[0];
  assert.ok(
    candidate,
    "No mutable workspace/user Codex Skill is available for the reversible live proof"
  );
  return candidate;
}

function operationFor(enabled: boolean): "skill.enable" | "skill.disable" {
  return enabled ? "skill.enable" : "skill.disable";
}

function expectedAfter(operation: "skill.enable" | "skill.disable"): boolean {
  return operation === "skill.enable";
}

function assertPublicSafe(value: unknown, workspaceRoot: string): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes(workspaceRoot), false, "Live proof leaked private Workspace path");
  for (const forbidden of [
    "SKILL.md",
    "authorizationUrl",
    "rawConfig",
    "marketplace.json"
  ]) {
    assert.equal(json.includes(forbidden), false, `Live proof leaked ${forbidden}`);
  }
}

function assertProviderSurface(methods: Set<string>): void {
  const allowed = new Set([
    "skills/list",
    "skills/config/write",
    "mcpServerStatus/list",
    "plugin/list",
    "config/read"
  ]);
  for (const method of methods) {
    assert.equal(allowed.has(method), true, `Unexpected provider method observed: ${method}`);
  }
  assert.equal(methods.has("skills/list"), true);
  assert.equal(methods.has("skills/config/write"), true);
  assert.equal(methods.has("turn/start"), false);
}

function buildInventoryService(
  repositories: ContinuityRepositories,
  bundle: CodexSkillMutationLiveRuntimeBundle
): RuntimeResourceInventoryService {
  const adapter = new CodexResourceInventoryAdapter(bundle.runtime);
  const inventoryAdapter: RuntimeResourceInventoryAdapter = {
    providerKind: adapter.providerKind,
    protocolKind: adapter.protocolKind,
    inventory: (input) => adapter.inventory(input),
    readTarget: (input) => adapter.readTarget(input)
  };
  const profiles = new RuntimeProfileRegistry([
    {
      sourceKind: "codex-skill-mutation-live-proof",
      listProfiles: async () => [bundle.profile]
    }
  ]);
  return new RuntimeResourceInventoryService(
    repositories,
    profiles,
    new RuntimeResourceInventoryAdapterRegistry([inventoryAdapter])
  );
}

async function inventoryFresh(
  inventory: RuntimeResourceInventoryService,
  profileId: string,
  key: string
) {
  return inventory.inventory({
    runtimeProfileId: profileId,
    workspaceId: WORKSPACE_ID,
    idempotencyKey: `${key}:${crypto.randomUUID()}`
  });
}

function proofContext(stage: "prepare" | "decide" | "execute", keyPrefix: string) {
  return buildOperationContext({
    requestId: `${keyPrefix}:${stage}:request`,
    actorType: "local-cli",
    actorId: null
  });
}

async function governedTransition(input: {
  service: RuntimeResourceMutationService;
  operation: "skill.enable" | "skill.disable";
  profileId: string;
  snapshotId: string;
  resource: RuntimeResourceDescriptor;
  keyPrefix: string;
}) {
  const prepared = await input.service.prepare(proofContext("prepare", input.keyPrefix), {
    operation: input.operation,
    runtimeProfileId: input.profileId,
    workspaceId: WORKSPACE_ID,
    resourceId: input.resource.id,
    expectedSnapshotId: input.snapshotId,
    expectedFingerprint: input.resource.fingerprint,
    idempotencyKey: `${input.keyPrefix}:prepare`
  });
  const approved = input.service.decide(proofContext("decide", input.keyPrefix), {
    approvalId: prepared.approval.id,
    expectedRevision: prepared.approval.revision,
    decision: "approved",
    idempotencyKey: `${input.keyPrefix}:decide`
  });
  const executed = await input.service.execute(proofContext("execute", input.keyPrefix), {
    approvalId: approved.approval.id,
    expectedApprovalRevision: approved.approval.revision,
    runtimeProfileId: input.profileId,
    workspaceId: WORKSPACE_ID,
    resourceId: input.resource.id,
    expectedFingerprint: input.resource.fingerprint,
    idempotencyKey: `${input.keyPrefix}:execute`
  });
  assert.equal(
    executed.execution.verificationStatus,
    "verified",
    `${input.operation} did not reach authoritative verified state`
  );
  return executed;
}

export async function runCodexSkillMutationLiveProof(
  options: CodexSkillMutationLiveProofOptions = {}
): Promise<CodexSkillMutationLiveProofSummary> {
  if (
    options.requireOptIn !== false &&
    process.env[OPT_IN_ENV] !== OPT_IN_VALUE
  ) {
    throw new Error(
      `Refusing real Codex Skill mutation without ${OPT_IN_ENV}=${OPT_IN_VALUE}`
    );
  }

  const workspaceRoot = fs.realpathSync(options.workspaceRoot ?? process.cwd());
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  createWorkspaceTruth(repositories, workspaceRoot);

  let bundle: CodexSkillMutationLiveRuntimeBundle | null = null;
  let original: RuntimeResourceDescriptor | null = null;
  let primaryError: unknown = null;
  let transitionExecution: Awaited<ReturnType<typeof governedTransition>> | null = null;
  let restoreExecution: Awaited<ReturnType<typeof governedTransition>> | null = null;
  let transitionSnapshotId: string | null = null;
  let finalSnapshotId: string | null = null;
  let finalResource: RuntimeResourceDescriptor | null = null;

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

    const inventory = buildInventoryService(repositories, bundle);
    const mutation = new RuntimeResourceMutationService(
      repositories,
      inventory,
      bundle.mutationAdapter
    );
    const initial = await inventoryFresh(
      inventory,
      bundle.profile.id,
      "codex-skill-mutation-live:initial"
    );
    original = selectCandidate(initial.resources);
    assert.ok(original.scope === "workspace" || original.scope === "user");
    assert.equal(typeof original.enabled, "boolean");

    try {
      const transitionOperation = operationFor(!original.enabled);
      transitionExecution = await governedTransition({
        service: mutation,
        operation: transitionOperation,
        profileId: bundle.profile.id,
        snapshotId: initial.snapshot.id,
        resource: original,
        keyPrefix: `codex-skill-mutation-live:transition:${crypto.randomUUID()}`
      });
      const transitioned = await inventoryFresh(
        inventory,
        bundle.profile.id,
        "codex-skill-mutation-live:transitioned"
      );
      transitionSnapshotId = transitioned.snapshot.id;
      const transitionedResource = transitioned.resources.find(
        (resource) => resource.id === original!.id
      );
      assert.ok(transitionedResource, "Mutated Codex Skill disappeared after transition");
      assert.equal(
        transitionedResource.enabled,
        expectedAfter(transitionOperation),
        "Authoritative transition inventory does not match requested Skill state"
      );

      const restoreOperation = operationFor(original.enabled);
      restoreExecution = await governedTransition({
        service: mutation,
        operation: restoreOperation,
        profileId: bundle.profile.id,
        snapshotId: transitioned.snapshot.id,
        resource: transitionedResource,
        keyPrefix: `codex-skill-mutation-live:restore:${crypto.randomUUID()}`
      });
      const restored = await inventoryFresh(
        inventory,
        bundle.profile.id,
        "codex-skill-mutation-live:restored"
      );
      finalSnapshotId = restored.snapshot.id;
      finalResource = restored.resources.find((resource) => resource.id === original!.id) ?? null;
      assert.ok(finalResource, "Restored Codex Skill disappeared from authoritative inventory");
      assert.equal(finalResource.enabled, original.enabled, "Codex Skill state was not restored");
      assert.equal(
        finalResource.fingerprint,
        original.fingerprint,
        "Codex Skill fingerprint did not return to its original value after restore"
      );

      assertProviderSurface(bundle.observedProviderMethods);
      const summary: CodexSkillMutationLiveProofSummary = {
        ok: true,
        providerKind: "codex",
        protocolKind: "native-app-server",
        executableVersion: bundle.profile.executableVersion,
        resourceId: original.id,
        resourceScope: original.scope,
        originalEnabled: original.enabled,
        transitionedEnabled: !original.enabled,
        restoredEnabled: finalResource.enabled,
        initialSnapshotId: initial.snapshot.id,
        transitionSnapshotId,
        finalSnapshotId,
        transitionVerification: "verified",
        restoreVerification: "verified",
        observedProviderMethods: [...bundle.observedProviderMethods].sort(),
        turnStartObserved: false,
        privateWorkspacePathProjected: false,
        restoredFingerprintMatchesOriginal: true
      };
      assertPublicSafe(summary, workspaceRoot);
      return summary;
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (original && finalResource?.enabled !== original.enabled) {
        try {
          const current = await inventoryFresh(
            inventory,
            bundle.profile.id,
            "codex-skill-mutation-live:cleanup-current"
          );
          const currentResource = current.resources.find(
            (resource) => resource.id === original!.id
          );
          if (currentResource && currentResource.enabled !== original.enabled) {
            await governedTransition({
              service: mutation,
              operation: operationFor(original.enabled),
              profileId: bundle.profile.id,
              snapshotId: current.snapshot.id,
              resource: currentResource,
              keyPrefix: `codex-skill-mutation-live:cleanup:${crypto.randomUUID()}`
            });
          }
          const cleanupFinal = await inventoryFresh(
            inventory,
            bundle.profile.id,
            "codex-skill-mutation-live:cleanup-final"
          );
          const cleanupResource = cleanupFinal.resources.find(
            (resource) => resource.id === original!.id
          );
          if (!cleanupResource || cleanupResource.enabled !== original.enabled) {
            throw new Error("Governed cleanup could not restore the original Codex Skill state");
          }
        } catch (cleanupError) {
          if (primaryError) {
            throw new AggregateError(
              [primaryError, cleanupError],
              "Codex Skill mutation proof failed and governed restoration also failed"
            );
          }
          throw cleanupError;
        }
      }
    }
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
  runCodexSkillMutationLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_SKILL_MUTATION_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`CODEX_SKILL_MUTATION_LIVE_PROOF_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
