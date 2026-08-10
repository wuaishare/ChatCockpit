import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type {
  RuntimeResourceDescriptor,
  RuntimeResourceMutationOperation
} from "../web/src/types.ts";
import {
  createRuntimeResourceRestLiveHarness,
  type RuntimeResourceRestLiveHarness
} from "./test-support/runtime-resource-rest-live.ts";

const OPT_IN_ENV = "TOKENPILOT_CODEX_SKILL_REST_MUTATION_PROOF";
const OPT_IN_VALUE = "I_UNDERSTAND_REVERSIBLE_REST_MUTATION";

type SkillOperation = "skill.enable" | "skill.disable";

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

export interface CodexSkillMutationRestLiveProofOptions {
  workspaceRoot?: string;
  requireOptIn?: boolean;
  createHarness?: (
    workspaceRoot: string
  ) => Promise<RuntimeResourceRestLiveHarness>;
}

export interface CodexSkillMutationRestLiveProofSummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableVersion: string | null;
  resourceId: string;
  resourceScope: "workspace" | "user";
  originalEnabled: boolean;
  transitionedEnabled: boolean;
  restoredEnabled: boolean;
  transitionVerification: "verified";
  restoreVerification: "verified";
  approvalsPersisted: 2;
  executionsPersisted: 2;
  restActorProvenanceVerified: true;
  providerWriteCount: 2;
  transitionPrepareDurationMs: number;
  transitionExecuteDurationMs: number;
  restorePrepareDurationMs: number;
  restoreExecuteDurationMs: number;
  observedProviderMethods: string[];
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
  restoredFingerprintMatchesOriginal: true;
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
  assert.ok(candidate, "No mutable Codex Skill is available for the REST live proof");
  return candidate;
}

function operationFor(enabled: boolean): SkillOperation {
  return enabled ? "skill.enable" : "skill.disable";
}

function expectedAfter(operation: SkillOperation): boolean {
  return operation === "skill.enable";
}

function providerWriteCount(calls: string[]): number {
  return calls.filter((method) => method === "skills/config/write").length;
}

function assertProviderSurface(methods: Set<string>): void {
  const allowed = new Set([
    "config/read",
    "mcpServerStatus/list",
    "skills/list",
    "plugin/installed",
    "plugin/list",
    "skills/config/write"
  ]);
  for (const method of methods) {
    assert.equal(allowed.has(method), true, `Unexpected provider method: ${method}`);
  }
  assert.equal(methods.has("skills/config/write"), true);
  assert.equal(methods.has("turn/start"), false);
}

function assertPublicSafe(value: unknown, workspaceRoot: string): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes(workspaceRoot), false, "REST proof leaked private Workspace path");
  for (const forbidden of [
    "remotePluginId",
    "remoteMarketplaceName",
    "marketplacePath",
    "installUrl",
    "sourceIdentityHash",
    "rawConfig"
  ]) {
    assert.equal(json.includes(forbidden), false, `REST proof leaked ${forbidden}`);
  }
}

async function freshInventory(
  harness: RuntimeResourceRestLiveHarness,
  stage: string
): Promise<InventoryResponse> {
  return harness.rest<InventoryResponse>("POST", "/api/resources/inventory", {
    runtimeProfileId: harness.profile.id,
    workspaceId: harness.workspaceId,
    idempotencyKey: `skill-rest-live:${stage}:${crypto.randomUUID()}`
  });
}

