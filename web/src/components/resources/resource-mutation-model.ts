import type {
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryResponse,
  RuntimeResourceMutationApproval,
  RuntimeResourceMutationEligibility,
  RuntimeResourceMutationOperation
} from "../../types";

export function eligibleMutationsForResource(
  inventory: RuntimeResourceInventoryResponse,
  resourceId: string
): RuntimeResourceMutationEligibility[] {
  return (
    inventory.mutationEligibility.find((entry) => entry.resourceId === resourceId)
      ?.operations ?? []
  ).filter((operation) => operation.eligible);
}

export function mutationOperationMatchesResourceState(
  resource: RuntimeResourceDescriptor | undefined,
  operation: RuntimeResourceMutationOperation
): boolean {
  if (!resource) return false;
  switch (operation) {
    case "skill.enable":
      return resource.kind === "skill" && resource.enabled === true;
    case "skill.disable":
      return resource.kind === "skill" && resource.enabled === false;
    case "plugin.install":
      return resource.kind === "plugin" && resource.installed === true;
    case "plugin.uninstall":
      return resource.kind === "plugin" && resource.installed === false;
  }
}

export function isDestructiveMutation(
  operation: RuntimeResourceMutationOperation
): boolean {
  return operation === "plugin.uninstall";
}

export function mutationApprovalState(
  approval: RuntimeResourceMutationApproval
): { before: boolean | null; requested: boolean | null } {
  if (approval.operation === "skill.enable" || approval.operation === "skill.disable") {
    return {
      before:
        typeof approval.publicSummary.beforeEnabled === "boolean"
          ? approval.publicSummary.beforeEnabled
          : null,
      requested:
        typeof approval.publicSummary.requestedEnabled === "boolean"
          ? approval.publicSummary.requestedEnabled
          : null
    };
  }
  return {
    before:
      typeof approval.publicSummary.beforeInstalled === "boolean"
        ? approval.publicSummary.beforeInstalled
        : null,
    requested:
      typeof approval.publicSummary.requestedInstalled === "boolean"
        ? approval.publicSummary.requestedInstalled
        : null
  };
}
