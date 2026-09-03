import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { DirectProcessStatus, TaskPriority, TaskStatus } from "../continuity/types.js";
import type {
  McpConnectionProjection,
  McpConnectionRegistry
} from "../mcp/connection-registry.js";
import type {
  OperationalActivityProjection,
  OperationalActivityService,
  OperationalActivityStatus
} from "./operational-activity-service.js";
import type { OperationContext } from "./operation-context.js";
import type { ProjectService } from "./project-service.js";

export interface ProjectExecutionTaskProjection {
  id: string;
  workspaceId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  activeSessionId: string | null;
  updatedAt: string;
}

export interface ProjectExecutionConnectionProjection
  extends Omit<McpConnectionProjection, "authorizationGrantId" | "clientRegistrationId"> {}

export interface ProjectExecutionProcessProjection {
  id: string;
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
  executorId: string;
  command: string;
  status: DirectProcessStatus;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
  revision: number;
}

export interface ProjectExecutionActivityProjection extends Omit<OperationalActivityProjection, "authorizationGrantId"> {
  taskTitle: string | null;
  connectionIds: string[];
}

export interface ProjectExecutionObservabilitySnapshot {
  projectId: string;
  generatedAt: string;
  activities: ProjectExecutionActivityProjection[];
  tasks: ProjectExecutionTaskProjection[];
  processes: ProjectExecutionProcessProjection[];
  connections: ProjectExecutionConnectionProjection[];
  counts: {
    activeActivities: number;
    runningActivities: number;
    waitingApproval: number;
    activeTasks: number;
    runningProcesses: number;
    activeConnections: number;
  };
}

const TERMINAL_ACTIVITY = new Set<OperationalActivityStatus>([
  "completed",
  "failed",
  "interrupted",
  "terminated",
  "stale"
]);

const TERMINAL_TASKS = new Set<TaskStatus>(["completed", "cancelled"]);

function boundedCommand(command: string): string {
  const normalized = command.replace(/[\r\n\t]+/g, " ").trim();
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`;
}

/**
 * Machine-local Owner projection that correlates existing Project/Task/Session/Runtime,
 * direct process and MCP connection truth without creating a second execution store.
 */
export class ProjectExecutionObservabilityService {
  constructor(
    private readonly projects: ProjectService,
    private readonly activities: OperationalActivityService,
    private readonly repositories: ContinuityRepositories,
    private readonly connections: McpConnectionRegistry
  ) {}

  snapshot(context: OperationContext, projectId: string): ProjectExecutionObservabilitySnapshot {
    const project = this.projects.registryProject(context, projectId);
    const workspaceIds = new Set(project.workspaces.map((workspace) => workspace.id));
    const repoIds = new Set(project.workspaces.map((workspace) => workspace.repoId));
    const tasks = this.repositories.tasks.listByProject(projectId)
      .map((task): ProjectExecutionTaskProjection => ({
        id: task.id,
        workspaceId: task.workspaceId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        activeSessionId: task.activeSessionId,
        updatedAt: task.updatedAt
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));

    const baseActivities = this.activities.list().activities.filter((activity) =>
      activity.projectId === projectId ||
      (activity.workspaceId ? workspaceIds.has(activity.workspaceId) : false) ||
      (activity.repoId ? repoIds.has(activity.repoId) : false)
    );
    const grantIds = new Set(
      baseActivities
        .map((activity) => activity.authorizationGrantId)
        .filter((value): value is string => Boolean(value))
    );
    const linkedConnections = this.connections.list(context.now).filter((connection) =>
      grantIds.has(connection.authorizationGrantId)
    );
    const connectionsByGrant = new Map<string, string[]>();
    for (const connection of linkedConnections) {
      const ids = connectionsByGrant.get(connection.authorizationGrantId) ?? [];
      ids.push(connection.id);
      connectionsByGrant.set(connection.authorizationGrantId, ids);
    }

    const connections: ProjectExecutionConnectionProjection[] = linkedConnections.map((connection) => {
      const { authorizationGrantId: _grant, clientRegistrationId: _client, ...safe } = connection;
      return safe;
    });

    const activities = baseActivities.map((activity): ProjectExecutionActivityProjection => {
      const { authorizationGrantId, ...safeActivity } = activity;
      return {
        ...safeActivity,
        taskTitle: activity.taskId ? taskTitles.get(activity.taskId) ?? null : null,
        connectionIds: authorizationGrantId
          ? [...(connectionsByGrant.get(authorizationGrantId) ?? [])]
          : []
      };
    });

    const allProcesses = project.workspaces
      .flatMap((workspace) => this.repositories.directProcessSessions.list({ workspaceId: workspace.id }))
      .map((process): ProjectExecutionProcessProjection => ({
        id: process.id,
        workspaceId: process.workspaceId,
        repoId: process.repoId,
        sessionId: process.sessionId,
        executorId: process.executorId,
        command: boundedCommand(process.command),
        status: process.status,
        exitCode: process.exitCode,
        startedAt: process.startedAt,
        completedAt: process.completedAt,
        revision: process.revision
      }))
      .sort((left, right) => {
        const leftActive = left.status === "starting" || left.status === "running";
        const rightActive = right.status === "starting" || right.status === "running";
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        return right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id);
      });
    const processes = allProcesses.slice(0, 100);

    return {
      projectId,
      generatedAt: context.now,
      activities,
      tasks,
      processes,
      connections,
      counts: {
        activeActivities: activities.filter((activity) => !TERMINAL_ACTIVITY.has(activity.status)).length,
        runningActivities: activities.filter((activity) => activity.status === "running").length,
        waitingApproval: activities.filter((activity) => activity.status === "waiting-approval").length,
        activeTasks: tasks.filter((task) => !TERMINAL_TASKS.has(task.status)).length,
        runningProcesses: allProcesses.filter((process) => process.status === "running").length,
        activeConnections: connections.filter((connection) => connection.state === "active").length
      }
    };
  }
}
