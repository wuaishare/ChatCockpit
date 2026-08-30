import type { OperationContext } from "./operation-context.js";

export interface RemoteFullAccessPolicy {
  allowsLocalFullAccess(grantId: string): boolean;
}

export function hasRemoteFullAccess(
  context: OperationContext,
  policy: RemoteFullAccessPolicy | null | undefined
): boolean {
  return Boolean(
    policy &&
      context.actorType === "remote-mcp" &&
      context.authorizationGrantId &&
      policy.allowsLocalFullAccess(context.authorizationGrantId)
  );
}
