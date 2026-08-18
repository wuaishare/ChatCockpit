import type { ActorType, OperationContext } from "./operation-context.js";
import { hashRuntimeResource } from "./runtime-resource-hash.js";
import { assessRuntimeResourceMutationEligibility } from "./runtime-resource-mutation-eligibility.js";
import { buildRuntimeResourceMutationProvenance } from "./runtime-resource-mutation-provenance.js";
import {
  buildRuntimeResourceMutationHashV2,
  mutationSemantics,
  runtimeResourceMutationHashMatches
} from "./runtime-resource-mutation-semantics.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "./runtime-resource-types.js";
import type { RuntimeResourceInventoryService } from "./runtime-resource-inventory-service.js";
import { ServiceError } from "./service-error.js";
import type { GovernanceLedger } from "../governance/governance-ledger.js";
import type {
  RuntimeResourceMutationApprovalRecord,
  RuntimeResourceMutationExecutionRecord,
  RuntimeResourceMutationOperation,
  RuntimeResourceMutationVerificationStatus
} from "../continuity/repositories/runtime-resource-mutation-repository.js";
import type { CodexSkillMutationAdapter } from "../runtime/resources/codex-skill-mutation-adapter.js";
import type { CodexPluginMutationAdapter } from "../runtime/resources/codex-plugin-mutation-adapter.js";

const RESOURCE_MUTATION_APPROVAL_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PLUGIN_POSTFLIGHT_MAX_ATTEMPTS = 5;
const DEFAULT_PLUGIN_POSTFLIGHT_DELAY_MS = 250;
const PRE_WRITE_STALE_CODES = new Set([
  "RUNTIME_RESOURCE_MUTATION_STALE",
  "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
  "RUNTIME_RESOURCE_MUTATION_TARGET_AMBIGUOUS"
]);
const REMOTE_EXECUTE_DECISION_ACTORS = new Set<ActorType>([
  "local-cli",
  "local-ui",
  "rest-api"
]);

export interface RuntimeResourceMutationPrepareInput {
  operation: RuntimeResourceMutationOperation;
  runtimeProfileId: string;
  workspaceId: string;
  resourceId: string;
  expectedSnapshotId: string;
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
}

interface ExternalExecutionOutcome {
  status: Exclude<RuntimeResourceMutationVerificationStatus, "executing">;
  afterSnapshotId: string | null;
  afterFingerprint: string | null;
  observedState: Record<string, unknown> | null;
  errorCode: string | null;
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

export class RuntimeResourceMutationService {
  private readonly now: () => string;
  private readonly codexPlugins: CodexPluginMutationAdapter | null;
  private readonly pluginPostflightMaxAttempts: number;
  private readonly pluginPostflightDelayMs: number;

  constructor(
    private readonly repositories: GovernanceLedger,
    private readonly inventory: RuntimeResourceInventoryService,
    private readonly codexSkills: CodexSkillMutationAdapter,
    options: {
      now?: () => string;
      codexPlugins?: CodexPluginMutationAdapter;
      pluginPostflightMaxAttempts?: number;
      pluginPostflightDelayMs?: number;
    } = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.codexPlugins = options.codexPlugins ?? null;
    this.pluginPostflightMaxAttempts = Math.max(
      1,
      Math.min(
        10,
        Math.trunc(
          options.pluginPostflightMaxAttempts ?? DEFAULT_PLUGIN_POSTFLIGHT_MAX_ATTEMPTS
        )
      )
    );
    this.pluginPostflightDelayMs = Math.max(
      0,
      Math.min(
        5_000,
        Math.trunc(options.pluginPostflightDelayMs ?? DEFAULT_PLUGIN_POSTFLIGHT_DELAY_MS)
      )
    );
  }

