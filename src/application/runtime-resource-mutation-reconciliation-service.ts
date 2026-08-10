import { randomUUID } from "node:crypto";

import { hashRuntimeResource } from "./runtime-resource-hash.js";
import type { RuntimeResourceInventoryService } from "./runtime-resource-inventory-service.js";
import { mutationSemantics } from "./runtime-resource-mutation-semantics.js";
import { ServiceError } from "./service-error.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { RuntimeResourceMutationExecutionRecord } from "../continuity/repositories/runtime-resource-mutation-repository.js";

export interface RuntimeResourceMutationReconcileInput {
  executionId: string;
  idempotencyKey: string;
}

export interface RuntimeResourceMutationReconcileResult {
  ok: true;
  execution: RuntimeResourceMutationExecutionRecord;
  replayed: boolean;
}

/**
 * Reconciles a Resource mutation whose provider-side outcome may already have
 * happened while TokenPilot's final persistence step did not complete.
 *
 * This service is deliberately read-only with respect to the provider. It may
 * refresh authoritative inventory and finalize TokenPilot evidence, but it
 * must never replay `skills/config/write` or any other provider mutation.
 * The original execute idempotency reservation is intentionally left pending:
 * callers must reconcile the known execution rather than retry the side effect.
 */
export class RuntimeResourceMutationReconciliationService {
  private readonly now: () => string;

  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly inventory: RuntimeResourceInventoryService,
    options: { now?: () => string } = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async reconcile(
    input: RuntimeResourceMutationReconcileInput
  ): Promise<RuntimeResourceMutationReconcileResult> {
    const idempotencyInput = { executionId: input.executionId };
    const replay = this.repositories.idempotency.replay<{
      ok: true;
      execution: RuntimeResourceMutationExecutionRecord;
    }>("runtime.resource.mutation.reconcile", input.idempotencyKey, idempotencyInput);
    if (replay) {
      return { ...replay.value, replayed: true };
    }

    const execution = this.repositories.runtimeResourceMutations.getExecution(
      input.executionId
    );
    if (execution.verificationStatus !== "executing") {
      const completed = this.repositories.idempotency.execute(
        "runtime.resource.mutation.reconcile",
        input.idempotencyKey,
        idempotencyInput,
        () => ({ ok: true as const, execution }),
        this.now()
      );
      return { ...completed.value, replayed: completed.replayed };
    }
    if (!execution.workspaceId) {
      throw new ServiceError(
        "CONTINUITY_DATA_INVALID",
        "Runtime Resource mutation execution has no Workspace identity"
      );
    }
    const semantics = mutationSemantics(execution.operation);
    if (
      hashRuntimeResource(execution.requestedState) !==
      hashRuntimeResource(semantics.requestedState)
    ) {
      throw new ServiceError(
        "CONTINUITY_DATA_INVALID",
        "Runtime Resource mutation execution requested state is invalid"
      );
    }

    const observed = await this.inventory.inventory({
      runtimeProfileId: execution.runtimeProfileId,
      workspaceId: execution.workspaceId,
      idempotencyKey: `resource-mutation-reconcile:${input.idempotencyKey}:${randomUUID()}`
    });
    const resource = observed.resources.find(
      (candidate) => candidate.id === execution.resourceId
    );
    const verified = semantics.isVerified(resource);
    const reconciled = this.repositories.runtimeResourceMutations.finishExecution({
      id: execution.id,
      status: verified ? "verified" : "failed-verification",
      afterSnapshotId: observed.snapshot.id,
      afterFingerprint: resource?.fingerprint ?? null,
      observedState: semantics.observedState(resource),
      errorCode: verified
        ? null
        : "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED",
      now: this.now()
    });

    const completed = this.repositories.idempotency.execute(
      "runtime.resource.mutation.reconcile",
      input.idempotencyKey,
      idempotencyInput,
      () => ({ ok: true as const, execution: reconciled }),
      this.now()
    );
    return { ...completed.value, replayed: completed.replayed };
  }
}
