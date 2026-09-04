import type {
  ProductActionId,
  ProductActionTargetAvailability,
  ProductActionsResponse
} from "./types";

export function productActionTargets(
  productActions: ProductActionsResponse | null,
  actionId: ProductActionId
): ProductActionTargetAvailability[] {
  return productActions?.actions.find((action) => action.id === actionId)?.targets ?? [];
}

export function hasLocalProductActionPath(
  productActions: ProductActionsResponse | null,
  actionId: ProductActionId
): boolean {
  return productActionTargets(productActions, actionId).some(
    (target) =>
      target.locality === "local" &&
      target.availability === "available-local" &&
      target.executionMode === "local-runtime"
  );
}
