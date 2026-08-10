import { randomUUID } from "node:crypto";

import { hashRuntimeResource } from "./runtime-resource-hash.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "./runtime-resource-types.js";
import type { RuntimeResourceInventoryService } from "./runtime-resource-inventory-service.js";
import { ServiceError } from "./service-error.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  RuntimeResourceMutationApprovalRecord,
  RuntimeResourceMutationExecutionRecord,
  RuntimeResourceMutationOperation,
  RuntimeResourceMutationVerificationStatus
} from "../continuity/repositories/runtime-resource-mutation-repository.js";
import type { CodexSkillMutationAdapter } from "../runtime/resources/codex-skill-mutation-adapter.js";

const RESOURCE_MUTATION_APPROVAL_TTL_MS = 5 * 60 * 1000;
const PRE_WRITE_STALE_CODES = new Set([
  "RUNTIME_RESOURCE_MUTATION_STALE",
  "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
  "RUNTIME_RESOURCE_MUTATION_TARGET_AMBIGUOUS"
]);

export interface RuntimeResourceMutationPrepareInput {
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  expectedFingerprint: string;
  idempotencyKey: string;
}

export interface RuntimeResourceMutationDecisionInput {
  approvalId: string;
  expectedRevision: number;
  decision: "approved" | "denied";
  idempotencyKey: string;
}

export interface RuntimeResourceMutationExecuteInput {
  approvalId: string;
  expectedApprovalRevision: number;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  expectedFingerprint: string;
  idempotencyKey: string;
}

export interface RuntimeResourceMutationPrepareResult {
  ok: true;
  approval: RuntimeResourceMutationApprovalRecord;
  replayed: boolean;
}

export interface RuntimeResourceMutationExecuteResult {
  ok: true;
  approval: RuntimeResourceMutationApprovalRecord;
  execution: RuntimeResourceMutationExecutionRecord;
  replayed: boolean;
}

interface PreparedExecution {
  approval: RuntimeResourceMutationApprovalRecord;
  execution: RuntimeResourceMutationExecutionRecord;
  profile: RuntimeProfileDescriptor;
  before: RuntimeResourceDescriptor;
  desiredEnabled: boolean;
}

interface ExternalExecutionOutcome {
  status: Exclude<RuntimeResourceMutationVerificationStatus, "executing">;
  afterSnapshotId: string | null;
  afterFingerprint: string | null;
  observedState: Record<string, unknown> | null;
  errorCode: string | null;
}

function desiredEnabled(operation: RuntimeResourceMutationOperation): boolean {
  return operation === "skill.enable";
}

function approvalExpiry(now: string): string {
  return new Date(Date.parse(now) + RESOURCE_MUTATION_APPROVAL_TTL_MS).toISOString();
}

function errorCode(error: unknown): string {
  if (error instanceof ServiceError) return error.code;
  return "RUNTIME_RESOURCE_MUTATION_EXTERNAL_FAILED";
}

function isPreWriteStaleCode(code: string | null): boolean {
  return code !== null && PRE_WRITE_STALE_CODES.has(code);
}

function freshInventoryKey(stage: string, outerIdempotencyKey: string): string {
  return `${stage}:${outerIdempotencyKey}:${randomUUID()}`;
}

function exactMutationHash(input: {
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resource: RuntimeResourceDescriptor;
  beforeSnapshotId: string;
  providerKind: string;
  protocolKind: string;
  requestedEnabled: boolean;
}): string {
  return hashRuntimeResource({
    schemaVersion: 1,
    operation: input.operation,
    runtimeProfileId: input.runtimeProfileId,
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    workspaceId: input.workspaceId,
    resourceId: input.resource.id,
    resourceKind: input.resource.kind,
    resourceScope: input.resource.scope,
    beforeSnapshotId: input.beforeSnapshotId,
    beforeFingerprint: input.resource.fingerprint,
    beforeEnabled: input.resource.enabled,
    requestedEnabled: input.requestedEnabled
  });
}

