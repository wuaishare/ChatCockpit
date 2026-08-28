import type { TokenPilotPaths } from "../types.js";
import type {
  RuntimeMcpApplicabilityProjection,
  RuntimeThreadProjection
} from "../runtime/codex/runtime-adapter.js";
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

export type CodexContinuityRuntimeAvailability =
  | "available"
  | "unavailable"
  | "unknown";

export type CodexContinuityObservationStatus =
  | "ready"
  | "degraded"
  | "not-required";

export type CodexContinuityObservationReason =
  | "NO_REGISTERED_WORKSPACE"
  | "WORKSPACE_NOT_READY"
  | "WORKSPACE_DETACHED"
  | "CAPABILITIES_TIMEOUT"
  | "CAPABILITIES_FAILED"
  | "THREADS_TIMEOUT"
  | "THREADS_FAILED";

export type ProjectMcpApplicabilityReason =
  | "NO_REGISTERED_WORKSPACE"
  | "WORKSPACE_NOT_READY"
  | "WORKSPACE_DETACHED"
  | "MCP_CONFIG_TIMEOUT"
  | "MCP_CONFIG_FAILED";

export interface ProjectMcpApplicabilityAssessment {
  observation: {
    status: "ready" | "degraded" | "not-required";
    reason: ProjectMcpApplicabilityReason | null;
  };
  source: "codex-config" | null;
  configuredServerCount: number | null;
  applicableServerCount: number | null;
  disabledServerCount: number | null;
  servers: RuntimeMcpApplicabilityProjection["servers"];
  warnings: string[];
}

export interface ProjectDevelopmentRoutingOptions {
  providerObservationBudgetMs?: number;
  providerObservationCacheTtlMs?: number;
}

const DEFAULT_PROVIDER_OBSERVATION_BUDGET_MS = 1_500;
const DEFAULT_PROVIDER_OBSERVATION_CACHE_TTL_MS = 2_000;

type ProviderObservationResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" }
  | { kind: "error" };

async function observeWithinBudget<T>(
  operation: () => Promise<T>,
  timeoutMs: number
): Promise<ProviderObservationResult<T>> {
  if (timeoutMs <= 0) {
    return { kind: "timeout" };
  }

  return await new Promise<ProviderObservationResult<T>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "timeout" });
    }, timeoutMs);

    void operation().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "ok", value });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "error" });
      }
    );
  });
}

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
    runtimeAvailability: CodexContinuityRuntimeAvailability;
    observation: {
      status: CodexContinuityObservationStatus;
      reason: CodexContinuityObservationReason | null;
      latencyBudgetMs: number;
    };
    nextAction: CodexContinuityNextAction;
    reason: string;
    sessionToolSequence: string[];
    nativeTurnTool: "chatcockpit.codex.thread.turn.start" | null;
    matchingThread: MatchingThread | null;
    warnings: string[];
  };
  mcpApplicability: ProjectMcpApplicabilityAssessment;
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

function emptyMcpApplicability(
  status: "degraded" | "not-required",
  reason: ProjectMcpApplicabilityReason,
  warning: string
): ProjectMcpApplicabilityAssessment {
  return {
    observation: { status, reason },
    source: null,
    configuredServerCount: null,
    applicableServerCount: null,
    disabledServerCount: null,
    servers: [],
    warnings: [warning]
  };
}

export class ProjectDevelopmentRoutingService {
  private readonly git: GitService;
  private readonly providerObservationBudgetMs: number;
  private readonly providerObservationCacheTtlMs: number;
  private readonly providerObservationCache = new Map<string, {
    expiresAt: number;
    continuity: ProjectDevelopmentCoordinationAssessment["codexContinuity"];
  }>();

  constructor(
    paths: TokenPilotPaths,
    private readonly projects: ProjectService,
    private readonly runtime: RuntimeService,
    options: ProjectDevelopmentRoutingOptions = {}
  ) {
    this.git = new GitService(paths);
    this.providerObservationBudgetMs = Math.max(
      1,
      Math.floor(options.providerObservationBudgetMs ?? DEFAULT_PROVIDER_OBSERVATION_BUDGET_MS)
    );
    this.providerObservationCacheTtlMs = Math.max(
      0,
      Math.floor(options.providerObservationCacheTtlMs ?? DEFAULT_PROVIDER_OBSERVATION_CACHE_TTL_MS)
    );
  }


  private cloneCodexContinuity(
    continuity: ProjectDevelopmentCoordinationAssessment["codexContinuity"]
  ): ProjectDevelopmentCoordinationAssessment["codexContinuity"] {
    return {
      ...continuity,
      observation: { ...continuity.observation },
      sessionToolSequence: [...continuity.sessionToolSequence],
      matchingThread: continuity.matchingThread ? { ...continuity.matchingThread } : null,
      warnings: [...continuity.warnings]
    };
  }

