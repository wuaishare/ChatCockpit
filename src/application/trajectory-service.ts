import type {
  TrajectoryProjection,
  TrajectoryReadInput
} from "../contracts/continuity-observability.js";
import type { OperationalActivityService } from "./operational-activity-service.js";
import { ServiceError } from "./service-error.js";

export class TrajectoryService {
  constructor(private readonly activities: OperationalActivityService) {}

  find(activityId: string, limit: number): TrajectoryProjection | null {
    const activity = this.activities.list().activities.find((item) => item.id === activityId);
    if (!activity) return null;
    const timeline = this.activities.timeline(activity.id, limit);
    if (!timeline) return null;
    return {
      version: "1",
      activity: {
        id: activity.id,
        kind: activity.kind,
        scope: activity.scope,
        status: activity.status,
        title: activity.title,
        targetDeviceId: activity.targetDeviceId,
        projectId: activity.projectId,
        workspaceId: activity.workspaceId,
        taskId: activity.taskId,
        repoId: activity.repoId,
        agentSessionId: activity.agentSessionId,
        runtime: activity.runtime ? {
          runtimeKind: activity.runtime.runtimeKind,
          externalThreadId: activity.runtime.externalThreadId,
          turnId: activity.runtime.turnId,
          runStatus: activity.runtime.runStatus
        } : null,
        startedAt: activity.startedAt,
        updatedAt: activity.updatedAt,
        endedAt: activity.endedAt
      },
      events: timeline.events.map((event) => ({
        id: event.id,
        kind: event.kind,
        category: event.category,
        code: event.code,
        itemType: event.itemType,
        createdAt: event.createdAt
      })),
      limit,
      bounded: true
    };
  }

  read(input: TrajectoryReadInput): TrajectoryProjection {
    const trajectory = this.find(input.activityId, input.limit);
    if (!trajectory) {
      throw new ServiceError(
        "TRAJECTORY_ACTIVITY_NOT_FOUND",
        "Operational activity was not found"
      );
    }
    return trajectory;
  }
}
