import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import { ServiceError } from "../src/application/service-error.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryAdapter
} from "../src/application/runtime-resource-types.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import {
  buildContinuityRepositories,
  type ContinuityRepositories
} from "../src/continuity/repositories/index.ts";
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
import { CodexPluginMutationAdapter } from "../src/runtime/resources/codex-plugin-mutation-adapter.ts";
import { CodexResourceInventoryAdapter } from "../src/runtime/resources/codex-resource-inventory-adapter.ts";
import { CodexRuntimeProfileAdapter } from "../src/runtime/resources/codex-runtime-profile-adapter.ts";
import { CodexSkillMutationAdapter } from "../src/runtime/resources/codex-skill-mutation-adapter.ts";
import { RuntimeProfileRegistry } from "../src/runtime/resources/runtime-profile-registry.ts";
import { RuntimeResourceInventoryAdapterRegistry } from "../src/runtime/resources/runtime-resource-inventory-adapter-registry.ts";

const OPT_IN_ENV = "TOKENPILOT_CODEX_PLUGIN_MUTATION_PROOF";
const OPT_IN_VALUE = "I_UNDERSTAND_REVERSIBLE_PLUGIN_MUTATION";
const PROJECT_ID = "project_codex_plugin_mutation_live";
const WORKSPACE_ID = "workspace_codex_plugin_mutation_live";
const REPO_ID = "codex-plugin-mutation-live";
const LIVE_CLIENT_TIMEOUT_MS = 60_000;

type PluginOperation = "plugin.install" | "plugin.uninstall";

interface CodexResourceRuntime {
  listCodexSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]>;
  listCodexMcpServers(): Promise<RuntimeMcpServerProjection[]>;
  listCodexPlugins(input?: RuntimePluginListInput): Promise<RuntimePluginProjection[]>;
  readCodexResourceConfigSummary(): Promise<RuntimeResourceConfigSummary>;
}

export interface CodexPluginMutationLiveRuntimeBundle {
  profile: RuntimeProfileDescriptor;
  runtime: CodexResourceRuntime;
  skillMutationAdapter: CodexSkillMutationAdapter;
  pluginMutationAdapter: CodexPluginMutationAdapter;
  observedProviderMethods: Set<string>;
  close(): Promise<void>;
}

export interface CodexPluginMutationLiveProofOptions {
  workspaceRoot?: string;
  requireOptIn?: boolean;
  pluginPostflightMaxAttempts?: number;
  pluginPostflightDelayMs?: number;
  createRuntime?: (
    repositories: ContinuityRepositories,
    workspaceId: string
  ) => Promise<CodexPluginMutationLiveRuntimeBundle>;
}

export interface CodexPluginMutationLiveProofSummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableVersion: string | null;
  originalInstalled: false;
  transitionedInstalled: true;
  restoredInstalled: false;
  transitionVerification: "verified";
  restoreVerification: "verified";
  observedProviderMethods: string[];
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
  restoredFingerprintMatchesOriginal: true;
}

class TrackingAppServerClient extends CodexAppServerClient {
  constructor(
    command: string,
    private readonly observed: Set<string>
  ) {
    super({ command, requestTimeoutMs: LIVE_CLIENT_TIMEOUT_MS });
  }

  override request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    this.observed.add(method);
    return super.request<T>(method, params);
  }
}

