import { buildOperationContext } from "../application/operation-context.js";
import { productIdentityForKey } from "../core/product-identity.js";
import type { TokenPilotPaths } from "../types.js";

export function buildRunnerOperationContext(
  paths: TokenPilotPaths,
  jobId: string,
  now = new Date().toISOString()
) {
  const identity = productIdentityForKey(paths.productIdentity);
  return buildOperationContext({
    requestId: `runner:${jobId}`,
    actorType: "runner",
    actorId: identity.asyncRunnerRuntimeKind,
    publicProjection: false,
    now
  });
}
