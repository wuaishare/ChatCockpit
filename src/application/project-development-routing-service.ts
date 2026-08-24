import type { TokenPilotPaths } from "../types.js";
import type { RuntimeThreadProjection } from "../runtime/codex/runtime-adapter.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import type { ProjectService } from "./project-service.js";
import type { RuntimeService } from "./runtime-service.js";

export type ProjectDevelopmentLane = "codex-native" | "chat-direct";
export type ProjectDevelopmentNextAction =
  | "continue-direct"
  | "resume-native"
  | "start-native"
  | "repair-workspace"
  | "direct-fallback";

export type CodexContinuityNextAction =
  | "resume-native"
  | "start-native"
  | "repair-workspace"
  | "unavailable";

type MatchingThread = Pick<
  RuntimeThreadProjection,
  "id" | "preview" | "updatedAt" | "recencyAt" | "sourceKind" | "threadSource" | "name" | "status"
>;

export interface ProjectDevelopmentCoordinationAssessment {
  projectId: string;
  workspaceId: string | null;
  repoId: string | null;
  modelLoopOwnership: {
    defaultOwner: "caller";
    implicitCodexTurnAllowed: false;
    codexTurnRequiresExplicitTransfer: true;
  };
  workspaceExecution: {
    kind: "checkout" | "worktree" | null;
    mode: "native-checkout" | "worktree" | null;
    worktreeRequiresExplicitOptIn: true;
    status: string | null;
    gitAvailable: boolean;
    branch: string | null;
    headCommit: string | null;
    detached: boolean;
    dirty: boolean;
  };
  codexContinuity: {
    runtimeAvailable: boolean;
    nextAction: CodexContinuityNextAction;
    reason: string;
    sessionToolSequence: string[];
    nativeTurnTool: "chatcockpit.codex.thread.turn.start" | null;
    matchingThread: MatchingThread | null;
    warnings: string[];
  };
  handoff: {
    requiredForModelLoopOwnerChange: true;
    sameOwnerResumeRequiresHandoff: false;
    recommendedArtifact: "continuity-capsule";
  };
}

export interface ProjectDevelopmentRoutingAssessment {
  projectId: string;
  workspaceId: string | null;
  repoId: string | null;
  preferredLane: ProjectDevelopmentLane;
  nextAction: ProjectDevelopmentNextAction;
  reason: string;
  nativeRuntimeAvailable: boolean;
  nativeToolSequence: string[];
  matchingThread: MatchingThread | null;
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

  async coordinate(
    context: OperationContext,
    projectId: string
  ): Promise<ProjectDevelopmentCoordinationAssessment> {
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
        modelLoopOwnership: {
          defaultOwner: "caller",
          implicitCodexTurnAllowed: false,
          codexTurnRequiresExplicitTransfer: true
        },
        workspaceExecution: {
          kind: null,
          mode: null,
          worktreeRequiresExplicitOptIn: true,
          status: null,
          gitAvailable: false,
          branch: null,
          headCommit: null,
          detached: false,
          dirty: false
        },
        codexContinuity: {
          runtimeAvailable: false,
          nextAction: "unavailable",
          reason: "NO_REGISTERED_WORKSPACE",
          sessionToolSequence: [],
          nativeTurnTool: null,
          matchingThread: null,
          warnings: ["Project has no registered Workspace"]
        },
        handoff: {
          requiredForModelLoopOwnerChange: true,
          sameOwnerResumeRequiresHandoff: false,
          recommendedArtifact: "continuity-capsule"
        }
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
      warnings.push("Workspace is a detached checkout; select a branch before development");
    }
    if (workspace.kind === "worktree") {
      warnings.push("Workspace is a worktree; worktree execution must be an explicit operator choice");
    }

    const capabilities = await this.runtime.capabilities(context);
    let nextAction: CodexContinuityNextAction;
    let reason: string;
    let sessionToolSequence: string[] = [];
    let nativeTurnTool: "chatcockpit.codex.thread.turn.start" | null = null;
    let matchingThread: MatchingThread | null = null;

