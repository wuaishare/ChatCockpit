import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type {
  RuntimeResourceDescriptor,
  RuntimeResourceMutationOperation
} from "../web/src/types.ts";
import { runCodexPluginInventoryLiveProof } from "./probe-codex-plugin-inventory-live.ts";
import {
  createRuntimeResourceRestLiveHarness,
  type RuntimeResourceRestLiveHarness
} from "./test-support/runtime-resource-rest-live.ts";

const OPT_IN_ENV = "CHATCOCKPIT_CODEX_PLUGIN_MCP_MUTATION_PROOF";
const OPT_IN_VALUE = "I_UNDERSTAND_REVERSIBLE_MCP_OPERATOR_MUTATION";

type PluginOperation = "plugin.install" | "plugin.uninstall";

interface InventoryResponse {
  ok: true;
  snapshot: { id: string };
  resources: RuntimeResourceDescriptor[];
  mutationWritesEnabled: boolean;
}

interface ApprovalProjection {
  id: string;
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  beforeFingerprint: string;
  status: string;
  revision: number;
  requestedActor: { type: string; identityHash: string | null } | null;
  decidedActor: { type: string; identityHash: string | null } | null;
}

interface ExecutionProjection {
  id: string;
  approvalId: string;
  verificationStatus: string;
  executedActor: { type: string; identityHash: string | null } | null;
}

interface GovernedTransitionResult {
  approval: ApprovalProjection;
  execution: ExecutionProjection;
  prepareDurationMs: number;
  executeDurationMs: number;
}

export interface CodexPluginMutationMcpLiveProofOptions {
  workspaceRoot?: string;
  requireOptIn?: boolean;
  createHarness?: (
    workspaceRoot: string
  ) => Promise<RuntimeResourceRestLiveHarness>;
}

export interface CodexPluginMutationMcpLiveProofSummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableVersion: string | null;
  originalInstalled: false;
  transitionedInstalled: true;
  restoredInstalled: false;
  transitionVerification: "verified";
  restoreVerification: "verified";
  approvalsPersisted: 2;
  executionsPersisted: 2;
  crossSurfaceProvenanceVerified: true;
  installWriteCount: 1;
  uninstallWriteCount: 1;
  installPrepareDurationMs: number;
  installExecuteDurationMs: number;
  uninstallPrepareDurationMs: number;
  uninstallExecuteDurationMs: number;
  initialProviderInstalledUniqueCount: number;
  finalProviderInstalledUniqueCount: number;
  initialAuthoritativeInstalledResourceCount: number;
  finalAuthoritativeInstalledResourceCount: number;
  finalMissingInstalledResourceCount: 0;
  observedProviderMethods: string[];
  mutationMethodsObserved: string[];
  forbiddenProviderMethodObserved: false;
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
  restoredFingerprintMatchesOriginal: true;
}

function selectCandidate(resources: RuntimeResourceDescriptor[]): RuntimeResourceDescriptor {
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
    "No safe remote AVAILABLE ON_USE Codex Plugin is available for the MCP/operator live proof"
  );
  return candidate;
}

function writeCount(calls: string[], method: "plugin/install" | "plugin/uninstall"): number {
  return calls.filter((entry) => entry === method).length;
}

function mutationMethods(calls: string[]): string[] {
  return calls.filter(
    (entry) =>
      entry === "plugin/install" ||
      entry === "plugin/uninstall" ||
      entry === "plugin/search" ||
      entry === "turn/start" ||
      entry.startsWith("marketplace/")
  );
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
    assert.equal(allowed.has(method), true, `Unexpected provider method: ${method}`);
  }
  assert.equal(methods.has("plugin/install"), true);
  assert.equal(methods.has("plugin/uninstall"), true);
  assert.equal(methods.has("turn/start"), false);
  assert.equal(methods.has("plugin/search"), false);
  assert.equal(
    [...methods].some((method) => method.startsWith("marketplace/")),
    false
  );
}

function assertPublicSafe(value: unknown, workspaceRoot: string): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes(workspaceRoot), false, "MCP/operator proof leaked private path");
  for (const forbidden of [
    "remotePluginId",
    "remoteMarketplaceName",
    "marketplacePath",
    "installUrl",
    "sourceIdentityHash",
    "pluginName",
    "rawConfig",
    "requestedRequestIdentityHash",
    "decidedRequestIdentityHash",
    "executedRequestIdentityHash"
  ]) {
    assert.equal(json.includes(forbidden), false, `MCP/operator proof leaked ${forbidden}`);
  }
}

