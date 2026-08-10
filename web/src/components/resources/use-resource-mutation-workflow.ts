import { App as AntApp } from "antd";
import { useState, type Dispatch, type SetStateAction } from "react";

import {
  decideRuntimeResourceMutation,
  executeRuntimeResourceMutation,
  fetchRuntimeResourceMutationActivity,
  inventoryRuntimeResources,
  prepareRuntimeResourceMutation
} from "../../api";
import type { ResourceCenterCopy } from "../../i18n/resources";
import type {
  ApiProblem,
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryResponse,
  RuntimeResourceMutationActivityResponse,
  RuntimeResourceMutationApproval,
  RuntimeResourceMutationExecution,
  RuntimeResourceMutationOperation
} from "../../types";
import { mutationOperationMatchesResourceState } from "./resource-mutation-model";

interface ResourceMutationWorkflowOptions {
  token: string | null;
  copy: ResourceCenterCopy;
  inventory: RuntimeResourceInventoryResponse | null;
  selectedProfileId: string | null;
  selectedWorkspaceId: string | null;
  setInventory: Dispatch<SetStateAction<RuntimeResourceInventoryResponse | null>>;
}

function mutationOperationKey(stage: "prepare" | "decision" | "execute"): string {
  return `resources.mutation.${stage}.web:${crypto.randomUUID()}`;
}

function inventoryOperationKey(): string {
  return `resources.inventory.web:${crypto.randomUUID()}`;
}

function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiProblem).message || fallback);
  }
  return fallback;
}

