import type {
  ContinuityCapsuleInput,
  ContinuityCapsuleProjection,
  TrajectoryProjection
} from "../contracts/continuity-observability.js";
import type { DevelopmentSessionRecord } from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import type { TrajectoryService } from "./trajectory-service.js";
import type {
  WorkspaceContinuityService,
  WorkspaceTaskContinuityProjection
} from "./workspace-continuity-service.js";

const LOCAL_PATH = /(?:file:\/\/\/[^\s]+|\/(?:Users|home|Applications|Volumes|private|var|tmp)\/[^\s,;:)"'`]+|\b[A-Za-z]:\\[^\s,;:)"'`]+)/g;

function safeText(value: string, limit = 600): string {
  return value.replace(LOCAL_PATH, "[local-path-hidden]").trim().slice(0, limit);
}

function safeItems(values: string[], limit = 20): string[] {
  return values.map((value) => safeText(value, 400)).filter(Boolean).slice(0, limit);
}

function safeRelativePaths(values: string[]): string[] {
  return [...new Set(values)]
    .filter((value) => value && !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value))
    .filter((value) => !value.split(/[\\/]/).includes(".."))
    .slice(0, 100);
}

function ownerForSession(session: DevelopmentSessionRecord | null): "chatgpt" | "codex" | "async-agent" | "unknown" {
  if (!session) return "unknown";
  if (session.mode === "chat-direct") return "chatgpt";
  if (session.mode === "codex-session") return "codex";
  return "async-agent";
}

function pickTask(
  tasks: WorkspaceTaskContinuityProjection[],
  taskId?: string
): WorkspaceTaskContinuityProjection | null {
  if (!taskId) return null;
  return tasks.find((item) => item.task.id === taskId) ?? null;
}
function pickSession(task: WorkspaceTaskContinuityProjection | null): DevelopmentSessionRecord | null {
  if (!task) return null;
  return task.sessions.find((item) => item.id === task.task.activeSessionId)
    ?? task.sessions.find((item) => !["completed", "failed"].includes(item.status))
    ?? task.sessions[0]
    ?? null;
}

function projectTrajectory(trajectory: TrajectoryProjection | null) {
  if (!trajectory) return null;
  return {
    activityId: trajectory.activity.id,
    title: safeText(trajectory.activity.title, 240),
    status: trajectory.activity.status,
    events: trajectory.events.map((event) => ({
      kind: event.kind,
      category: event.category,
      code: event.code,
      itemType: event.itemType,
      createdAt: event.createdAt
    }))
  };
}

function runtimeReference(
  task: WorkspaceTaskContinuityProjection | null,
  session: DevelopmentSessionRecord | null
): { kind: string; id: string; deepLink: string | null } | null {
  if (!task || !session) return null;
  const binding = task.runtimes.find((item) => item.sessionId === session.id)?.binding ?? null;
  if (!binding) return null;
  if (binding.runtimeKind === "codex-app-server") {
    return {
      kind: "codex-thread",
      id: binding.externalThreadId,
      deepLink: `codex://threads/${encodeURIComponent(binding.externalThreadId)}`
    };
  }
  if (binding.externalRunId) {
    return { kind: "async-runner", id: binding.externalRunId, deepLink: null };
  }
  return null;
}

function markdownList(label: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return ["", `## ${label}`, ...values.map((value) => `- ${value}`)];
}