    if (workspace.status !== "ready" || detached) {
      nextAction = "repair-workspace";
      reason = detached ? "WORKSPACE_DETACHED" : "WORKSPACE_NOT_READY";
    } else if (!capabilities.available) {
      nextAction = "unavailable";
      reason = "CODEX_NATIVE_UNAVAILABLE";
      warnings.push(capabilities.unavailableReason ?? "Codex App Server is unavailable");
    } else {
      const threads = await this.runtime.listCodexThreads(context, {
        workspaceId: workspace.id,
        limit: 50,
        archived: undefined,
        sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"]
      });
      const userFacingThreads = threads.data.filter(
        (thread) => thread.threadSource === "user" && thread.parentThreadId === null
      );
      const matching = newestThread(userFacingThreads);
      const ignoredNonUserThreadCount = threads.data.length - userFacingThreads.length;
      if (ignoredNonUserThreadCount > 0) {
        warnings.push(
          `Ignored ${ignoredNonUserThreadCount} non-user Codex thread(s) for automatic project continuation`
        );
      }
      if (matching) {
        nextAction = "resume-native";
        reason = "MATCHING_NATIVE_THREAD";
        sessionToolSequence = ["chatcockpit.codex.thread.resume"];
        nativeTurnTool = "chatcockpit.codex.thread.turn.start";
        matchingThread = {
          id: matching.id,
          preview: matching.preview,
          updatedAt: matching.updatedAt,
          recencyAt: matching.recencyAt,
          sourceKind: matching.sourceKind,
          threadSource: matching.threadSource,
          name: matching.name ?? null,
          status: matching.status
        };
      } else {
        nextAction = "start-native";
        reason = threads.data.length > 0
          ? "NO_USER_FACING_NATIVE_THREAD"
          : "NO_MATCHING_NATIVE_THREAD";
        sessionToolSequence = ["chatcockpit.codex.thread.start"];
        nativeTurnTool = "chatcockpit.codex.thread.turn.start";
      }
    }

    return {
      projectId,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      modelLoopOwnership: {
        defaultOwner: "caller",
        implicitCodexTurnAllowed: false,
        codexTurnRequiresExplicitTransfer: true
      },
      workspaceExecution: {
        kind: workspace.kind,
        mode: workspace.kind === "worktree" ? "worktree" : "native-checkout",
        worktreeRequiresExplicitOptIn: true,
        status: workspace.status,
        gitAvailable,
        branch,
        headCommit,
        detached,
        dirty
      },
      codexContinuity: {
        runtimeAvailable: capabilities.available,
        nextAction,
        reason,
        sessionToolSequence,
        nativeTurnTool,
        matchingThread,
        warnings
      },
      handoff: {
        requiredForModelLoopOwnerChange: true,
        sameOwnerResumeRequiresHandoff: false,
        recommendedArtifact: "continuity-capsule"
      }
    };
  }

  toLegacyAssessment(
    coordination: ProjectDevelopmentCoordinationAssessment
  ): ProjectDevelopmentRoutingAssessment {
    const workspace = coordination.workspaceExecution;
    const blocked =
      !coordination.workspaceId || workspace.status !== "ready" || workspace.detached;
    return {
      projectId: coordination.projectId,
      workspaceId: coordination.workspaceId,
      repoId: coordination.repoId,
      preferredLane: "chat-direct",
      nextAction: blocked
        ? (coordination.workspaceId ? "repair-workspace" : "direct-fallback")
        : "continue-direct",
      reason: blocked ? coordination.codexContinuity.reason : "CALLER_OWNS_MODEL_LOOP",
      nativeRuntimeAvailable: coordination.codexContinuity.runtimeAvailable,
      nativeToolSequence: [],
      matchingThread: coordination.codexContinuity.matchingThread,
      workspace: {
        status: workspace.status,
        gitAvailable: workspace.gitAvailable,
        branch: workspace.branch,
        headCommit: workspace.headCommit,
        detached: workspace.detached,
        dirty: workspace.dirty
      },
      warnings: [
        ...coordination.codexContinuity.warnings,
        "nativeDevelopment is deprecated; use developmentCoordination for model-loop ownership and Codex continuity"
      ]
    };
  }

  async assess(
    context: OperationContext,
    projectId: string
  ): Promise<ProjectDevelopmentRoutingAssessment> {
    return this.toLegacyAssessment(await this.coordinate(context, projectId));
  }
}
