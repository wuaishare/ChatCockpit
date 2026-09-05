import type {
  ProductActionId,
  ProductActionTargetAvailability,
  ProductActionsResponse
} from "./types";

export function productActionTargets(
  productActions: ProductActionsResponse | null | undefined,
  actionId: ProductActionId
): ProductActionTargetAvailability[] {
  return productActions?.actions.find((action) => action.id === actionId)?.targets ?? [];
}

export function isProductActionTargetAvailable(
  target: ProductActionTargetAvailability
): boolean {
  return target.availability === "available-local" || target.availability === "available-targeted";
}

export function isProductActionTargetExecutionPath(
  target: ProductActionTargetAvailability
): boolean {
  return target.executionMode !== "none" && (
    isProductActionTargetAvailable(target) ||
    target.availability === "approval-required"
  );
}

export function isLocalProductActionExecutionPath(
  target: ProductActionTargetAvailability
): boolean {
  return target.locality === "local" &&
    target.executionMode === "local-runtime" &&
    isProductActionTargetExecutionPath(target);
}

export function isLocalProductActionPath(
  target: ProductActionTargetAvailability
): boolean {
  return target.locality === "local" &&
    target.availability === "available-local" &&
    target.executionMode === "local-runtime";
}

export function isRemoteProductActionPath(
  target: ProductActionTargetAvailability
): boolean {
  return target.locality === "remote" &&
    target.availability === "available-targeted" &&
    target.executionMode === "remote-device-rpc";
}

export function localProductActionTarget(
  targets: readonly ProductActionTargetAvailability[]
): ProductActionTargetAvailability | null {
  return targets.find((target) => target.locality === "local") ?? null;
}

export function availableProductActionTargets(
  targets: readonly ProductActionTargetAvailability[]
): ProductActionTargetAvailability[] {
  return targets.filter(isProductActionTargetAvailable);
}

export function productActionTargetRequiresLocalHost(
  target: ProductActionTargetAvailability | null | undefined
): boolean {
  return target?.availability === "requires-local-host";
}

export function hasLocalProductActionPath(
  productActions: ProductActionsResponse | null | undefined,
  actionId: ProductActionId
): boolean {
  return productActionTargets(productActions, actionId).some(isLocalProductActionPath);
}

export function hasRemoteProductActionPath(
  productActions: ProductActionsResponse | null | undefined,
  actionId: ProductActionId,
  deviceId?: string
): boolean {
  return productActionTargets(productActions, actionId).some(
    (target) =>
      (!deviceId || target.deviceId === deviceId) &&
      isRemoteProductActionPath(target)
  );
}