export function useResourceMutationWorkflow({
  token,
  copy,
  inventory,
  selectedProfileId,
  selectedWorkspaceId,
  setInventory
}: ResourceMutationWorkflowOptions) {
  const { message } = AntApp.useApp();
  const [mutationApproval, setMutationApproval] =
    useState<RuntimeResourceMutationApproval | null>(null);
  const [mutationExecution, setMutationExecution] =
    useState<RuntimeResourceMutationExecution | null>(null);
  const [mutationReviewOpen, setMutationReviewOpen] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationPendingResourceId, setMutationPendingResourceId] = useState<
    string | null
  >(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationActivity, setMutationActivity] =
    useState<RuntimeResourceMutationActivityResponse | null>(null);
  const [mutationActivityLoading, setMutationActivityLoading] = useState(false);

  async function loadMutationActivity(
    workspaceId: string,
    resourceId?: string
  ): Promise<RuntimeResourceMutationActivityResponse | null> {
    setMutationActivityLoading(true);
    try {
      const result = await fetchRuntimeResourceMutationActivity(
        {
          workspaceId,
          ...(resourceId ? { resourceId } : {}),
          limit: 20
        },
        token
      );
      setMutationActivity(result);
      return result;
    } catch {
      setMutationActivity(null);
      return null;
    } finally {
      setMutationActivityLoading(false);
    }
  }

  async function readAuthoritativeInventory(
    runtimeProfileId: string,
    workspaceId: string
  ): Promise<RuntimeResourceInventoryResponse> {
    return inventoryRuntimeResources(
      {
        runtimeProfileId,
        workspaceId,
        idempotencyKey: inventoryOperationKey()
      },
      token
    );
  }

  async function prepareMutation(
    resource: RuntimeResourceDescriptor,
    operation: RuntimeResourceMutationOperation
  ): Promise<void> {
    if (!inventory || !selectedProfileId || !selectedWorkspaceId) return;
    if (!inventory.mutationWritesEnabled) {
      message.warning(copy.mutationExposureDisabled);
      return;
    }

    setMutationBusy(true);
    setMutationPendingResourceId(resource.id);
    setMutationApproval(null);
    setMutationExecution(null);
    setMutationError(null);
    try {
      const prepared = await prepareRuntimeResourceMutation(
        {
          operation,
          runtimeProfileId: selectedProfileId,
          workspaceId: selectedWorkspaceId,
          resourceId: resource.id,
          expectedSnapshotId: inventory.snapshot.id,
          expectedFingerprint: resource.fingerprint,
          idempotencyKey: mutationOperationKey("prepare")
        },
        token
      );
      setMutationApproval(prepared.approval);
      setMutationReviewOpen(true);
      await loadMutationActivity(selectedWorkspaceId);
    } catch (prepareError) {
      const problem = prepareError as ApiProblem;
      if (problem?.code === "RUNTIME_RESOURCE_MUTATION_EXPOSURE_DISABLED") {
        setInventory((current) =>
          current ? { ...current, mutationWritesEnabled: false } : current
        );
        message.warning(copy.mutationExposureDisabled);
      } else {
        message.error(problemMessage(prepareError, copy.mutationFailedTitle));
      }
    } finally {
      setMutationPendingResourceId(null);
      setMutationBusy(false);
    }
  }

  async function recoverMutationEvidence(
    approval: RuntimeResourceMutationApproval
  ): Promise<void> {
    const activity = await loadMutationActivity(approval.workspaceId);
    if (!activity) return;
    const latestApproval = activity.approvals.find((entry) => entry.id === approval.id);
    if (latestApproval) setMutationApproval(latestApproval);
    const execution = activity.executions.find(
      (entry) => entry.approvalId === approval.id
    );
    if (execution) setMutationExecution(execution);
  }

  async function approveAndExecuteMutation(): Promise<void> {
    if (!mutationApproval || mutationApproval.status !== "pending") return;
    const preparedApproval = mutationApproval;
    setMutationBusy(true);
    setMutationError(null);
    try {
      const decision = await decideRuntimeResourceMutation(
        {
          approvalId: preparedApproval.id,
          expectedRevision: preparedApproval.revision,
          decision: "approved",
          idempotencyKey: mutationOperationKey("decision")
        },
        token
      );
      setMutationApproval(decision.approval);

      const executionResult = await executeRuntimeResourceMutation(
        {
          approvalId: decision.approval.id,
          expectedApprovalRevision: decision.approval.revision,
          runtimeProfileId: decision.approval.runtimeProfileId,
          workspaceId: decision.approval.workspaceId,
          resourceId: decision.approval.resourceId,
          expectedFingerprint: decision.approval.beforeFingerprint,
          idempotencyKey: mutationOperationKey("execute")
        },
        token
      );
      setMutationApproval(executionResult.approval);
      setMutationExecution(executionResult.execution);

      const refreshed = await readAuthoritativeInventory(
        executionResult.approval.runtimeProfileId,
        executionResult.approval.workspaceId
      );
      setInventory(refreshed);
      await loadMutationActivity(executionResult.approval.workspaceId);

      const authoritativeResource = refreshed.resources.find(
        (resource) => resource.id === executionResult.approval.resourceId
      );
      const verified =
        executionResult.execution.verificationStatus === "verified" &&
        mutationOperationMatchesResourceState(
          authoritativeResource,
          executionResult.approval.operation
        );
      if (verified) {
        message.success(copy.mutationSuccessTitle);
        setMutationReviewOpen(false);
      } else {
        setMutationError(copy.authoritativeRefreshRequired);
        message.error(copy.mutationFailedTitle);
      }
    } catch (mutationFailure) {
      const messageText = problemMessage(mutationFailure, copy.mutationFailedTitle);
      setMutationError(messageText);
      await recoverMutationEvidence(preparedApproval);
      message.error(messageText);
    } finally {
      setMutationBusy(false);
    }
  }

  async function denyMutation(): Promise<void> {
    if (!mutationApproval || mutationApproval.status !== "pending") return;
    const pendingApproval = mutationApproval;
    setMutationBusy(true);
    setMutationError(null);
    try {
      const denied = await decideRuntimeResourceMutation(
        {
          approvalId: pendingApproval.id,
          expectedRevision: pendingApproval.revision,
          decision: "denied",
          idempotencyKey: mutationOperationKey("decision")
        },
        token
      );
      setMutationApproval(denied.approval);
      await loadMutationActivity(denied.approval.workspaceId);
      setMutationReviewOpen(false);
      message.success(copy.deniedMutation);
    } catch (denyError) {
      const messageText = problemMessage(denyError, copy.mutationFailedTitle);
      setMutationError(messageText);
      await recoverMutationEvidence(pendingApproval);
      message.error(messageText);
    } finally {
      setMutationBusy(false);
    }
  }

  function reopenPendingMutation(approval: RuntimeResourceMutationApproval): void {
    setMutationApproval(approval);
    setMutationExecution(
      mutationActivity?.executions.find((entry) => entry.approvalId === approval.id) ?? null
    );
    setMutationError(null);
    setMutationReviewOpen(true);
  }

  function closeMutationReview(): void {
    if (mutationBusy) return;
    setMutationReviewOpen(false);
    setMutationError(null);
  }

  function resetMutationWorkflow(): void {
    setMutationActivity(null);
    setMutationApproval(null);
    setMutationExecution(null);
    setMutationReviewOpen(false);
    setMutationError(null);
    setMutationPendingResourceId(null);
  }

  return {
    mutationApproval,
    mutationExecution,
    mutationReviewOpen,
    mutationBusy,
    mutationPendingResourceId,
    mutationError,
    mutationActivity,
    mutationActivityLoading,
    loadMutationActivity,
    prepareMutation,
    approveAndExecuteMutation,
    denyMutation,
    reopenPendingMutation,
    closeMutationReview,
    resetMutationWorkflow
  };
}
