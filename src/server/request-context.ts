import { buildOperationContext } from "../application/operation-context.js";
import { isExposedMode } from "./auth.js";
import type { RequestAuthContext } from "./operator-auth-context.js";

interface OperationContextRequest {
  id?: string;
  chatCockpitAuth?: RequestAuthContext;
}

export function operationContextFromRequest(request: unknown) {
  const projected = request as OperationContextRequest;
  const auth = projected.chatCockpitAuth ?? { kind: "anonymous" as const };
  const requestId = projected.id ?? "unknown-request";

  if (auth.kind === "operator-session") {
    return buildOperationContext({
      requestId,
      actorType: "local-ui",
      actorId: auth.session.principalId,
      publicProjection: true
    });
  }

  if (auth.kind === "machine-bearer") {
    return buildOperationContext({
      requestId,
      actorType: "rest-api",
      publicProjection: true
    });
  }

  if (auth.kind === "mcp-oauth") {
    return buildOperationContext({
      requestId,
      actorType: "remote-mcp",
      actorId: auth.authorizationGrantId,
      authorizationGrantId: auth.authorizationGrantId,
      publicProjection: true
    });
  }

  return buildOperationContext({
    requestId,
    actorType: isExposedMode() ? "rest-api" : "local-ui",
    publicProjection: true
  });
}
