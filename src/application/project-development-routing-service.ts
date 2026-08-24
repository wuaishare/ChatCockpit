import type { TokenPilotPaths } from "../types.js";
import type { RuntimeThreadProjection } from "../runtime/codex/runtime-adapter.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import type { ProjectService } from "./project-service.js";
import type { RuntimeService } from "./runtime-service.js";

export type ProjectDevelopmentLane = "codex-native" | "chat-direct";
export type ProjectDevelopmentNextAction =
  | "resume-native"
  | "start-native"
  | "repair-workspace"
  | "direct-fallback";

export interface ProjectDevelopmentRoutingAssessment {
  projectId: string;
  workspaceId: string | null;
  repoId: string | null;
  preferredLane: ProjectDevelopmentLane;
  nextAction: ProjectDevelopmentNextAction;
  reason: string;
  nativeRuntimeAvailable: boolean;
  nativeToolSequence: string[];
  matchingThread: Pick<
    RuntimeThreadProjection,
    "id" | "preview" | "updatedAt" | "recencyAt" | "sourceKind" | "status"
  > | null;
  workspace: {
    status: string | null;
    gitAvailable: boolean;
    branch: string | null;
    headCommit: string | null;
    detached: boolean;
    dirty: boolean;
  };
  warnings: string[];
}

function newestThread(threads: RuntimeThreadProjection[]): RuntimeThreadProjection | null {
  return [...threads].sort((left, right) => {
    const leftTime = left.recencyAt ?? left.updatedAt ?? left.createdAt ?? 0;
    const rightTime = right.recencyAt ?? right.updatedAt ?? right.createdAt ?? 0;
    return rightTime - leftTime;
  })[0] ?? null;
}

export class ProjectDevelopmentRoutingService {
  private readonly git: GitService;

  constructor(
    paths: TokenPilotPaths,
    private readonly projects: ProjectService,
    private readonly runtime: RuntimeService
  ) {
    this.git = new GitService(paths);
  }

  async assess(
    context: OperationContext,
    projectId: string
  ): Promise<ProjectDevelopmentRoutingAssessment> {
    const projection = this.projects.get(context, projectId);
    const workspace =
      projection.workspaces.find(
        (entry) => entry.id === projection.project.defaultWorkspaceId
      ) ?? projection.workspaces[0] ?? null;

    if (!workspace) {
      return {
        projectId,
        workspaceId: null,
        repoId: null,
        preferredLane: "chat-direct",
        nextAction: "direct-fallback",
        reason: "NO_REGISTERED_WORKSPACE",
        nativeRuntimeAvailable: false,
        nativeToolSequence: [],
        matchingThread: null,
        workspace: {
          status: null,
          gitAvailable: false,
          branch: null,
          headCommit: null,
          detached: false,
          dirty: false
        },
        warnings: ["Project has no registered Workspace"]
      };
    }

    let branch = workspace.branch;
    let headCommit = workspace.headCommit;
    let dirty = workspace.dirty;
    let gitAvailable = false;
    const warnings: string[] = [];

    try {
      const status = this.git.status(context, workspace.repoId);
      branch = status.branch || branch;
      headCommit =
        this.git.recentCommits(context, workspace.repoId, 1)[0]?.hash ?? headCommit;
      dirty = status.entries.length > 0;
      gitAvailable = true;
    } catch {
      warnings.push("Live Git state is unavailable");
    }

    const detached = branch === "HEAD";
    if (detached) {
      warnings.push("Workspace is a detached checkout; select a branch/worktree before development");
    }

    const capabilities = await this.runtime.capabilities(context);
    if (workspace.status !== "ready" || detached) {
      return {
        projectId,
        workspaceId: workspace.id,
        repoId: workspace.repoId,
        preferredLane: "codex-native",
        nextAction: "repair-workspace",
        reason: detached ? "WORKSPACE_DETACHED" : "WORKSPACE_NOT_READY",
        nativeRuntimeAvailable: capabilities.available,
        nativeToolSequence: [],
        matchingThread: null,
        workspace: {
          status: workspace.status,
          gitAvailable,
          branch,
          headCommit,
          detached,
          dirty
        },
        warnings
      };
    }

    if (!capabilities.available) {
      return {
        projectId,
        workspaceId: workspace.id,
        repoId: workspace.repoId,
        preferredLane: "chat-direct",
        nextAction: "direct-fallback",
        reason: "CODEX_NATIVE_UNAVAILABLE",
        nativeRuntimeAvailable: false,
        nativeToolSequence: [],
        matchingThread: null,
        workspace: {
          status: workspace.status,
          gitAvailable,
          branch,
          headCommit,
          detached,
          dirty
        },
        warnings: [
          ...warnings,
          capabilities.unavailableReason ?? "Codex App Server is unavailable"
        ]
      };
    }

    const threads = await this.runtime.listCodexThreads(context, {
      workspaceId: workspace.id,
      limit: 50,
      archived: undefined,
      sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"]
    });
    const matching = newestThread(threads.data);
    if (matching) {
      return {
        projectId,
        workspaceId: workspace.id,
        repoId: workspace.repoId,
        preferredLane: "codex-native",
        nextAction: "resume-native",
        reason: "MATCHING_NATIVE_THREAD",
        nativeRuntimeAvailable: true,
        nativeToolSequence: [
          "chatcockpit.codex.thread.resume",
          "chatcockpit.codex.thread.turn.start"
        ],
        matchingThread: {
          id: matching.id,
          preview: matching.preview,
          updatedAt: matching.updatedAt,
          recencyAt: matching.recencyAt,
          sourceKind: matching.sourceKind,
          status: matching.status
        },
        workspace: {
          status: workspace.status,
          gitAvailable,
          branch,
          headCommit,
          detached,
          dirty
        },
        warnings
      };
    }

    return {
      projectId,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      preferredLane: "codex-native",
      nextAction: "start-native",
      reason: "NO_MATCHING_NATIVE_THREAD",
      nativeRuntimeAvailable: true,
      nativeToolSequence: [
        "chatcockpit.codex.thread.start",
        "chatcockpit.codex.thread.turn.start"
      ],
      matchingThread: null,
      workspace: {
        status: workspace.status,
        gitAvailable,
        branch,
        headCommit,
        detached,
        dirty
      },
      warnings
    };
  }
}
