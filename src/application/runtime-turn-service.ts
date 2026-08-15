import { createHash } from "node:crypto";

import type {
  CodexTurnInterruptInput,
  CodexTurnStartInput
} from "../contracts/codex-runtime.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  EvidenceBundleRecord,
  HandoffCheckpointRecord,
  RuntimeRunRecord,
  TaskRecord,
  WriterLeaseRecord
} from "../continuity/types.js";
import type { TokenPilotPaths } from "../types.js";
import type { RuntimeTurnProjection } from "../runtime/codex/runtime-adapter.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";
import { ServiceError } from "./service-error.js";
import {
  TaskExecutionPolicyService,
  type TaskExecutionPolicyAssessment
} from "./task-execution-policy.js";

interface PreparedTurnStart {
  run: RuntimeRunRecord;
  lease: WriterLeaseRecord;
  handoff: HandoffCheckpointRecord;
  evidenceBundle: EvidenceBundleRecord;
  session: DevelopmentSessionRecord;
  task: TaskRecord;
  executionPolicy: TaskExecutionPolicyAssessment;
}

export interface RuntimeTurnStartResult extends PreparedTurnStart {
  turn: RuntimeTurnProjection;
  replayed: boolean;
}

export interface RuntimeTurnInterruptResult {
  run: RuntimeRunRecord;
  session: DevelopmentSessionRecord;
  lease: WriterLeaseRecord;
  replayed: boolean;
}

function errorCode(error: unknown): string {
  return error instanceof ServiceError ? error.code : "INTERNAL_ERROR";
}

function inputHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class RuntimeTurnService {
  private readonly git: GitService;

  private readonly executionPolicy: TaskExecutionPolicyService;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    private readonly runtime: RuntimeRouter,
    executionPolicy?: TaskExecutionPolicyService
  ) {
    this.git = new GitService(paths);
    this.executionPolicy = executionPolicy ?? new TaskExecutionPolicyService(repositories);
  }

  async start(
    context: OperationContext,
    input: CodexTurnStartInput
  ): Promise<RuntimeTurnStartResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeTurnStartResult, "replayed">
    >("codex.turn.start", input.idempotencyKey, input);
    if (replay) {
      return { ...replay.value, replayed: true };
    }

    const initialSession = this.repositories.sessions.get(input.sessionId);
    const initialTask = this.repositories.tasks.get(initialSession.taskId);
    const workspace = this.repositories.workspaces.get(initialSession.workspaceId);
    const gitStatus = this.git.status(context, workspace.repoId);
    let gitHead: string | null = workspace.headCommit;
    try {
      gitHead =
        this.git.recentCommits(context, workspace.repoId, 1)[0]?.hash ?? gitHead;
    } catch {
      // A repository with no commits still has a useful status checkpoint.
    }
    const changedFiles = gitStatus.entries
      .filter((entry) => entry.status !== "blocked")
      .map((entry) => entry.path);
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + input.leaseDurationSeconds * 1_000
    ).toISOString();

    const execution = await this.repositories.idempotency.executePreparedExternalMutation(
      "codex.turn.start",
      input.idempotencyKey,
      input,
      () => {
        const session = this.repositories.sessions.get(input.sessionId);
        const task = this.repositories.tasks.get(session.taskId);
        if (session.revision !== input.expectedSessionRevision) {
          throw new ServiceError(
            "REVISION_CONFLICT",
            `Development session ${session.id} revision does not match`,
            {
              details: {
                expectedRevision: input.expectedSessionRevision,
                actualRevision: session.revision
              }
            }
          );
        }
        if (task.revision !== input.expectedTaskRevision) {
          throw new ServiceError(
            "REVISION_CONFLICT",
            `Task ${task.id} revision does not match`,
            {
              details: {
                expectedRevision: input.expectedTaskRevision,
                actualRevision: task.revision
              }
            }
          );
        }
        if (
          session.mode !== "codex-session" ||
          session.workspaceId !== task.workspaceId ||
          session.projectId !== task.projectId
        ) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Turn start requires a valid codex-session bound to the task workspace"
          );
        }
        const policyAssessment = this.executionPolicy.requireAllowed(task);
        const binding = this.repositories.runtimeBindings.findActiveBySession(
          session.id
        );
        if (
          !binding ||
          binding.runtimeKind !== "codex-app-server" ||
          session.activeRuntimeBindingId !== binding.id
        ) {
          throw new ServiceError(
            "RUNTIME_BINDING_REQUIRED",
            "The Codex session has no active Codex runtime binding"
          );
        }
        if (this.repositories.runtimeRuns.getActiveBySession(session.id)) {
          throw new ServiceError(
            "RUNTIME_RUN_CONFLICT",
            "The Codex session already has an active model loop"
          );
        }
        if (this.repositories.handoffs.getReadyForTask(task.id)) {
          throw new ServiceError(
            "HANDOFF_READY_CONFLICT",
            "The task already has a ready handoff checkpoint"
          );
        }

        const activeLease = this.repositories.leases.getActive(task.workspaceId);
        let lease: WriterLeaseRecord;
        if (activeLease) {
          if (
            activeLease.sessionId !== session.id ||
            activeLease.holderType !== "codex-session" ||
            activeLease.holderId !== binding.externalThreadId
          ) {
            throw new ServiceError(
              "WRITER_LEASE_CONFLICT",
              "Another writer owns the workspace or the lease does not match the bound Codex thread",
              {
                details: {
                  leaseId: activeLease.id,
                  sessionId: activeLease.sessionId,
                  holderType: activeLease.holderType,
                  expiresAt: activeLease.expiresAt
                }
              }
            );
          }
          lease = this.repositories.leases.heartbeat(activeLease.id, {
            sessionId: session.id,
            holderId: binding.externalThreadId,
            expiresAt: leaseExpiresAt,
            expectedRevision: activeLease.revision
          });
        } else {
          lease = this.repositories.leases.acquire({
            workspaceId: task.workspaceId,
            sessionId: session.id,
            holderType: "codex-session",
            holderId: binding.externalThreadId,
            expiresAt: leaseExpiresAt
          });
        }

        const evidenceBundle = this.repositories.evidence.createBundle({
          taskId: task.id,
          sessionId: session.id
        });
        const draft = this.repositories.handoffs.create({
          taskId: task.id,
          sessionId: session.id,
          workspaceId: task.workspaceId,
          fromMode: "codex-session",
          toMode: "codex-session",
          goal: input.text,
          completedItems: ["Captured pre-run workspace checkpoint"],
          pendingItems: ["Complete the explicit Codex turn"],
          changedFiles,
          risks: [],
          nextAction: "Run the explicit Codex model loop and collect evidence",
          gitHead,
          gitBranch: gitStatus.branch,
          gitDirty: gitStatus.entries.length > 0,
          evidenceBundleId: evidenceBundle.id
        });
        const handoff = this.repositories.handoffs.markReady(
          draft.id,
          draft.revision
        );
        const taskWithHandoff = this.repositories.tasks.setLatestHandoff(
          task.id,
          handoff.id,
          task.revision
        );
        const updatedTask = this.repositories.tasks.setLatestEvidenceBundle(
          task.id,
          evidenceBundle.id,
          taskWithHandoff.revision
        );
        const updatedSession = this.repositories.sessions.updateStatus(
          session.id,
          "running",
          session.revision
        );
        const run = this.repositories.runtimeRuns.create({
          sessionId: session.id,
          workspaceId: task.workspaceId,
          runtimeBindingId: binding.id,
          threadId: binding.externalThreadId,
          inputHash: inputHash(input.text),
          inputLength: input.text.length,
          handoffId: handoff.id,
          evidenceBundleId: evidenceBundle.id,
          writerLeaseId: lease.id
        });
        return {
          run,
          lease,
          handoff,
          evidenceBundle,
          session: updatedSession,
          task: updatedTask,
          executionPolicy: policyAssessment
        };
      },
      (prepared) =>
        this.runtime.startCodexTurn({
          threadId: prepared.run.threadId,
          text: input.text,
          clientUserMessageId: `chatcockpit:${prepared.run.id}`
        }),
      (prepared, turn) => {
        let run = this.repositories.runtimeRuns.get(prepared.run.id);
        if (run.externalTurnId === null) {
          run = this.repositories.runtimeRuns.attachTurn(
            run.id,
            turn.id,
            run.revision
          );
        } else if (run.externalTurnId !== turn.id) {
          throw new ServiceError(
            "CODEX_TURN_RESPONSE_INVALID",
            "The Codex turn response conflicts with the persisted run"
          );
        }
        let handoff = this.repositories.handoffs.get(prepared.handoff.id);
        if (handoff.status === "ready") {
          handoff = this.repositories.handoffs.accept(
            handoff.id,
            handoff.revision
          );
        }
        this.repositories.runtimeEvents.append({
          runId: run.id,
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          threadId: run.threadId,
          turnId: turn.id,
          method: "turn/start",
          category: "lifecycle",
          publicPayload: {
            status: turn.status,
            modelLoopOwner: "codex"
          }
        });
        return {
          run,
          lease: this.repositories.leases.get(prepared.lease.id),
          handoff,
          evidenceBundle: this.repositories.evidence.getBundle(
            prepared.evidenceBundle.id
          ),
          session: this.repositories.sessions.get(prepared.session.id),
          task: this.repositories.tasks.get(prepared.task.id),
          executionPolicy: prepared.executionPolicy,
          turn
        };
      },
      (prepared, error) => {
        const run = this.repositories.runtimeRuns.get(prepared.run.id);
        if (run.status === "starting") {
          this.repositories.runtimeRuns.updateStatus(
            run.id,
            "failed",
            run.revision,
            {
              completedAt: new Date().toISOString(),
              errorCode: errorCode(error)
            }
          );
        }
        const handoff = this.repositories.handoffs.get(prepared.handoff.id);
        if (["draft", "ready"].includes(handoff.status)) {
          this.repositories.handoffs.supersede(handoff.id, handoff.revision);
        }
        const lease = this.repositories.leases.get(prepared.lease.id);
        if (lease.status === "active") {
          this.repositories.leases.release(lease.id, {
            sessionId: lease.sessionId,
            holderId: lease.holderId,
            expectedRevision: lease.revision
          });
        }
        const item = this.repositories.evidence.addItem({
          bundleId: prepared.evidenceBundle.id,
          kind: "manual",
          label: "Codex turn start",
          status: "failed",
          required: true,
          summary: `Turn start failed with ${errorCode(error)}`
        });
        const bundle = this.repositories.evidence.getBundle(item.bundleId);
        this.repositories.evidence.finalize(bundle.id, bundle.revision);
        const session = this.repositories.sessions.get(prepared.session.id);
        this.repositories.sessions.updateStatus(
          session.id,
          "handoff-ready",
          session.revision
        );
      }
    );

    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  async interrupt(
    _context: OperationContext,
    input: CodexTurnInterruptInput
  ): Promise<RuntimeTurnInterruptResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeTurnInterruptResult, "replayed">
    >("codex.turn.interrupt", input.idempotencyKey, input);
    if (replay) {
      return { ...replay.value, replayed: true };
    }
    const initial = this.repositories.runtimeRuns.get(input.runId);
    if (initial.revision !== input.expectedRunRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Runtime run ${initial.id} revision does not match`
      );
    }
    if (!initial.externalTurnId || !["running", "waiting-approval"].includes(initial.status)) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Only an active Codex turn can be interrupted"
      );
    }

    const execution = await this.repositories.idempotency.executeExternalMutation(
      "codex.turn.interrupt",
      input.idempotencyKey,
      input,
      () =>
        this.runtime.interruptCodexTurn({
          threadId: initial.threadId,
          turnId: initial.externalTurnId as string
        }),
      () => {
        const current = this.repositories.runtimeRuns.get(initial.id);
        const run = ["completed", "failed", "interrupted"].includes(current.status)
          ? current
          : this.repositories.runtimeRuns.updateStatus(
              current.id,
              "interrupted",
              current.revision,
              { completedAt: new Date().toISOString() }
            );
        const lease = this.repositories.leases.get(run.writerLeaseId);
        const releasedLease = lease.status === "active"
          ? this.repositories.leases.release(lease.id, {
              sessionId: lease.sessionId,
              holderId: lease.holderId,
              expectedRevision: lease.revision
            })
          : lease;
        const session = this.repositories.sessions.get(run.sessionId);
        const updatedSession = ["completed", "failed"].includes(session.status)
          ? session
          : this.repositories.sessions.updateStatus(
              session.id,
              "handoff-ready",
              session.revision
            );
        this.repositories.runtimeEvents.append({
          runId: run.id,
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          threadId: run.threadId,
          turnId: run.externalTurnId,
          method: "turn/interrupt",
          category: "lifecycle",
          publicPayload: { status: run.status }
        });
        return {
          run,
          session: updatedSession,
          lease: releasedLease
        };
      }
    );
    return { ...execution.value, replayed: execution.replayed };
  }
}
