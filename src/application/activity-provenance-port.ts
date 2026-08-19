import type { OperationContext } from "./operation-context.js";

export interface ActivityProvenanceRecordProjection {
  activityId: string;
  activityKind: "agent-session" | "job";
  authorizationGrantId: string | null;
  traceId: string;
  workerInstanceId: string | null;
  updatedAt: string;
}

export interface ActivityProvenanceRecorder {
  recordFromContext(
    context: OperationContext,
    input: { activityId: string; activityKind: "agent-session" | "job" }
  ): ActivityProvenanceRecordProjection;
}

export interface ActivityProvenanceReader {
  get(activityId: string): ActivityProvenanceRecordProjection | null;
}