function renderMarkdown(capsule: Omit<ContinuityCapsuleProjection, "markdown">): string {
  const lines = [
    "# ChatCockpit Continuity Capsule v1",
    "",
    `Project: ${capsule.project.name} (${capsule.project.id})`,
    `Workspace: ${capsule.workspace.repoId} (${capsule.workspace.id})`,
    `Model loop owner: ${capsule.source.modelLoopOwner}`,
    `Source session: ${capsule.source.sessionId ?? "none"}`,
    `Git branch: ${capsule.git.branch ?? "unknown"}`,
    `Git HEAD: ${capsule.git.headCommit ?? "unknown"}`,
    `Git dirty: ${capsule.git.dirty ? "yes" : "no"}`
  ];
  if (capsule.source.runtime) {
    lines.push(
      `Runtime: ${capsule.source.runtime.kind} ${capsule.source.runtime.id}`,
      ...(capsule.source.runtime.deepLink ? [`Open: ${capsule.source.runtime.deepLink}`] : [])
    );
  }
  if (capsule.objective) lines.push("", "## Objective", capsule.objective);
  lines.push(...markdownList("Completed", capsule.completedItems));
  lines.push(...markdownList("Pending", capsule.pendingItems));
  lines.push(...markdownList("Risks", capsule.risks));
  if (capsule.nextAction) lines.push("", "## Next action", capsule.nextAction);
  if (capsule.git.changedPaths.length > 0) {
    lines.push(...markdownList("Changed paths", capsule.git.changedPaths));
  }
  if (capsule.verification.items.length > 0) {
    lines.push("", `## Verification (${capsule.verification.state})`);
    for (const item of capsule.verification.items) {
      lines.push(`- [${item.status}] ${item.label}${item.required ? " (required)" : ""}`);
    }
  }
  if (capsule.trajectory?.events.length) {
    lines.push("", "## Recent trajectory");
    for (const event of capsule.trajectory.events) {
      const detail = [event.kind, event.itemType, event.code].filter(Boolean).join(" · ");
      lines.push(`- ${event.createdAt} · ${detail}`);
    }
  }
  return lines.join("\n").slice(0, 12_000);
}

export class ContinuityCapsuleService {
  constructor(
    private readonly workspaces: WorkspaceContinuityService,
    private readonly trajectories: TrajectoryService
  ) {}

  generate(context: OperationContext, input: ContinuityCapsuleInput): ContinuityCapsuleProjection {
    const snapshot = this.workspaces.snapshot(context, { workspaceId: input.workspaceId });
    const task = pickTask(snapshot.tasks, input.taskId);
    if (input.taskId && !task) {
      throw new ServiceError(
        "CONTINUITY_CAPSULE_TASK_NOT_FOUND",
        "The requested task does not belong to this workspace"
      );
    }
    const session = pickSession(task);
    const activityId = input.activityId ?? session?.id ?? null;
    const trajectory = activityId
      ? this.trajectories.find(activityId, input.trajectoryLimit)
      : null;
    if (input.activityId && !trajectory) {
      throw new ServiceError(
        "CONTINUITY_CAPSULE_ACTIVITY_NOT_FOUND",
        "The requested activity was not found"
      );
    }
    if (trajectory?.activity.workspaceId && trajectory.activity.workspaceId !== snapshot.workspace.id) {
      throw new ServiceError(
        "CONTINUITY_CAPSULE_ACTIVITY_MISMATCH",
        "The requested activity does not belong to this workspace"
      );
    }

    const handoff = task?.latestHandoff ?? null;
    const evidence = task?.evidence ?? null;
    const runtime = runtimeReference(task, session);
    const changedPaths = safeRelativePaths([
      ...snapshot.git.changedPaths,
      ...(handoff?.changedFiles ?? [])
    ]);
    const base: Omit<ContinuityCapsuleProjection, "markdown"> = {
      version: "1",
      project: { id: snapshot.project.id, name: snapshot.project.displayName },
      workspace: {
        id: snapshot.workspace.id,
        repoId: snapshot.workspace.repoId,
        kind: snapshot.workspace.kind
      },
      source: {
        modelLoopOwner: ownerForSession(session),
        sessionId: session?.id ?? null,
        sessionMode: session?.mode ?? null,
        activityId: trajectory?.activity.id ?? null,
        runtime
      },
      git: {
        available: snapshot.git.available,
        branch: snapshot.git.branch,
        headCommit: snapshot.git.headCommit,
        dirty: snapshot.git.dirty,
        changedPaths
      },
      objective: handoff?.goal ? safeText(handoff.goal) : task?.task.goal ? safeText(task.task.goal) : null,
      completedItems: safeItems(handoff?.completedItems ?? []),
      pendingItems: task?.task.status === "completed"
        ? []
        : safeItems(handoff?.pendingItems ?? []),
      risks: safeItems(handoff?.risks ?? []),
      nextAction: task?.task.status === "completed"
        ? null
        : handoff?.nextAction ? safeText(handoff.nextAction) : null,
      verification: {
        state: evidence?.verificationState ?? "missing",
        items: (evidence?.items ?? []).slice(0, 50).map((item) => ({
          kind: item.kind,
          label: safeText(item.label, 240),
          status: item.status,
          required: item.required
        }))
      },
      trajectory: projectTrajectory(trajectory)
    };
    return { ...base, markdown: renderMarkdown(base) };
  }
}
