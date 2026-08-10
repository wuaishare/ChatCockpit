import { buildOperationContext } from "../application/operation-context.js";
import { isExposedMode } from "./auth.js";

export function operationContextFromRequest(request: unknown) {
  return buildOperationContext({
    requestId: (request as { id?: string }).id ?? "unknown-request",
    actorType: isExposedMode() ? "rest-api" : "local-ui",
    publicProjection: true
  });
}