async function createRealRuntime(
  repositories: ContinuityRepositories
): Promise<CodexPluginMutationLiveRuntimeBundle> {
  const observedProviderMethods = new Set<string>();
  const appServerAdapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces,
    createClient: (resolution) =>
      new TrackingAppServerClient(resolution.command, observedProviderMethods)
  });
  const router = new RuntimeRouter(appServerAdapter);
  const profileAdapter = new CodexRuntimeProfileAdapter(router);
  const profiles = await profileAdapter.listProfiles();
  const profile = profiles[0];
  assert.ok(profile, "Codex Runtime Profile was not produced");

  return {
    profile,
    runtime: router,
    skillMutationAdapter: new CodexSkillMutationAdapter({
      workspaces: repositories.workspaces,
      createClient: (resolution) =>
        new TrackingAppServerClient(
          resolution.command,
          observedProviderMethods
        )
    }),
    pluginMutationAdapter: new CodexPluginMutationAdapter({
      workspaces: repositories.workspaces,
      createClient: (resolution) =>
        new TrackingAppServerClient(
          resolution.command,
          observedProviderMethods
        )
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
    slug: "codex-plugin-mutation-live",
    displayName: "Codex Plugin Mutation Live Proof",
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

function selectCandidate(
  resources: RuntimeResourceDescriptor[]
): RuntimeResourceDescriptor {
  const candidates = resources
    .filter((resource) => {
      if (
        resource.kind !== "plugin" ||
        resource.installed !== false ||
        resource.compatibilityStatus !== "ready"
      ) {
        return false;
      }
      const capabilities = new Set(resource.capabilities);
      return (
        capabilities.has("plugin:source:remote") &&
        capabilities.has("plugin:install-policy:available") &&
        capabilities.has("plugin:auth-policy:on-use") &&
        capabilities.has("plugin:installation-interstitial:false") &&
        capabilities.has("plugin:observed:catalog")
      );
    })
    .sort(
      (left, right) =>
        left.externalId.localeCompare(right.externalId) ||
        left.id.localeCompare(right.id)
    );
  const candidate = candidates[0];
  assert.ok(
    candidate,
    "No authoritative remote AVAILABLE ON_USE Codex Plugin with explicit no-interstitial policy is available for the reversible live proof"
  );
  return candidate;
}

function assertPublicSafe(value: unknown, workspaceRoot: string): void {
  const json = JSON.stringify(value);
  assert.equal(
    json.includes(workspaceRoot),
    false,
    "Live Plugin proof leaked private Workspace path"
  );
  for (const forbidden of [
    "marketplacePath",
    "remoteMarketplaceName",
    "sourceIdentityHash",
    "installUrl",
    "rawConfig",
    "pluginName",
    "externalId"
  ]) {
    assert.equal(
      json.includes(forbidden),
      false,
      `Live Plugin proof leaked ${forbidden}`
    );
  }
}

function assertProviderSurface(methods: Set<string>): void {
  const allowed = new Set([
    "config/read",
    "mcpServerStatus/list",
    "skills/list",
    "plugin/installed",
    "plugin/list",
    "plugin/install",
    "plugin/uninstall"
  ]);
  for (const method of methods) {
    assert.equal(
      allowed.has(method),
      true,
      `Unexpected provider method observed during Plugin proof: ${method}`
    );
  }
  for (const required of [
    "plugin/installed",
    "plugin/list",
    "plugin/install",
    "plugin/uninstall"
  ]) {
    assert.equal(methods.has(required), true, `Missing provider evidence ${required}`);
  }
  for (const forbidden of [
    "turn/start",
    "skills/config/write",
    "plugin/search",
    "marketplace/add",
    "marketplace/remove",
    "marketplace/upgrade",
    "mcpServer/oauth/login"
  ]) {
    assert.equal(methods.has(forbidden), false, `Forbidden provider method ${forbidden}`);
  }
}

function buildInventoryService(
  repositories: ContinuityRepositories,
  bundle: CodexPluginMutationLiveRuntimeBundle
): RuntimeResourceInventoryService {
  const adapter = new CodexResourceInventoryAdapter(bundle.runtime);
  const inventoryAdapter: RuntimeResourceInventoryAdapter = {
    providerKind: adapter.providerKind,
    protocolKind: adapter.protocolKind,
    inventory: (input) => adapter.inventory(input)
  };
  const profiles = new RuntimeProfileRegistry([
    {
      sourceKind: "codex-plugin-mutation-live-proof",
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

async function governedTransition(input: {
  service: RuntimeResourceMutationService;
  operation: PluginOperation;
  profileId: string;
  resource: RuntimeResourceDescriptor;
  keyPrefix: string;
}) {
  const prepared = await input.service.prepare({
    operation: input.operation,
    runtimeProfileId: input.profileId,
    workspaceId: WORKSPACE_ID,
    resourceId: input.resource.id,
    expectedFingerprint: input.resource.fingerprint,
    idempotencyKey: `${input.keyPrefix}:prepare`
  });
  const approved = input.service.decide({
    approvalId: prepared.approval.id,
    expectedRevision: prepared.approval.revision,
    decision: "approved",
    idempotencyKey: `${input.keyPrefix}:decide`
  });
  const executed = await input.service.execute({
    approvalId: approved.approval.id,
    expectedApprovalRevision: approved.approval.revision,
    runtimeProfileId: input.profileId,
    workspaceId: WORKSPACE_ID,
    resourceId: input.resource.id,
    expectedFingerprint: input.resource.fingerprint,
    idempotencyKey: `${input.keyPrefix}:execute`
  });
  if (executed.execution.verificationStatus !== "verified") {
    throw new ServiceError(
      executed.execution.errorCode ?? "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED",
      `${input.operation} did not reach authoritative verified state`
    );
  }
  return executed;
}

function proofErrorCode(error: unknown): string {
  if (error instanceof ServiceError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  if (error instanceof Error && error.name) return error.name;
  return "UNKNOWN_ERROR";
}

export function formatCodexPluginMutationProofFailure(error: unknown): string {
  if (error instanceof AggregateError) {
    const entries = error.errors.map((entry, index) => {
      const stage = index === 0 ? "primary" : index === 1 ? "cleanup" : `secondary-${index}`;
      return `${stage}=${proofErrorCode(entry)}`;
    });
    return entries.join(",");
  }
  return `primary=${proofErrorCode(error)}`;
}

export async function runCodexPluginMutationLiveProof(
  options: CodexPluginMutationLiveProofOptions = {}
): Promise<CodexPluginMutationLiveProofSummary> {
  if (
    options.requireOptIn !== false &&
    process.env[OPT_IN_ENV] !== OPT_IN_VALUE
  ) {
    throw new ServiceError(
      "CODEX_PLUGIN_MUTATION_PROOF_OPT_IN_REQUIRED",
      `Refusing real Codex Plugin mutation without ${OPT_IN_ENV}=${OPT_IN_VALUE}`
    );
  }

  const workspaceRoot = fs.realpathSync(options.workspaceRoot ?? process.cwd());
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  createWorkspaceTruth(repositories, workspaceRoot);

  let bundle: CodexPluginMutationLiveRuntimeBundle | null = null;
  let inventory: RuntimeResourceInventoryService | null = null;
  let mutation: RuntimeResourceMutationService | null = null;
  let original: RuntimeResourceDescriptor | null = null;
  let finalResource: RuntimeResourceDescriptor | null = null;
  let primaryError: unknown = null;

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

    inventory = buildInventoryService(repositories, bundle);
    mutation = new RuntimeResourceMutationService(
      repositories,
      inventory,
      bundle.skillMutationAdapter,
      {
        codexPlugins: bundle.pluginMutationAdapter,
        pluginPostflightMaxAttempts: options.pluginPostflightMaxAttempts,
        pluginPostflightDelayMs: options.pluginPostflightDelayMs
      }
    );
    const initial = await inventoryFresh(
      inventory,
      bundle.profile.id,
      "codex-plugin-mutation-live:initial"
    );
    original = selectCandidate(initial.resources);
    assert.equal(original.installed, false);

    try {
      const transition = await governedTransition({
        service: mutation,
        operation: "plugin.install",
        profileId: bundle.profile.id,
        resource: original,
        keyPrefix: `codex-plugin-mutation-live:install:${crypto.randomUUID()}`
      });
      assert.equal(transition.execution.providerMethod, "plugin/install");

      const transitioned = await inventoryFresh(
        inventory,
        bundle.profile.id,
        "codex-plugin-mutation-live:installed"
      );
      const transitionedResource = transitioned.resources.find(
        (resource) => resource.id === original!.id
      );
      assert.ok(
        transitionedResource,
        "Installed Codex Plugin disappeared from authoritative inventory"
      );
      assert.equal(
        transitionedResource.installed,
        true,
        "Authoritative inventory did not verify Plugin installation"
      );

      const restore = await governedTransition({
        service: mutation,
        operation: "plugin.uninstall",
        profileId: bundle.profile.id,
        resource: transitionedResource,
        keyPrefix: `codex-plugin-mutation-live:uninstall:${crypto.randomUUID()}`
      });
      assert.equal(restore.execution.providerMethod, "plugin/uninstall");

      const restored = await inventoryFresh(
        inventory,
        bundle.profile.id,
        "codex-plugin-mutation-live:restored"
      );
      finalResource =
        restored.resources.find((resource) => resource.id === original!.id) ??
        null;
      assert.ok(
        finalResource,
        "Uninstalled Codex Plugin lost its authoritative catalog Resource identity"
      );
      assert.equal(finalResource.installed, false, "Codex Plugin was not restored");
      assert.equal(
        finalResource.fingerprint,
        original.fingerprint,
        "Codex Plugin fingerprint did not return to its original value"
      );

      assertProviderSurface(bundle.observedProviderMethods);
      const summary: CodexPluginMutationLiveProofSummary = {
        ok: true,
        providerKind: "codex",
        protocolKind: "native-app-server",
        executableVersion: bundle.profile.executableVersion,
        originalInstalled: false,
        transitionedInstalled: true,
        restoredInstalled: false,
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
      if (original && inventory && mutation && bundle) {
        try {
          const current = await inventoryFresh(
            inventory,
            bundle.profile.id,
            "codex-plugin-mutation-live:cleanup-current"
          );
          const exact = current.resources.find(
            (resource) => resource.id === original!.id
          );
          const driftedInstalled = current.resources.find(
            (resource) =>
              resource.kind === "plugin" &&
              resource.externalId === original!.externalId &&
              resource.id !== original!.id &&
              resource.installed === true
          );
          if (driftedInstalled) {
            throw new ServiceError(
              "CODEX_PLUGIN_MUTATION_PROOF_CLEANUP_IDENTITY_DRIFT",
              "Governed cleanup refused a residual Plugin whose source identity drifted after approval"
            );
          }
          if (exact?.installed === true) {
            await governedTransition({
              service: mutation,
              operation: "plugin.uninstall",
              profileId: bundle.profile.id,
              resource: exact,
              keyPrefix: `codex-plugin-mutation-live:cleanup:${crypto.randomUUID()}`
            });
          }
          const cleanupFinal = await inventoryFresh(
            inventory,
            bundle.profile.id,
            "codex-plugin-mutation-live:cleanup-final"
          );
          const cleanupResource = cleanupFinal.resources.find(
            (resource) => resource.id === original!.id
          );
          if (
            !cleanupResource ||
            cleanupResource.installed !== false ||
            cleanupResource.fingerprint !== original.fingerprint
          ) {
            throw new ServiceError(
              "CODEX_PLUGIN_MUTATION_PROOF_CLEANUP_NOT_RESTORED",
              "Governed cleanup could not restore the original Codex Plugin Resource state"
            );
          }
        } catch (cleanupError) {
          if (primaryError) {
            throw new AggregateError(
              [primaryError, cleanupError],
              "Codex Plugin mutation proof failed and governed restoration also failed"
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
  runCodexPluginMutationLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_PLUGIN_MUTATION_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      process.stderr.write(
        `CODEX_PLUGIN_MUTATION_LIVE_PROOF_FAILED: ${formatCodexPluginMutationProofFailure(error)}\n`
      );
      process.exitCode = 1;
    });
}