export class RuntimeResourceMutationService {
  private readonly now: () => string;

  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly inventory: RuntimeResourceInventoryService,
    private readonly codexSkills: CodexSkillMutationAdapter,
    options: { now?: () => string } = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async prepare(
    input: RuntimeResourceMutationPrepareInput
  ): Promise<RuntimeResourceMutationPrepareResult> {
    const idempotencyInput = {
      operation: input.operation,
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resourceId: input.resourceId,
      expectedFingerprint: input.expectedFingerprint
    };
    const replay = this.repositories.idempotency.replay<{
      ok: true;
      approval: RuntimeResourceMutationApprovalRecord;
    }>("runtime.resource.mutation.prepare", input.idempotencyKey, idempotencyInput);
    if (replay) return { ...replay.value, replayed: true };

    const observed = await this.inventory.inventory({
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      idempotencyKey: freshInventoryKey(
        "resource-mutation-prepare",
        input.idempotencyKey
      )
    });
    const resource = observed.resources.find((entry) => entry.id === input.resourceId);
    if (!resource) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
        "Runtime Resource mutation target is not present in the fresh inventory"
      );
    }
    this.assertSkillMutationSupported(observed.profile, resource);
    if (resource.fingerprint !== input.expectedFingerprint) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Runtime Resource changed before mutation approval was prepared"
      );
    }
    if (typeof resource.enabled !== "boolean") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "Runtime Resource does not expose an authoritative enabled state"
      );
    }
    const requestedEnabled = desiredEnabled(input.operation);
    if (resource.enabled === requestedEnabled) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_NOOP",
        "Runtime Resource already has the requested state"
      );
    }

    const now = this.now();
    const mutationHash = exactMutationHash({
      operation: input.operation,
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resource,
      beforeSnapshotId: observed.snapshot.id,
      providerKind: observed.profile.providerKind,
      protocolKind: observed.profile.protocolKind,
      requestedEnabled
    });
    const executed = this.repositories.idempotency.execute(
      "runtime.resource.mutation.prepare",
      input.idempotencyKey,
      idempotencyInput,
      () => ({
        ok: true as const,
        approval: this.repositories.runtimeResourceMutations.createApproval({
          operation: input.operation,
          runtimeProfileId: input.runtimeProfileId,
          workspaceId: input.workspaceId,
          resourceId: resource.id,
          resourceScope: resource.scope,
          beforeSnapshotId: observed.snapshot.id,
          beforeFingerprint: resource.fingerprint,
          requestedState: { enabled: requestedEnabled },
          mutationHash,
          publicSummary: {
            resourceId: resource.id,
            displayName: resource.displayName,
            kind: resource.kind,
            scope: resource.scope,
            beforeEnabled: resource.enabled,
            requestedEnabled,
            runtimeProfileId: observed.profile.id
          },
          expiresAt: approvalExpiry(now),
          now
        })
      }),
      now
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  decide(input: RuntimeResourceMutationDecisionInput) {
    const idempotencyInput = {
      approvalId: input.approvalId,
      expectedRevision: input.expectedRevision,
      decision: input.decision
    };
    const executed = this.repositories.idempotency.execute(
      "runtime.resource.mutation.decide",
      input.idempotencyKey,
      idempotencyInput,
      () => ({
        ok: true as const,
        approval: this.repositories.runtimeResourceMutations.decide({
          id: input.approvalId,
          expectedRevision: input.expectedRevision,
          decision: input.decision,
          now: this.now()
        })
      }),
      this.now()
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  async execute(
    input: RuntimeResourceMutationExecuteInput
  ): Promise<RuntimeResourceMutationExecuteResult> {
    const idempotencyInput = {
      approvalId: input.approvalId,
      expectedApprovalRevision: input.expectedApprovalRevision,
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resourceId: input.resourceId,
      expectedFingerprint: input.expectedFingerprint
    };
    const replay = this.repositories.idempotency.replay<{
      ok: true;
      approval: RuntimeResourceMutationApprovalRecord;
      execution: RuntimeResourceMutationExecutionRecord;
    }>("runtime.resource.mutation.execute", input.idempotencyKey, idempotencyInput);
    if (replay) return { ...replay.value, replayed: true };

    const approval = this.requireExecutableApproval(input);
    const preflight = await this.inventory.inventory({
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      idempotencyKey: freshInventoryKey(
        "resource-mutation-preflight",
        input.idempotencyKey
      )
    });
    const before = preflight.resources.find((entry) => entry.id === input.resourceId);
    if (!before) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Approved Runtime Resource disappeared before execution"
      );
    }
    this.assertSkillMutationSupported(preflight.profile, before);
    this.assertApprovalStillMatches(approval, preflight.profile, before, input);
    const requested = approval.requestedState.enabled;
    if (typeof requested !== "boolean") {
      throw new ServiceError(
        "CONTINUITY_DATA_INVALID",
        "Stored Runtime Resource mutation requested state is invalid"
      );
    }

    const now = this.now();
    const executed = await this.repositories.idempotency.executePreparedExternalMutation<
      PreparedExecution,
      ExternalExecutionOutcome,
      {
        ok: true;
        approval: RuntimeResourceMutationApprovalRecord;
        execution: RuntimeResourceMutationExecutionRecord;
      }
    >(
      "runtime.resource.mutation.execute",
      input.idempotencyKey,
      idempotencyInput,
      () => {
        const consumed = this.repositories.runtimeResourceMutations.consume({
          id: approval.id,
          expectedRevision: approval.revision,
          now
        });
        const execution = this.repositories.runtimeResourceMutations.createExecution({
          approval: consumed,
          providerMethod: "skills/config/write",
          now
        });
        return {
          approval: consumed,
          execution,
          profile: preflight.profile,
          before,
          desiredEnabled: requested
        };
      },
      async (prepared) => this.executeAndVerify(prepared, input.idempotencyKey),
      (prepared, outcome) => ({
        ok: true as const,
        approval: prepared.approval,
        execution: this.repositories.runtimeResourceMutations.finishExecution({
          id: prepared.execution.id,
          status: outcome.status,
          afterSnapshotId: outcome.afterSnapshotId,
          afterFingerprint: outcome.afterFingerprint,
          observedState: outcome.observedState,
          errorCode: outcome.errorCode,
          now: this.now()
        })
      }),
      undefined,
      now
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  private requireExecutableApproval(
    input: RuntimeResourceMutationExecuteInput
  ): RuntimeResourceMutationApprovalRecord {
    const approval = this.repositories.runtimeResourceMutations.expireIfNeeded(
      input.approvalId,
      this.now()
    );
    if (approval.status === "expired") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_EXPIRED",
        "Runtime Resource mutation approval expired"
      );
    }
    if (approval.status === "consumed") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_CONSUMED",
        "Runtime Resource mutation approval was already consumed"
      );
    }
    if (approval.status !== "approved") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_APPROVAL_REQUIRED",
        "Runtime Resource mutation requires an approved intent"
      );
    }
    if (approval.revision !== input.expectedApprovalRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Runtime Resource mutation approval ${approval.id} no longer has revision ${input.expectedApprovalRevision}`,
        {
          details: {
            expectedRevision: input.expectedApprovalRevision,
            actualRevision: approval.revision
          }
        }
      );
    }
    if (
      approval.runtimeProfileId !== input.runtimeProfileId ||
      approval.workspaceId !== input.workspaceId ||
      approval.resourceId !== input.resourceId ||
      approval.beforeFingerprint !== input.expectedFingerprint
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_HASH_MISMATCH",
        "Runtime Resource execute target does not match the approved intent"
      );
    }
    return approval;
  }

  private assertApprovalStillMatches(
    approval: RuntimeResourceMutationApprovalRecord,
    profile: RuntimeProfileDescriptor,
    resource: RuntimeResourceDescriptor,
    input: RuntimeResourceMutationExecuteInput
  ): void {
    const requested = approval.requestedState.enabled;
    const recomputedHash =
      typeof requested === "boolean"
        ? exactMutationHash({
            operation: approval.operation,
            runtimeProfileId: profile.id,
            workspaceId: input.workspaceId,
            resource,
            beforeSnapshotId: approval.beforeSnapshotId,
            providerKind: profile.providerKind,
            protocolKind: profile.protocolKind,
            requestedEnabled: requested
          })
        : "";
    if (
      resource.fingerprint !== approval.beforeFingerprint ||
      resource.scope !== approval.resourceScope ||
      resource.kind !== approval.resourceKind ||
      recomputedHash !== approval.mutationHash
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Runtime Resource changed after approval and must be reviewed again"
      );
    }
  }

  private async executeAndVerify(
    prepared: PreparedExecution,
    idempotencyKey: string
  ): Promise<ExternalExecutionOutcome> {
    let providerError: string | null = null;
    try {
      await this.codexSkills.setEnabled({
        profile: prepared.profile,
        workspaceId: prepared.approval.workspaceId!,
        resourceId: prepared.before.id,
        expectedFingerprint: prepared.before.fingerprint,
        desiredEnabled: prepared.desiredEnabled
      });
    } catch (error) {
      providerError = errorCode(error);
    }

    try {
      const after = await this.inventory.inventory({
        runtimeProfileId: prepared.profile.id,
        workspaceId: prepared.approval.workspaceId!,
        idempotencyKey: freshInventoryKey(
          "resource-mutation-postflight",
          idempotencyKey
        )
      });
      const resource = after.resources.find(
        (entry) => entry.id === prepared.before.id
      );
      const observedState = resource
        ? { enabled: resource.enabled }
        : { missing: true };

      if (resource?.enabled === prepared.desiredEnabled) {
        return {
          status: "verified",
          afterSnapshotId: after.snapshot.id,
          afterFingerprint: resource.fingerprint,
          observedState,
          errorCode: null
        };
      }
      if (isPreWriteStaleCode(providerError)) {
        return {
          status: "stale",
          afterSnapshotId: after.snapshot.id,
          afterFingerprint: resource?.fingerprint ?? null,
          observedState,
          errorCode: providerError
        };
      }
      if (providerError) {
        return {
          status: "failed-external",
          afterSnapshotId: after.snapshot.id,
          afterFingerprint: resource?.fingerprint ?? null,
          observedState,
          errorCode: providerError
        };
      }
      return {
        status: "failed-verification",
        afterSnapshotId: after.snapshot.id,
        afterFingerprint: resource?.fingerprint ?? null,
        observedState,
        errorCode: "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED"
      };
    } catch (error) {
      if (isPreWriteStaleCode(providerError)) {
        return {
          status: "stale",
          afterSnapshotId: null,
          afterFingerprint: null,
          observedState: null,
          errorCode: providerError
        };
      }
      return {
        status: providerError ? "failed-external" : "failed-verification",
        afterSnapshotId: null,
        afterFingerprint: null,
        observedState: null,
        errorCode:
          providerError ??
          (error instanceof ServiceError
            ? error.code
            : "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED")
      };
    }
  }

  private assertSkillMutationSupported(
    profile: RuntimeProfileDescriptor,
    resource: RuntimeResourceDescriptor
  ): void {
    if (
      profile.providerKind !== "codex" ||
      profile.protocolKind !== "native-app-server" ||
      resource.kind !== "skill" ||
      resource.installed !== true ||
      resource.compatibilityStatus !== "ready"
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "Phase 6B1 only supports installed, compatible Codex Skills"
      );
    }
  }
}