async function freshInventory(
  harness: RuntimeResourceRestLiveHarness,
  stage: string
): Promise<InventoryResponse> {
  return harness.rest<InventoryResponse>("POST", "/api/resources/inventory", {
    runtimeProfileId: harness.profile.id,
    workspaceId: harness.workspaceId,
    idempotencyKey: `plugin-mcp-live:${stage}:${crypto.randomUUID()}`
  });
}

async function governedTransition(
  harness: RuntimeResourceRestLiveHarness,
  resource: RuntimeResourceDescriptor,
  snapshotId: string,
  operation: PluginOperation,
  keyPrefix: string
): Promise<GovernedTransitionResult> {
  const method = operation === "plugin.install" ? "plugin/install" : "plugin/uninstall";
  const writesBefore = writeCount(harness.providerMethodCalls, method);

  const prepareStartedAt = Date.now();
  const prepared = await harness.mcp<{
    ok: true;
    approval: ApprovalProjection;
    replayed: boolean;
  }>("chatcockpit.resources.mutation.prepare", {
    operation,
    runtimeProfileId: harness.profile.id,
    workspaceId: harness.workspaceId,
    resourceId: resource.id,
    expectedSnapshotId: snapshotId,
    expectedFingerprint: resource.fingerprint,
    idempotencyKey: `${keyPrefix}:prepare`
  });
  const prepareDurationMs = Date.now() - prepareStartedAt;
  assert.equal(prepared.replayed, false);
  assert.equal(prepared.approval.status, "pending");
  assert.equal(prepared.approval.requestedActor?.type, "remote-mcp");
  assert.equal(prepared.approval.decidedActor, null);
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore);

  const inspectedPending = await harness.mcp<{
    ok: true;
    approval: ApprovalProjection;
  }>("chatcockpit.resources.mutation.inspect", {
    target: "approval",
    workspaceId: harness.workspaceId,
    approvalId: prepared.approval.id
  });
  assert.equal(inspectedPending.approval.status, "pending");
  assert.equal(inspectedPending.approval.requestedActor?.type, "remote-mcp");
  assert.equal(inspectedPending.approval.decidedActor, null);

  const decision = await harness.rest<{
    ok: true;
    approval: ApprovalProjection;
    replayed: boolean;
  }>("POST", "/api/resources/mutations/decision", {
    approvalId: prepared.approval.id,
    expectedRevision: prepared.approval.revision,
    decision: "approved",
    idempotencyKey: `${keyPrefix}:decision`
  });
  assert.equal(decision.replayed, false);
  assert.equal(decision.approval.status, "approved");
  assert.equal(decision.approval.requestedActor?.type, "remote-mcp");
  assert.equal(decision.approval.decidedActor?.type, "rest-api");
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore);

  const inspectedApproved = await harness.mcp<{
    ok: true;
    approval: ApprovalProjection;
  }>("chatcockpit.resources.mutation.inspect", {
    target: "approval",
    workspaceId: harness.workspaceId,
    approvalId: prepared.approval.id
  });
  assert.equal(inspectedApproved.approval.status, "approved");
  assert.equal(inspectedApproved.approval.decidedActor?.type, "rest-api");

  const executeBody = {
    approvalId: decision.approval.id,
    expectedApprovalRevision: decision.approval.revision,
    runtimeProfileId: harness.profile.id,
    workspaceId: harness.workspaceId,
    resourceId: resource.id,
    expectedFingerprint: resource.fingerprint,
    idempotencyKey: `${keyPrefix}:execute`
  };
  const executeStartedAt = Date.now();
  const executed = await harness.mcp<{
    ok: true;
    approval: ApprovalProjection;
    execution: ExecutionProjection;
    replayed: boolean;
  }>("chatcockpit.resources.mutation.execute", executeBody);
  const executeDurationMs = Date.now() - executeStartedAt;
  assert.equal(executed.replayed, false);
  assert.equal(executed.execution.verificationStatus, "verified");
  assert.equal(executed.execution.executedActor?.type, "remote-mcp");
  assert.equal(executed.approval.requestedActor?.type, "remote-mcp");
  assert.equal(executed.approval.decidedActor?.type, "rest-api");
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore + 1);

  const replay = await harness.mcp<{
    ok: true;
    execution: ExecutionProjection;
    replayed: boolean;
  }>("chatcockpit.resources.mutation.execute", executeBody);
  assert.equal(replay.replayed, true);
  assert.equal(replay.execution.id, executed.execution.id);
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore + 1);

  const inspectedExecution = await harness.mcp<{
    ok: true;
    execution: ExecutionProjection;
  }>("chatcockpit.resources.mutation.inspect", {
    target: "execution",
    workspaceId: harness.workspaceId,
    executionId: executed.execution.id
  });
  assert.equal(inspectedExecution.execution.verificationStatus, "verified");
  assert.equal(inspectedExecution.execution.executedActor?.type, "remote-mcp");

  return {
    approval: executed.approval,
    execution: executed.execution,
    prepareDurationMs,
    executeDurationMs
  };
}

