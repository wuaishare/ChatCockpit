import type { WorkspaceSnapshotInput } from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  EvidenceBundleRecord,
  EvidenceItemRecord,
  HandoffCheckpointRecord,
  ProjectRecord,
  RuntimeApprovalRecord,
  RuntimeBindingRecord,
  TaskRecord,
  WorkspaceRecord,
  WriterLeaseRecord
} from "../continuity/types.js";
import { listJobArtifacts } from "../core/job-artifacts.js";
import { getJob } from "../core/jobs.js";
import type {
  JobStatus,
  TokenPilotJobArtifactSummary,
  TokenPilotPaths
} from "../types.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import {
  assessTaskCompletion,
  type TaskCompletionBlocker
} from "./task-completion-assessment.js";
import {
  TaskExecutionPolicyService,
  type TaskExecutionPolicyAssessment
} from "./task-execution-policy.js";

export type WorkspaceVerificationState = "verified" | "incomplete" | "missing";

export interface WorkspaceEvidenceProjection {
  bundle: EvidenceBundleRecord;
  items: EvidenceItemRecord[];
  verificationState: WorkspaceVerificationState;
}

export interface WorkspaceRuntimeJobProjection {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  artifacts: TokenPilotJobArtifactSummary[];
}

export interface WorkspaceSessionRuntimeProjection {
  sessionId: string;
  binding: RuntimeBindingRecord | null;
  job: WorkspaceRuntimeJobProjection | null;
}

export interface WorkspaceTaskContinuityProjection {
  task: TaskRecord;
  sessions: DevelopmentSessionRecord[];
  runtimes: WorkspaceSessionRuntimeProjection[];
  latestHandoff: HandoffCheckpointRecord | null;
  evidence: WorkspaceEvidenceProjection | null;
  executionPolicy: TaskExecutionPolicyAssessment;
  completion: {
    eligible: boolean;
    blockers: TaskCompletionBlocker[];
  };
}

export interface WorkspaceGitProjection {
  available: boolean;
  branch: string | null;
  headCommit: string | null;
  dirty: boolean;
  changedPaths: string[];
  unavailableReason: string | null;
}

export interface WorkspaceContinuitySnapshot {
  project: ProjectRecord;
  workspace: WorkspaceRecord;
  activeLease: WriterLeaseRecord | null;
  readOnly: boolean;
  readOnlyReason: "active-writer" | null;
  git: WorkspaceGitProjection;
  tasks: WorkspaceTaskContinuityProjection[];
  pendingApprovals: RuntimeApprovalRecord[];
}

function verificationState(
  bundle: EvidenceBundleRecord,
  items: EvidenceItemRecord[]
): WorkspaceVerificationState {
  const requiredItems = items.filter((item) => item.required);
  if (requiredItems.length === 0 || bundle.requiredItemCount === 0) {
    return "missing";
  }
  const allRequiredPassed = requiredItems.every((item) => item.status === "passed");
  return bundle.status === "complete" && allRequiredPassed
    ? "verified"
    : "incomplete";
}

function publicChangedPaths(entries: Array<{ path: string; status: string }>): string[] {
  return entries
    .filter((entry) => entry.status !== "blocked")
    .map((entry) => entry.path)
    .sort();
}

export class WorkspaceContinuityService {
  private readonly git: GitService;
  private readonly executionPolicy: TaskExecutionPolicyService;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    executionPolicy?: TaskExecutionPolicyService
  ) {
    this.git = new GitService(paths);
    this.executionPolicy =
      executionPolicy ?? new TaskExecutionPolicyService(repositories);
  }

  snapshot(
    context: OperationContext,
    input: WorkspaceSnapshotInput
  ): WorkspaceContinuitySnapshot {
    const workspace = this.repositories.workspaces.get(input.workspaceId);
    const project = this.repositories.projects.get(workspace.projectId);
    this.repositories.leases.reconcileExpired(context.now);
    const activeLease = this.repositories.leases.getActive(workspace.id);
    const tasks = this.repositories.tasks.listByWorkspace(workspace.id).map((task) =>
      this.projectTask(context, task)
    );

    return {
      project,
      workspace,
      activeLease,
      readOnly: activeLease !== null,
      readOnlyReason: activeLease ? "active-writer" : null,
      git: this.readGit(context, workspace),
      tasks,
      pendingApprovals:
        this.repositories.runtimeApprovals.listPendingByWorkspace(workspace.id)
    };
  }

  private projectTask(
    context: OperationContext,
    task: TaskRecord
  ): WorkspaceTaskContinuityProjection {
    const latestHandoff = task.latestHandoffId
      ? this.repositories.handoffs.get(task.latestHandoffId)
      : this.repositories.handoffs.latestForTask(task.id);
    const evidence = task.latestEvidenceBundleId
      ? this.projectEvidence(task.latestEvidenceBundleId)
      : null;
    const sessions = this.repositories.sessions.listByTask(task.id);
    const assessment = assessTaskCompletion(
      this.repositories,
      context,
      task
    );
    return {
      task,
      sessions,
      runtimes: sessions.map((session) => this.projectRuntime(session)),
      latestHandoff,
      evidence,
      executionPolicy: this.executionPolicy.assess(task),
      completion: {
        eligible: assessment.eligible,
        blockers: assessment.blockers
      }
    };
  }

  private projectRuntime(
    session: DevelopmentSessionRecord
  ): WorkspaceSessionRuntimeProjection {
    const binding = this.repositories.runtimeBindings.latestForSession(
      session.id
    );
    if (!binding || binding.runtimeKind !== "tokenpilot-runner") {
      return { sessionId: session.id, binding, job: null };
    }
    const stored = getJob(this.paths, binding.externalRunId);
    if (!stored) {
      return { sessionId: session.id, binding, job: null };
    }
    return {
      sessionId: session.id,
      binding,
      job: {
        id: stored.job.id,
        status: stored.job.status,
        createdAt: stored.job.createdAt,
        updatedAt: stored.job.updatedAt,
        artifacts: listJobArtifacts(stored.job, this.paths).map(
          ({ key, label, path, contentType }) => ({
            key,
            label,
            path,
            contentType
          })
        )
      }
    };
  }

  private projectEvidence(bundleId: string): WorkspaceEvidenceProjection {
    const bundle = this.repositories.evidence.getBundle(bundleId);
    const items = this.repositories.evidence.listItems(bundle.id);
    return {
      bundle,
      items,
      verificationState: verificationState(bundle, items)
    };
  }

  private readGit(
    context: OperationContext,
    workspace: WorkspaceRecord
  ): WorkspaceGitProjection {
    try {
      const status = this.git.status(context, workspace.repoId);
      const headCommit =
        this.git.recentCommits(context, workspace.repoId, 1)[0]?.hash ??
        workspace.headCommit;
      return {
        available: true,
        branch: status.branch || workspace.branch,
        headCommit,
        dirty: status.entries.length > 0,
        changedPaths: publicChangedPaths(status.entries),
        unavailableReason: null
      };
    } catch (error) {
      return {
        available: false,
        branch: workspace.branch,
        headCommit: workspace.headCommit,
        dirty: workspace.dirty,
        changedPaths: [],
        unavailableReason: "GIT_STATUS_UNAVAILABLE"
      };
    }
  }
}
