// `local-ui` is a legacy provenance label for an interactive Operator UI surface.
// It describes authority/source semantics, not network locality or a localhost-only requirement.
export type ActorType =
  | "local-cli"
  | "local-ui"
  | "rest-api"
  | "gpt-actions"
  | "remote-mcp"
  | "runner";

export interface OperationContext {
  requestId: string;
  actorType: ActorType;
  actorId: string | null;
  authorizationGrantId: string | null;
  publicProjection: boolean;
  now: string;
}

export interface OperationContextInput {
  requestId: string;
  actorType: ActorType;
  actorId?: string | null;
  authorizationGrantId?: string | null;
  publicProjection?: boolean;
  now?: string;
}

export function buildOperationContext(input: OperationContextInput): OperationContext {
  return {
    requestId: input.requestId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    authorizationGrantId: input.authorizationGrantId ?? null,
    publicProjection: input.publicProjection ?? false,
    now: input.now ?? new Date().toISOString()
  };
}
