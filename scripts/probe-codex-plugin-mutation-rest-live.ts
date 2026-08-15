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

const OPT_IN_ENV = "CHATCOCKPIT_CODEX_PLUGIN_REST_MUTATION_PROOF";
const OPT_IN_VALUE = "I_UNDERSTAND_REVERSIBLE_PLUGIN_REST_MUTATION";

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

export interface CodexPluginMutationRestLiveProofOptions {
  workspaceRoot?: string;
  requireOptIn?: boolean;
  createHarness?: (
    workspaceRoot: string
  ) => Promise<RuntimeResourceRestLiveHarness>;
}

export interface CodexPluginMutationRestLiveProofSummary {
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
  restActorProvenanceVerified: true;
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
    "No safe remote AVAILABLE ON_USE Codex Plugin is available for the REST live proof"
  );
  return candidate;
}

function writeCount(calls: string[], method: "plugin/install" | "plugin/uninstall"): number {
  return calls.filter((entry) => entry === method).length;
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
  for (const required of [
    "plugin/installed",
    "plugin/list",
    "plugin/install",
    "plugin/uninstall"
  ]) {
    assert.equal(methods.has(required), true, `Missing provider evidence ${required}`);
  }
  assert.equal(methods.has("turn/start"), false);
}

function assertPublicSafe(value: unknown, workspaceRoot: string): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes(workspaceRoot), false, "REST Plugin proof leaked private path");
  for (const forbidden of [
    "remotePluginId",
    "remoteMarketplaceName",
    "marketplacePath",
    "installUrl",
    "sourceIdentityHash",
    "pluginName",
    "rawConfig"
  ]) {
    assert.equal(json.includes(forbidden), false, `REST Plugin proof leaked ${forbidden}`);
  }
}

async function freshInventory(
  harness: RuntimeResourceRestLiveHarness,
  stage: string
): Promise<InventoryResponse> {
  return harness.rest<InventoryResponse>("POST", "/api/resources/inventory", {
    runtimeProfileId: harness.profile.id,
    workspaceId: harness.workspaceId,
    idempotencyKey: `plugin-rest-live:${stage}:${crypto.randomUUID()}`
  });
}

async function governedTransition(
  harness: RuntimeResourceRestLiveHarness,
  resource: RuntimeResourceDescriptor,
  snapshotId: string,
  operation: PluginOperation,
  keyPrefix: string
): Promise<{
  approval: ApprovalProjection;
  execution: ExecutionProjection;
  prepareDurationMs: number;
  executeDurationMs: number;
}> {
  const method = operation === "plugin.install" ? "plugin/install" : "plugin/uninstall";
  const writesBefore = writeCount(harness.providerMethodCalls, method);
  const prepareStartedAt = Date.now();
  const prepared = await harness.rest<{
    approval: ApprovalProjection;
    replayed: boolean;
  }>("POST", "/api/resources/mutations/prepare", {
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
  assert.equal(prepared.approval.requestedActor?.type, "rest-api");
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore);

  const decision = await harness.rest<{
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
  assert.equal(decision.approval.decidedActor?.type, "rest-api");
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore);

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
  const executed = await harness.rest<{
    approval: ApprovalProjection;
    execution: ExecutionProjection;
    replayed: boolean;
  }>("POST", "/api/resources/mutations/execute", executeBody);
  const executeDurationMs = Date.now() - executeStartedAt;
  assert.equal(executed.replayed, false);
  assert.equal(executed.execution.verificationStatus, "verified");
  assert.equal(executed.execution.executedActor?.type, "rest-api");
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore + 1);

  const replay = await harness.rest<{
    execution: ExecutionProjection;
    replayed: boolean;
  }>("POST", "/api/resources/mutations/execute", executeBody);
  assert.equal(replay.replayed, true);
  assert.equal(replay.execution.id, executed.execution.id);
  assert.equal(writeCount(harness.providerMethodCalls, method), writesBefore + 1);
  return {
    approval: executed.approval,
    execution: executed.execution,
    prepareDurationMs,
    executeDurationMs
  };
}