async function governedTransition(
  harness: RuntimeResourceRestLiveHarness,
  resource: RuntimeResourceDescriptor,
  snapshotId: string,
  operation: SkillOperation,
  keyPrefix: string
): Promise<GovernedTransitionResult> {
  const writesBefore = providerWriteCount(harness.providerMethodCalls);
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
  assert.equal(providerWriteCount(harness.providerMethodCalls), writesBefore);

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
  assert.equal(providerWriteCount(harness.providerMethodCalls), writesBefore);

  const executeStartedAt = Date.now();
  const executed = await harness.rest<{
    approval: ApprovalProjection;
    execution: ExecutionProjection;
    replayed: boolean;
  }>("POST", "/api/resources/mutations/execute", {
    approvalId: decision.approval.id,
    expectedApprovalRevision: decision.approval.revision,
    runtimeProfileId: harness.profile.id,
    workspaceId: harness.workspaceId,
    resourceId: resource.id,
    expectedFingerprint: resource.fingerprint,
    idempotencyKey: `${keyPrefix}:execute`
  });
  const executeDurationMs = Date.now() - executeStartedAt;
  assert.equal(executed.replayed, false);
  assert.equal(executed.execution.verificationStatus, "verified");
  assert.equal(executed.execution.executedActor?.type, "rest-api");
  assert.equal(providerWriteCount(harness.providerMethodCalls), writesBefore + 1);

  const replay = await harness.rest<{
    execution: ExecutionProjection;
    replayed: boolean;
  }>("POST", "/api/resources/mutations/execute", {
    approvalId: decision.approval.id,
    expectedApprovalRevision: decision.approval.revision,
    runtimeProfileId: harness.profile.id,
    workspaceId: harness.workspaceId,
    resourceId: resource.id,
    expectedFingerprint: resource.fingerprint,
    idempotencyKey: `${keyPrefix}:execute`
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.execution.id, executed.execution.id);
  assert.equal(providerWriteCount(harness.providerMethodCalls), writesBefore + 1);
  return {
    approval: executed.approval,
    execution: executed.execution,
    prepareDurationMs,
    executeDurationMs
  };
}

export async function runCodexSkillMutationRestLiveProof(
  options: CodexSkillMutationRestLiveProofOptions = {}
): Promise<CodexSkillMutationRestLiveProofSummary> {
  if (
    options.requireOptIn !== false &&
    process.env[OPT_IN_ENV] !== OPT_IN_VALUE
  ) {
    throw new Error(
      `Refusing real Codex Skill REST mutation without ${OPT_IN_ENV}=${OPT_IN_VALUE}`
    );
  }

  const workspaceRoot = fs.realpathSync(options.workspaceRoot ?? process.cwd());
  const harness = await (options.createHarness ?? createRuntimeResourceRestLiveHarness)(
    workspaceRoot
  );
  let original: RuntimeResourceDescriptor | null = null;
  let finalResource: RuntimeResourceDescriptor | null = null;
  let primaryError: unknown = null;

  try {
    assert.equal(harness.profile.providerKind, "codex");
    assert.equal(harness.profile.protocolKind, "native-app-server");
    const initial = await freshInventory(harness, "initial");
    assert.equal(initial.mutationWritesEnabled, true);
    original = selectCandidate(initial.resources);
    assert.equal(typeof original.enabled, "boolean");

    try {
      const transitionOperation = operationFor(!original.enabled);
      const transitionResult = await governedTransition(
        harness,
        original,
        initial.snapshot.id,
        transitionOperation,
        `skill-rest-live:transition:${crypto.randomUUID()}`
      );
      const transitioned = await freshInventory(harness, "transitioned");
      const transitionedResource = transitioned.resources.find(
        (resource) => resource.id === original!.id
      );
      assert.ok(transitionedResource, "Mutated Skill disappeared after REST transition");
      assert.equal(transitionedResource.enabled, expectedAfter(transitionOperation));

      const restoreResult = await governedTransition(
        harness,
        transitionedResource,
        transitioned.snapshot.id,
        operationFor(original.enabled),
        `skill-rest-live:restore:${crypto.randomUUID()}`
      );
      const restored = await freshInventory(harness, "restored");
      finalResource =
        restored.resources.find((resource) => resource.id === original!.id) ?? null;
      assert.ok(finalResource, "Restored Skill disappeared from REST inventory");
      assert.equal(finalResource.enabled, original.enabled);
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
      assert.equal(providerWriteCount(harness.providerMethodCalls), 2);
      const summary: CodexSkillMutationRestLiveProofSummary = {
        ok: true,
        providerKind: "codex",
        protocolKind: "native-app-server",
        executableVersion: harness.profile.executableVersion,
        resourceId: original.id,
        resourceScope: original.scope as "workspace" | "user",
        originalEnabled: original.enabled!,
        transitionedEnabled: !original.enabled!,
        restoredEnabled: finalResource.enabled!,
        transitionVerification: "verified",
        restoreVerification: "verified",
        approvalsPersisted: 2,
        executionsPersisted: 2,
        restActorProvenanceVerified: true,
        providerWriteCount: 2,
        transitionPrepareDurationMs: transitionResult.prepareDurationMs,
        transitionExecuteDurationMs: transitionResult.executeDurationMs,
        restorePrepareDurationMs: restoreResult.prepareDurationMs,
        restoreExecuteDurationMs: restoreResult.executeDurationMs,
        observedProviderMethods: [...harness.observedProviderMethods].sort(),
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
          const current = await freshInventory(harness, "cleanup-current");
          const currentResource = current.resources.find(
            (resource) => resource.id === original!.id
          );
          if (currentResource && currentResource.enabled !== original.enabled) {
            await governedTransition(
              harness,
              currentResource,
              current.snapshot.id,
              operationFor(original.enabled),
              `skill-rest-live:cleanup:${crypto.randomUUID()}`
            );
          }
          const cleanupFinal = await freshInventory(harness, "cleanup-final");
          const cleanupResource = cleanupFinal.resources.find(
            (resource) => resource.id === original!.id
          );
          if (!cleanupResource || cleanupResource.enabled !== original.enabled) {
            throw new Error("Governed REST cleanup could not restore the original Skill state");
          }
        } catch (cleanupError) {
          if (primaryError) {
            throw new AggregateError(
              [primaryError, cleanupError],
              "Skill REST proof failed and governed cleanup also failed"
            );
          }
          throw cleanupError;
        }
      }
    }
  } finally {
    await harness.close();
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return invoked === fs.realpathSync(new URL(import.meta.url).pathname);
}

if (isMainModule()) {
  runCodexSkillMutationRestLiveProof()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("CODEX_SKILL_MUTATION_REST_LIVE_PROOF_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`CODEX_SKILL_MUTATION_REST_LIVE_PROOF_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