  private cachedCodexContinuity(
    workspaceId: string
  ): ProjectDevelopmentCoordinationAssessment["codexContinuity"] | null {
    const cached = this.providerObservationCache.get(workspaceId);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.providerObservationCache.delete(workspaceId);
      return null;
    }
    return this.cloneCodexContinuity(cached.continuity);
  }

  private rememberCodexContinuity(
    workspaceId: string,
    continuity: ProjectDevelopmentCoordinationAssessment["codexContinuity"]
  ): ProjectDevelopmentCoordinationAssessment["codexContinuity"] {
    const snapshot = this.cloneCodexContinuity(continuity);
    if (this.providerObservationCacheTtlMs > 0) {
      this.providerObservationCache.set(workspaceId, {
        expiresAt: Date.now() + this.providerObservationCacheTtlMs,
        continuity: snapshot
      });
    }
    return this.cloneCodexContinuity(snapshot);
  }

  private async observeCodexContinuity(
    context: OperationContext,
    workspaceId: string
  ): Promise<ProjectDevelopmentCoordinationAssessment["codexContinuity"]> {
    const cached = this.cachedCodexContinuity(workspaceId);
    if (cached) return cached;

    const warnings: string[] = [];
    const deadline = Date.now() + this.providerObservationBudgetMs;
    const remainingBudget = () => Math.max(0, deadline - Date.now());
    const capabilityObservationPromise = observeWithinBudget(
      () => this.runtime.capabilities(context),
      remainingBudget()
    );
    const threadObservationPromise = observeWithinBudget(
      () => this.runtime.listCodexThreads(context, {
        workspaceId,
        limit: 50,
        archived: undefined,
        sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"]
      }),
      remainingBudget()
    );
    const capabilityObservation = await capabilityObservationPromise;

    if (capabilityObservation.kind === "timeout") {
      return this.rememberCodexContinuity(workspaceId, {
        runtimeAvailable: false,
        runtimeAvailability: "unknown",
        observation: {
          status: "degraded",
          reason: "CAPABILITIES_TIMEOUT",
          latencyBudgetMs: this.providerObservationBudgetMs
        },
        nextAction: "unavailable",
        reason: "CODEX_CAPABILITIES_TIMEOUT",
        sessionToolSequence: [],
        nativeTurnTool: null,
        matchingThread: null,
        warnings: ["Codex capability observation timed out"]
      });
    }

    if (capabilityObservation.kind === "error") {
      return this.rememberCodexContinuity(workspaceId, {
        runtimeAvailable: false,
        runtimeAvailability: "unknown",
        observation: {
          status: "degraded",
          reason: "CAPABILITIES_FAILED",
          latencyBudgetMs: this.providerObservationBudgetMs
        },
        nextAction: "unavailable",
        reason: "CODEX_CAPABILITIES_FAILED",
        sessionToolSequence: [],
        nativeTurnTool: null,
        matchingThread: null,
        warnings: ["Codex capability observation failed"]
      });
    }

    const capabilities = capabilityObservation.value;
    if (!capabilities.available) {
      return this.rememberCodexContinuity(workspaceId, {
        runtimeAvailable: false,
        runtimeAvailability: "unavailable",
        observation: {
          status: "ready",
          reason: null,
          latencyBudgetMs: this.providerObservationBudgetMs
        },
        nextAction: "unavailable",
        reason: "CODEX_NATIVE_UNAVAILABLE",
        sessionToolSequence: [],
        nativeTurnTool: null,
        matchingThread: null,
        warnings: [capabilities.unavailableReason ?? "Codex App Server is unavailable"]
      });
    }

    const threadObservation = await threadObservationPromise;

    if (threadObservation.kind === "timeout") {
      return this.rememberCodexContinuity(workspaceId, {
        runtimeAvailable: true,
        runtimeAvailability: "available",
        observation: {
          status: "degraded",
          reason: "THREADS_TIMEOUT",
          latencyBudgetMs: this.providerObservationBudgetMs
        },
        nextAction: "unavailable",
        reason: "CODEX_THREADS_TIMEOUT",
        sessionToolSequence: [],
        nativeTurnTool: null,
        matchingThread: null,
        warnings: ["Codex thread observation timed out"]
      });
    }

    if (threadObservation.kind === "error") {
      return this.rememberCodexContinuity(workspaceId, {
        runtimeAvailable: true,
        runtimeAvailability: "available",
        observation: {
          status: "degraded",
          reason: "THREADS_FAILED",
          latencyBudgetMs: this.providerObservationBudgetMs
        },
        nextAction: "unavailable",
        reason: "CODEX_THREADS_FAILED",
        sessionToolSequence: [],
        nativeTurnTool: null,
        matchingThread: null,
        warnings: ["Codex thread observation failed"]
      });
    }

    const threads = threadObservation.value;
    const userFacingThreads = threads.data.filter(
      (thread) =>
        thread.parentThreadId === null &&
        (thread.threadSource === "user" ||
          thread.sourceKind === "cli" ||
          thread.sourceKind === "vscode")
    );
    const matching = newestThread(userFacingThreads);
    const ignoredNonUserThreadCount = threads.data.length - userFacingThreads.length;
    if (ignoredNonUserThreadCount > 0) {
      warnings.push(
        `Ignored ${ignoredNonUserThreadCount} non-user-facing Codex thread(s) for automatic project continuation`
      );
    }

    if (matching) {
      return this.rememberCodexContinuity(workspaceId, {
        runtimeAvailable: true,
        runtimeAvailability: "available",
        observation: {
          status: "ready",
          reason: null,
          latencyBudgetMs: this.providerObservationBudgetMs
        },
        nextAction: "resume-native",
        reason: "MATCHING_NATIVE_THREAD",
        sessionToolSequence: ["chatcockpit.codex.thread.resume"],
        nativeTurnTool: "chatcockpit.codex.thread.turn.start",
        matchingThread: {
          id: matching.id,
          preview: matching.preview,
          updatedAt: matching.updatedAt,
          recencyAt: matching.recencyAt,
          sourceKind: matching.sourceKind,
          threadSource: matching.threadSource,
          name: matching.name ?? null,
          status: matching.status
        },
        warnings
      });
    }

    return this.rememberCodexContinuity(workspaceId, {
      runtimeAvailable: true,
      runtimeAvailability: "available",
      observation: {
        status: "ready",
        reason: null,
        latencyBudgetMs: this.providerObservationBudgetMs
      },
      nextAction: "start-native",
      reason: threads.data.length > 0
        ? "NO_USER_FACING_NATIVE_THREAD"
        : "NO_MATCHING_NATIVE_THREAD",
      sessionToolSequence: ["chatcockpit.codex.thread.start"],
      nativeTurnTool: "chatcockpit.codex.thread.turn.start",
      matchingThread: null,
      warnings
    });
  }

  private async observeMcpApplicability(
    context: OperationContext,
    workspaceId: string,
    deadline: number
  ): Promise<ProjectMcpApplicabilityAssessment> {
    const observation = await observeWithinBudget(
      () => this.runtime.readCodexMcpApplicability(context, workspaceId),
      Math.max(0, deadline - Date.now())
    );
    if (observation.kind === "timeout") {
      return emptyMcpApplicability(
        "degraded",
        "MCP_CONFIG_TIMEOUT",
        "Codex effective MCP configuration observation timed out"
      );
    }
    if (observation.kind === "error") {
      return emptyMcpApplicability(
        "degraded",
        "MCP_CONFIG_FAILED",
        "Codex effective MCP configuration observation failed"
      );
    }
    return {
      observation: { status: "ready", reason: null },
      source: "codex-config",
      configuredServerCount: observation.value.configuredServerCount,
      applicableServerCount: observation.value.applicableServerCount,
      disabledServerCount: observation.value.disabledServerCount,
      servers: observation.value.servers.map((server) => ({ ...server })),
      warnings: []
    };
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
          runtimeAvailability: "unknown",
          observation: {
            status: "not-required",
            reason: "NO_REGISTERED_WORKSPACE",
            latencyBudgetMs: this.providerObservationBudgetMs
          },
          nextAction: "unavailable",
          reason: "NO_REGISTERED_WORKSPACE",
          sessionToolSequence: [],
          nativeTurnTool: null,
          matchingThread: null,
          warnings: ["Project has no registered Workspace"]
        },
        mcpApplicability: emptyMcpApplicability(
          "not-required",
          "NO_REGISTERED_WORKSPACE",
          "Project has no registered Workspace"
        ),
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

    let codexContinuity: ProjectDevelopmentCoordinationAssessment["codexContinuity"];
    let mcpApplicability: ProjectMcpApplicabilityAssessment;
    if (workspace.status !== "ready" || detached) {
      const reason = detached ? "WORKSPACE_DETACHED" : "WORKSPACE_NOT_READY";
      codexContinuity = {
        runtimeAvailable: false,
        runtimeAvailability: "unknown",
        observation: {
          status: "not-required",
          reason,
          latencyBudgetMs: this.providerObservationBudgetMs
        },
        nextAction: "repair-workspace",
        reason,
        sessionToolSequence: [],
        nativeTurnTool: null,
        matchingThread: null,
        warnings: []
      };
      mcpApplicability = emptyMcpApplicability(
        "not-required",
        reason,
        detached
          ? "Workspace is detached; project MCP applicability was not observed"
          : "Workspace is not ready; project MCP applicability was not observed"
      );
    } else {
      const deadline = Date.now() + this.providerObservationBudgetMs;
      [codexContinuity, mcpApplicability] = await Promise.all([
        this.observeCodexContinuity(context, workspace.id),
        this.observeMcpApplicability(context, workspace.id, deadline)
      ]);
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
        ...codexContinuity,
        warnings: [...warnings, ...codexContinuity.warnings]
      },
      mcpApplicability,
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
