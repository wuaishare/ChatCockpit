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
  publicProjection: boolean;
  now: string;
}

export interface OperationContextInput {
  requestId: string;
  actorType: ActorType;
  actorId?: string | null;
  publicProjection?: boolean;
  now?: string;
}

export function buildOperationContext(input: OperationContextInput): OperationContext {
  return {
    requestId: input.requestId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    publicProjection: input.publicProjection ?? false,
    now: input.now ?? new Date().toISOString()
  };
}