export async function runCodexPluginMutationMcpLiveProof(
  options: CodexPluginMutationMcpLiveProofOptions = {}
): Promise<CodexPluginMutationMcpLiveProofSummary> {
  if (
    options.requireOptIn !== false &&
    process.env[OPT_IN_ENV] !== OPT_IN_VALUE
  ) {
    throw new Error(
      `Refusing real Codex Plugin MCP/operator mutation without ${OPT_IN_ENV}=${OPT_IN_VALUE}`
    );
  }

  const workspaceRoot = fs.realpathSync(options.workspaceRoot ?? process.cwd());
  const initialBaseline = await runCodexPluginInventoryLiveProof({ workspaceRoot });
  assert.equal(initialBaseline.missingInstalledResourceCount, 0);
  assert.equal(
    initialBaseline.providerInstalledUniqueCount,
    initialBaseline.authoritativeInstalledResourceCount
  );

  const harness = await (options.createHarness ?? createRuntimeResourceRestLiveHarness)(
    workspaceRoot
  );
  let original: RuntimeResourceDescriptor | null = null;
  let finalResource: RuntimeResourceDescriptor | null = null;
  let primaryError: unknown = null;
  let installPrepareDurationMs: number | null = null;
  let installExecuteDurationMs: number | null = null;
  let uninstallPrepareDurationMs: number | null = null;
  let uninstallExecuteDurationMs: number | null = null;

  try {
    const initial = await freshInventory(harness, "initial");
    assert.equal(initial.mutationWritesEnabled, true);
    original = selectCandidate(initial.resources);
    assert.equal(original.installed, false);

    try {
      const install = await governedTransition(
        harness,
        original,
        initial.snapshot.id,
        "plugin.install",
        `plugin-mcp-live:install:${crypto.randomUUID()}`
      );
      installPrepareDurationMs = install.prepareDurationMs;
      installExecuteDurationMs = install.executeDurationMs;

      const transitioned = await freshInventory(harness, "installed");
      const transitionedResource = transitioned.resources.find(
        (resource) => resource.id === original!.id
      );
      assert.ok(transitionedResource, "Installed Plugin disappeared from inventory");
      assert.equal(transitionedResource.installed, true);
      assert.equal(
        transitionedResource.capabilities.includes("plugin:observed:installed"),
        true
      );

      const uninstall = await governedTransition(
        harness,
        transitionedResource,
        transitioned.snapshot.id,
        "plugin.uninstall",
        `plugin-mcp-live:uninstall:${crypto.randomUUID()}`
      );
      uninstallPrepareDurationMs = uninstall.prepareDurationMs;
      uninstallExecuteDurationMs = uninstall.executeDurationMs;

      const restored = await freshInventory(harness, "restored");
      finalResource =
        restored.resources.find((resource) => resource.id === original!.id) ?? null;
      assert.ok(finalResource, "Restored Plugin disappeared from authoritative catalog");
      assert.equal(finalResource.installed, false);
      assert.equal(finalResource.fingerprint, original.fingerprint);

      const activity = await harness.mcp<{
        ok: true;
        approvals: ApprovalProjection[];
        executions: ExecutionProjection[];
      }>("chatcockpit.resources.mutation.inspect", {
        target: "activity",
        workspaceId: harness.workspaceId,
        resourceId: original.id,
        limit: 20
      });
      assert.equal(activity.approvals.length >= 2, true);
      assert.equal(activity.executions.length >= 2, true);
      assert.equal(
        activity.approvals.slice(0, 2).every(
          (approval) =>
            approval.requestedActor?.type === "remote-mcp" &&
            approval.decidedActor?.type === "rest-api"
        ),
        true
      );
      assert.equal(
        activity.executions.slice(0, 2).every(
          (execution) => execution.executedActor?.type === "remote-mcp"
        ),
        true
      );

      assertProviderSurface(harness.observedProviderMethods);
      assert.equal(writeCount(harness.providerMethodCalls, "plugin/install"), 1);
      assert.equal(writeCount(harness.providerMethodCalls, "plugin/uninstall"), 1);
      assert.deepEqual(
        mutationMethods(harness.providerMethodCalls),
        ["plugin/install", "plugin/uninstall"]
      );
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (original && finalResource?.installed !== false) {
        try {
          const current = await freshInventory(harness, "cleanup-current");
          const currentResource = current.resources.find(
            (resource) => resource.id === original!.id
          );
          if (currentResource?.installed === true) {
            await governedTransition(
              harness,
              currentResource,
              current.snapshot.id,
              "plugin.uninstall",
              `plugin-mcp-live:cleanup:${crypto.randomUUID()}`
            );
          }
          const cleanupFinal = await freshInventory(harness, "cleanup-final");
          const cleanupResource = cleanupFinal.resources.find(
            (resource) => resource.id === original!.id
          );
          if (
            !cleanupResource ||
            cleanupResource.installed !== false ||
            cleanupResource.fingerprint !== original.fingerprint
          ) {
            throw new Error(
              "Governed MCP/operator cleanup could not restore original Plugin absence"
            );
          }
          finalResource = cleanupResource;
        } catch (cleanupError) {
          if (primaryError) {
            throw new AggregateError(
              [primaryError, cleanupError],
              "MCP/operator Plugin proof failed and governed cleanup also failed"
            );
          }
          throw cleanupError;
        }
      }
    }
  } finally {
    await harness.close();
  }

  assert.ok(original && finalResource);
  assert.notEqual(installPrepareDurationMs, null);
  assert.notEqual(installExecuteDurationMs, null);
  assert.notEqual(uninstallPrepareDurationMs, null);
  assert.notEqual(uninstallExecuteDurationMs, null);

  const finalBaseline = await runCodexPluginInventoryLiveProof({ workspaceRoot });
  assert.equal(finalBaseline.missingInstalledResourceCount, 0);
  assert.equal(
    finalBaseline.providerInstalledUniqueCount,
    finalBaseline.authoritativeInstalledResourceCount
  );
  assert.equal(
    finalBaseline.providerInstalledUniqueCount,
    initialBaseline.providerInstalledUniqueCount,
    "Provider installed Plugin count did not return to the initial baseline"
  );
  assert.equal(
    finalBaseline.authoritativeInstalledResourceCount,
    initialBaseline.authoritativeInstalledResourceCount,
    "Authoritative installed Plugin count did not return to the initial baseline"
  );

  const mutationMethodsObserved = mutationMethods(harness.providerMethodCalls);
  const summary: CodexPluginMutationMcpLiveProofSummary = {
    ok: true,
    providerKind: "codex",
    protocolKind: "native-app-server",
    executableVersion: harness.profile.executableVersion,
    originalInstalled: false,
    transitionedInstalled: true,
    restoredInstalled: false,
    transitionVerification: "verified",
    restoreVerification: "verified",
    approvalsPersisted: 2,
    executionsPersisted: 2,
    crossSurfaceProvenanceVerified: true,
    installWriteCount: 1,
    uninstallWriteCount: 1,
    installPrepareDurationMs: installPrepareDurationMs!,
    installExecuteDurationMs: installExecuteDurationMs!,
    uninstallPrepareDurationMs: uninstallPrepareDurationMs!,
    uninstallExecuteDurationMs: uninstallExecuteDurationMs!,
    initialProviderInstalledUniqueCount: initialBaseline.providerInstalledUniqueCount,
    finalProviderInstalledUniqueCount: finalBaseline.providerInstalledUniqueCount,
    initialAuthoritativeInstalledResourceCount:
      initialBaseline.authoritativeInstalledResourceCount,
    finalAuthoritativeInstalledResourceCount:
      finalBaseline.authoritativeInstalledResourceCount,
    finalMissingInstalledResourceCount: 0,
    observedProviderMethods: [...harness.observedProviderMethods].sort(),
    mutationMethodsObserved,
    forbiddenProviderMethodObserved: false,
    turnStartObserved: false,
    privateWorkspacePathProjected: false,
    restoredFingerprintMatchesOriginal:
      finalResource.fingerprint === original.fingerprint
  };
  assert.deepEqual(summary.mutationMethodsObserved, ["plugin/install", "plugin/uninstall"]);
  assert.equal(summary.restoredFingerprintMatchesOriginal, true);
  assertPublicSafe(summary, workspaceRoot);
  return summary;
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return invoked === fs.realpathSync(new URL(import.meta.url).pathname);
}

if (isMainModule()) {
  runCodexPluginMutationMcpLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_PLUGIN_MUTATION_MCP_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`CODEX_PLUGIN_MUTATION_MCP_LIVE_PROOF_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