  async prepare(
    context: OperationContext,
    input: RuntimeResourceMutationPrepareInput
  ): Promise<RuntimeResourceMutationPrepareResult> {
    const requestedActor = buildRuntimeResourceMutationProvenance(context);
    const idempotencyInput = {
      operation: input.operation,
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resourceId: input.resourceId,
      expectedSnapshotId: input.expectedSnapshotId,
      expectedFingerprint: input.expectedFingerprint,
      actor: {
        type: requestedActor.actorType,
        identityHash: requestedActor.actorIdentityHash
      }
    };
    const replay = this.repositories.idempotency.replay<{
      ok: true;
      approval: RuntimeResourceMutationApprovalRecord;
    }>("runtime.resource.mutation.prepare", input.idempotencyKey, idempotencyInput);
    if (replay) return { ...replay.value, replayed: true };

    const semantics = mutationSemantics(input.operation);
    const reviewed = this.inventory.inspectSnapshotResource(
      input.expectedSnapshotId,
      input.resourceId
    );
    if (
      reviewed.snapshot.runtimeProfileId !== input.runtimeProfileId ||
      reviewed.resource.fingerprint !== input.expectedFingerprint
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Reviewed Runtime Resource snapshot no longer matches the requested mutation target"
      );
    }
    if (reviewed.resource.kind !== semantics.resourceKind) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "The requested operation does not match this Resource kind."
      );
    }

    const observed = await this.inventory.readTarget({
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resourceId: input.resourceId,
      resourceKind: semantics.resourceKind
    });
    const resource = observed.resource;
    if (!resource) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_NOT_FOUND",
        "Runtime Resource mutation target is not present in the fresh target read"
      );
    }
    const eligibility = assessRuntimeResourceMutationEligibility({
      profile: observed.profile,
      resource,
      operation: input.operation,
      pluginMutationAvailable: this.codexPlugins !== null
    });
    if (!eligibility.eligible && eligibility.stage === "platform") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        eligibility.publicReason
      );
    }
    if (resource.fingerprint !== input.expectedFingerprint) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Runtime Resource changed before mutation approval was prepared"
      );
    }
    semantics.beforeState(resource);
    if (semantics.isNoop(resource)) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_NOOP",
        "Runtime Resource already has the requested state"
      );
    }
    if (!eligibility.eligible) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        eligibility.publicReason
      );
    }

    const now = this.now();
    const mutationHash = buildRuntimeResourceMutationHashV2({
      operation: input.operation,
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resource,
      beforeSnapshotId: input.expectedSnapshotId,
      providerKind: observed.profile.providerKind,
      protocolKind: observed.profile.protocolKind
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
          resourceKind: semantics.resourceKind,
          resourceScope: resource.scope,
          beforeSnapshotId: input.expectedSnapshotId,
          beforeFingerprint: resource.fingerprint,
          requestedState: { ...semantics.requestedState },
          mutationHash,
          publicSummary: {
            resourceId: resource.id,
            displayName: resource.displayName,
            kind: resource.kind,
            scope: resource.scope,
            ...semantics.publicState(resource),
            runtimeProfileId: observed.profile.id
          },
          requestedActor,
          expiresAt: approvalExpiry(now),
          now
        })
      }),
      now
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  decide(context: OperationContext, input: RuntimeResourceMutationDecisionInput) {
    if (context.actorType === "remote-mcp") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_DECISION_FORBIDDEN",
        "Remote MCP callers cannot decide Runtime Resource mutation approvals"
      );
    }
    const decidedActor = buildRuntimeResourceMutationProvenance(context);
    const idempotencyInput = {
      approvalId: input.approvalId,
      expectedRevision: input.expectedRevision,
      decision: input.decision,
      actor: {
        type: decidedActor.actorType,
        identityHash: decidedActor.actorIdentityHash
      }
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
          decidedActor,
          now: this.now()
        })
      }),
      this.now()
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  async execute(
    context: OperationContext,
    input: RuntimeResourceMutationExecuteInput
  ): Promise<RuntimeResourceMutationExecuteResult> {
    const executedActor = buildRuntimeResourceMutationProvenance(context);
    const idempotencyInput = {
      approvalId: input.approvalId,
      expectedApprovalRevision: input.expectedApprovalRevision,
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resourceId: input.resourceId,
      expectedFingerprint: input.expectedFingerprint,
      actor: {
        type: executedActor.actorType,
        identityHash: executedActor.actorIdentityHash
      }
    };
    if (context.actorType === "remote-mcp") {
      this.assertRemoteExecutionDecisionProvenance(
        this.repositories.runtimeResourceMutations.getApproval(input.approvalId)
      );
    }

    const replay = this.repositories.idempotency.replay<{
      ok: true;
      approval: RuntimeResourceMutationApprovalRecord;
      execution: RuntimeResourceMutationExecutionRecord;
    }>("runtime.resource.mutation.execute", input.idempotencyKey, idempotencyInput);
    if (replay) return { ...replay.value, replayed: true };

    const approval = this.requireExecutableApproval(input);
    const semantics = mutationSemantics(approval.operation);
    const preflight = await this.inventory.readTarget({
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId,
      resourceId: input.resourceId,
      resourceKind: semantics.resourceKind
    });
    const before = preflight.resource;
    if (!before) {
      this.invalidateApprovalForDrift(
        approval,
        "Approved Runtime Resource disappeared before execution"
      );
    }
    try {
      const eligibility = assessRuntimeResourceMutationEligibility({
        profile: preflight.profile,
        resource: before,
        operation: approval.operation,
        pluginMutationAvailable: this.codexPlugins !== null
      });
      if (!eligibility.eligible) {
        throw new ServiceError(
          "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
          eligibility.publicReason
        );
      }
      this.assertApprovalStillMatches(approval, preflight.profile, before, input);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        [
          "RUNTIME_RESOURCE_MUTATION_STALE",
          "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED"
        ].includes(error.code)
      ) {
        this.invalidateApprovalForDrift(
          approval,
          "Approved Runtime Resource changed before execution"
        );
      }
      throw error;
    }
    if (
      hashRuntimeResource(approval.requestedState) !==
      hashRuntimeResource(semantics.requestedState)
    ) {
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
          providerMethod: semantics.providerMethod,
          executedActor,
          now
        });
        return {
          approval: consumed,
          execution,
          profile: preflight.profile,
          before
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

  private assertRemoteExecutionDecisionProvenance(
    approval: RuntimeResourceMutationApprovalRecord
  ): void {
    if (
      approval.decidedActorType === null ||
      !REMOTE_EXECUTE_DECISION_ACTORS.has(approval.decidedActorType)
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_EXECUTION_FORBIDDEN",
        "Remote MCP execution requires an approval decided by an operator surface"
      );
    }
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
    if (approval.status === "stale") {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_STALE",
        "Runtime Resource mutation approval is stale and must be prepared again"
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

  private invalidateApprovalForDrift(
    approval: RuntimeResourceMutationApprovalRecord,
    message: string
  ): never {
    this.repositories.runtimeResourceMutations.markStale({
      id: approval.id,
      expectedRevision: approval.revision,
      now: this.now()
    });
    throw new ServiceError("RUNTIME_RESOURCE_MUTATION_STALE", message);
  }

  private assertApprovalStillMatches(
    approval: RuntimeResourceMutationApprovalRecord,
    profile: RuntimeProfileDescriptor,
    resource: RuntimeResourceDescriptor,
    input: RuntimeResourceMutationExecuteInput
  ): void {
    const semantics = mutationSemantics(approval.operation);
    const requestedStateMatches =
      hashRuntimeResource(approval.requestedState) ===
      hashRuntimeResource(semantics.requestedState);
    const hashMatches = runtimeResourceMutationHashMatches(
      approval.mutationHash,
      {
        operation: approval.operation,
        runtimeProfileId: profile.id,
        workspaceId: input.workspaceId,
        resource,
        beforeSnapshotId: approval.beforeSnapshotId,
        providerKind: profile.providerKind,
        protocolKind: profile.protocolKind
      }
    );
    if (
      resource.fingerprint !== approval.beforeFingerprint ||
      resource.scope !== approval.resourceScope ||
      resource.kind !== approval.resourceKind ||
      resource.kind !== semantics.resourceKind ||
      !requestedStateMatches ||
      !hashMatches
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
    const semantics = mutationSemantics(prepared.approval.operation);
    let providerError: string | null = null;
    let providerEvidence: Record<string, unknown> = {};
    try {
      switch (prepared.approval.operation) {
        case "skill.enable":
        case "skill.disable":
          await this.codexSkills.setEnabled({
            profile: prepared.profile,
            workspaceId: prepared.approval.workspaceId!,
            resourceId: prepared.before.id,
            expectedFingerprint: prepared.before.fingerprint,
            desiredEnabled: semantics.requestedState.enabled!
          });
          break;
        case "plugin.install": {
          const plugins = this.requirePluginAdapter();
          const result = await plugins.install({
            profile: prepared.profile,
            workspaceId: prepared.approval.workspaceId!,
            resourceId: prepared.before.id,
            expectedFingerprint: prepared.before.fingerprint
          });
          providerEvidence = {
            authPolicy: result.authPolicy,
            appsNeedingAuthCount: result.appsNeedingAuthCount
          };
          break;
        }
        case "plugin.uninstall":
          await this.requirePluginAdapter().uninstall({
            profile: prepared.profile,
            workspaceId: prepared.approval.workspaceId!,
            resourceId: prepared.before.id,
            expectedFingerprint: prepared.before.fingerprint
          });
          break;
      }
    } catch (error) {
      providerError = errorCode(error);
    }

    const maxPostflightAttempts =
      semantics.resourceKind === "plugin" ? this.pluginPostflightMaxAttempts : 1;
    let lastObservedOutcome: ExternalExecutionOutcome | null = null;
    let lastReadErrorCode: string | null = null;

    for (let attempt = 1; attempt <= maxPostflightAttempts; attempt += 1) {
      try {
        const after = await this.inventory.readTarget({
          runtimeProfileId: prepared.profile.id,
          workspaceId: prepared.approval.workspaceId!,
          resourceId: prepared.before.id,
          resourceKind: semantics.resourceKind
        });
        const resource = after.resource ?? undefined;
        const observedState = {
          ...semantics.observedState(resource),
          ...providerEvidence
        };

        if (isPreWriteStaleCode(providerError)) {
          return {
            status: "stale",
            afterSnapshotId: null,
            afterFingerprint: resource?.fingerprint ?? null,
            observedState,
            errorCode: providerError
          };
        }
        if (semantics.isVerified(resource)) {
          return {
            status: "verified",
            afterSnapshotId: null,
            afterFingerprint: resource!.fingerprint,
            observedState,
            errorCode: null
          };
        }

        lastObservedOutcome = {
          status: providerError ? "failed-external" : "failed-verification",
          afterSnapshotId: null,
          afterFingerprint: resource?.fingerprint ?? null,
          observedState,
          errorCode:
            providerError ?? "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED"
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
        lastReadErrorCode =
          error instanceof ServiceError
            ? error.code
            : "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED";
      }

      if (attempt < maxPostflightAttempts && semantics.resourceKind === "plugin") {
        if (this.pluginPostflightDelayMs > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, this.pluginPostflightDelayMs);
          });
        }
        continue;
      }
      break;
    }

    if (lastObservedOutcome) return lastObservedOutcome;
    return {
      status: providerError ? "failed-external" : "failed-verification",
      afterSnapshotId: null,
      afterFingerprint: null,
      observedState: null,
      errorCode:
        providerError ??
        lastReadErrorCode ??
        "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED"
    };
  }

  private requirePluginAdapter(): CodexPluginMutationAdapter {
    if (!this.codexPlugins) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_MUTATION_UNSUPPORTED",
        "Codex Plugin mutation adapter is unavailable"
      );
    }
    return this.codexPlugins;
  }

}
