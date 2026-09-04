import type { DirectProcessScope, DirectProcessStatus, TaskPriority, TaskStatus } from "../continuity/types.js";
import { isChatDirectManagedProcessId } from "../core/managed-workspace-process.js";
import { LOCAL_DEVICE_TARGET_ID } from "../devices/local-device.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { McpConnectionProjection, McpConnectionRegistry } from "../mcp/connection-registry.js";
import type {
  OperationalActivityProjection,
  OperationalActivityService,
  OperationalActivityStatus
} from "./operational-activity-service.js";
import type { OperationContext } from "./operation-context.js";
import type { ProjectService } from "./project-service.js";

export interface RuntimeExecutionProjectRef {
  projectId: string | null;
  projectSlug: string | null;
  projectDisplayName: string | null;
}

export interface RuntimeExecutionActivityProjection
  extends Omit<OperationalActivityProjection, "authorizationGrantId">, RuntimeExecutionProjectRef {}

export interface RuntimeExecutionTaskProjection extends RuntimeExecutionProjectRef {
  id: string;
  workspaceId: string;
  repoId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  activeSessionId: string | null;
  updatedAt: string;
}
export interface RuntimeExecutionProcessProjection extends RuntimeExecutionProjectRef {
  id: string;
  scope: DirectProcessScope;
  deviceId: string;
  consoleSessionId: string;
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
  controls: {
    terminate: boolean;
  };
}

export interface RuntimeExecutionConnectionProjection
  extends Omit<McpConnectionProjection, "authorizationGrantId" | "clientRegistrationId"> {}

export interface RuntimeExecutionObservabilitySnapshot {
  generatedAt: string;
  activities: RuntimeExecutionActivityProjection[];
  tasks: RuntimeExecutionTaskProjection[];
  processes: RuntimeExecutionProcessProjection[];
  connections: RuntimeExecutionConnectionProjection[];
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

function projectRef(input: {
  id: string;
  slug: string;
  displayName: string;
} | null): RuntimeExecutionProjectRef {
  return input ? {
    projectId: input.id,
    projectSlug: input.slug,
    projectDisplayName: input.displayName
  } : {
    projectId: null,
    projectSlug: null,
    projectDisplayName: null
  };
}

/** Machine-local Owner projection for cross-Project live execution truth. */
export class RuntimeExecutionObservabilityService {
  constructor(
    private readonly projects: ProjectService,
    private readonly activities: OperationalActivityService,
    private readonly repositories: ContinuityRepositories,
    private readonly connections: McpConnectionRegistry
  ) {}
  snapshot(context: OperationContext): RuntimeExecutionObservabilitySnapshot {
    const registry = this.projects.registry(context);
    const projectById = new Map(
      registry.projects.map((entry) => [entry.project.id, entry.project] as const)
    );
    const workspaceMeta = new Map<string, {
      project: (typeof registry.projects)[number]["project"];
      repoId: string;
    }>();
    const repoProjects = new Map<string, Array<(typeof registry.projects)[number]["project"]>>();
    for (const entry of registry.projects) {
      for (const workspace of entry.workspaces) {
        workspaceMeta.set(workspace.id, { project: entry.project, repoId: workspace.repoId });
        const current = repoProjects.get(workspace.repoId) ?? [];
        if (!current.some((project) => project.id === entry.project.id)) current.push(entry.project);
        repoProjects.set(workspace.repoId, current);
      }
    }

    const resolveProject = (input: {
      projectId?: string | null;
      workspaceId?: string | null;
      repoId?: string | null;
    }) => {
      if (input.projectId) return projectById.get(input.projectId) ?? null;
      if (input.workspaceId) return workspaceMeta.get(input.workspaceId)?.project ?? null;
      if (input.repoId) {
        const matches = repoProjects.get(input.repoId) ?? [];
        return matches.length === 1 ? matches[0]! : null;
      }
      return null;
    };
    const activities = this.activities.list().activities.map((activity): RuntimeExecutionActivityProjection => {
      const { authorizationGrantId: _grant, ...safeActivity } = activity;
      return {
        ...safeActivity,
        ...projectRef(resolveProject(activity))
      };
    });

    const allTasks = registry.projects
      .flatMap((entry) => this.repositories.tasks.listByProject(entry.project.id).map((task) => {
        const workspace = workspaceMeta.get(task.workspaceId);
        return {
          id: task.id,
          workspaceId: task.workspaceId,
          repoId: workspace?.repoId ?? "unknown",
          title: task.title,
          status: task.status,
          priority: task.priority,
          activeSessionId: task.activeSessionId,
          updatedAt: task.updatedAt,
          ...projectRef(entry.project)
        } satisfies RuntimeExecutionTaskProjection;
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    const tasks = allTasks.slice(0, 100);

    const allProcesses = this.repositories.directProcessSessions.list()
      .map((process): RuntimeExecutionProcessProjection => ({
        id: process.id,
        scope: process.scope,
        deviceId: LOCAL_DEVICE_TARGET_ID,
        consoleSessionId: process.sessionId ?? `process:${process.id}`,
        workspaceId: process.workspaceId,
        repoId: process.repoId,
        sessionId: process.sessionId,
        executorId: process.executorId,
        command: boundedCommand(process.command),
        status: process.status,
        exitCode: process.exitCode,
        startedAt: process.startedAt,
        completedAt: process.completedAt,
        revision: process.revision,
        controls: {
          terminate:
            process.scope === "workspace" &&
            (process.status === "starting" || process.status === "running") &&
            isChatDirectManagedProcessId(process.id)
        },
        ...projectRef(resolveProject(process))
      }))
      .sort((left, right) => {
        const leftActive = left.status === "starting" || left.status === "running";
        const rightActive = right.status === "starting" || right.status === "running";
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        return right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id);
      });
    const processes = allProcesses.slice(0, 100);

    const connections = this.connections.list(context.now).map((connection) => {
      const { authorizationGrantId: _grant, clientRegistrationId: _client, ...safe } = connection;
      return safe;
    });

    return {
      generatedAt: context.now,
      activities,
      tasks,
      processes,
      connections,
      counts: {
        activeActivities: activities.filter((activity) => !TERMINAL_ACTIVITY.has(activity.status)).length,
        runningActivities: activities.filter((activity) => activity.status === "running").length,
        waitingApproval: activities.filter((activity) => activity.status === "waiting-approval").length,
        activeTasks: allTasks.filter((task) => !TERMINAL_TASKS.has(task.status)).length,
        runningProcesses: allProcesses.filter((process) => process.status === "running").length,
        activeConnections: connections.filter((connection) => connection.state === "active").length
      }
    };
  }
}