export async function runCodexPluginMutationRestLiveProof(
  options: CodexPluginMutationRestLiveProofOptions = {}
): Promise<CodexPluginMutationRestLiveProofSummary> {
  if (
    options.requireOptIn !== false &&
    process.env[OPT_IN_ENV] !== OPT_IN_VALUE
  ) {
    throw new Error(
      `Refusing real Codex Plugin REST mutation without ${OPT_IN_ENV}=${OPT_IN_VALUE}`
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
      const installResult = await governedTransition(
        harness,
        original,
        initial.snapshot.id,
        "plugin.install",
        `plugin-rest-live:install:${crypto.randomUUID()}`
      );
      installPrepareDurationMs = installResult.prepareDurationMs;
      installExecuteDurationMs = installResult.executeDurationMs;
      const transitioned = await freshInventory(harness, "installed");
      const transitionedResource = transitioned.resources.find(
        (resource) => resource.id === original!.id
      );
      assert.ok(transitionedResource, "Installed Plugin disappeared from REST inventory");
      assert.equal(transitionedResource.installed, true);
      assert.equal(
        transitionedResource.capabilities.includes("plugin:observed:installed"),
        true
      );

      const uninstallResult = await governedTransition(
        harness,
        transitionedResource,
        transitioned.snapshot.id,
        "plugin.uninstall",
        `plugin-rest-live:uninstall:${crypto.randomUUID()}`
      );
      uninstallPrepareDurationMs = uninstallResult.prepareDurationMs;
      uninstallExecuteDurationMs = uninstallResult.executeDurationMs;
      const restored = await freshInventory(harness, "restored");
      finalResource =
        restored.resources.find((resource) => resource.id === original!.id) ?? null;
      assert.ok(finalResource, "Restored Plugin disappeared from REST catalog");
      assert.equal(finalResource.installed, false);
      assert.equal(finalResource.fingerprint, original.fingerprint);

      const activity = await harness.rest<{
        approvals: ApprovalProjection[];
        executions: ExecutionProjection[];
      }>(
        "GET",
        `/api/resources/mutations/activity?workspaceId=${encodeURIComponent(
          harness.workspaceId
        )}&resourceId=${encodeURIComponent(original.id)}&limit=20`
      );
      assert.equal(activity.approvals.length >= 2, true);
      assert.equal(activity.executions.length >= 2, true);
      assert.equal(
        activity.approvals.slice(0, 2).every(
          (approval) =>
            approval.requestedActor?.type === "rest-api" &&
            approval.decidedActor?.type === "rest-api"
        ),
        true
      );
      assert.equal(
        activity.executions.slice(0, 2).every(
          (execution) => execution.executedActor?.type === "rest-api"
        ),
        true
      );

      assertProviderSurface(harness.observedProviderMethods);
      assert.equal(writeCount(harness.providerMethodCalls, "plugin/install"), 1);
      assert.equal(writeCount(harness.providerMethodCalls, "plugin/uninstall"), 1);
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
              `plugin-rest-live:cleanup:${crypto.randomUUID()}`
            );
          }
          const cleanupFinal = await freshInventory(harness, "cleanup-final");
          const cleanupResource = cleanupFinal.resources.find(
            (resource) => resource.id === original!.id
          );
          if (!cleanupResource || cleanupResource.installed !== false) {
            throw new Error("Governed REST cleanup could not restore Plugin absence");
          }
          finalResource = cleanupResource;
        } catch (cleanupError) {
          if (primaryError) {
            throw new AggregateError(
              [primaryError, cleanupError],
              "Plugin REST proof failed and governed cleanup also failed"
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

  const summary: CodexPluginMutationRestLiveProofSummary = {
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
    restActorProvenanceVerified: true,
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
    turnStartObserved: false,
    privateWorkspacePathProjected: false,
    restoredFingerprintMatchesOriginal:
      finalResource.fingerprint === original.fingerprint
  };
  assert.equal(summary.restoredFingerprintMatchesOriginal, true);
  assertPublicSafe(summary, workspaceRoot);
  return summary;
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return invoked === fs.realpathSync(new URL(import.meta.url).pathname);
}

if (isMainModule()) {
  runCodexPluginMutationRestLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_PLUGIN_MUTATION_REST_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`CODEX_PLUGIN_MUTATION_REST_LIVE_PROOF_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
