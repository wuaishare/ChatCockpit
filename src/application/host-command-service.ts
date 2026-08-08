import { createHash, randomUUID } from "node:crypto";
import os from "node:os";

import type {
  HostCommandDecisionInput,
  HostCommandExecuteInput,
  HostCommandPrepareInput,
  HostCommandRequest
} from "../contracts/host-command.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DirectCommandApprovalRecord,
  DirectCommandEffect,
  PrivateWorkspaceRecord
} from "../continuity/types.js";
import {
  evaluatePureHostCommand,
  evaluateWorkspaceCommand,
  type CommandPolicyDecision
} from "../core/command-policy.js";
import type { TokenPilotPaths } from "../types.js";
import {
  DESKTOP_COMMANDER_EXECUTOR_ID
} from "../direct/adapters/desktop-commander.js";
import {
  DesktopCommanderProcessAdapter,
  DesktopCommanderProcessError,
  type DesktopCommanderProcessRequest,
  type DesktopCommanderProcessResult
} from "../direct/adapters/desktop-commander-process.js";
import {
  DirectCapabilityBroker,
  DirectCapabilityBrokerError,
  type DirectExecutorSelection
} from "../direct/capability-broker.js";
import {
  assertHostCommandRelativePathsInsideRoot,
  HostPathPolicyError,
  resolveHostCommandWorkdirTarget,
  type HostCommandWorkdirTarget
} from "../direct/host-path-policy.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import {
  assertChatDirectWriterLease,
  classifyHostTarget,
  type ClassifiedHostTarget,
  type WorkspaceMutationAuthority
} from "./workspace-mutation-governance.js";

const HOST_COMMAND_APPROVAL_TTL_MS = 5 * 60 * 1000;
const HOST_COMMAND_POLICY_VERSION = "host-command-v1";

export interface HostCommandProcessExecutor {
  assertReady(access: DirectCommandEffect): unknown;
  execute(request: DesktopCommanderProcessRequest): Promise<DesktopCommanderProcessResult>;
}

interface PreparedCommandIntent {
  request: HostCommandRequest;
  target: HostCommandWorkdirTarget;
  classification: ClassifiedHostTarget;
  policy: CommandPolicyDecision;
  selection: DirectExecutorSelection;
  commandHash: string;
  sessionId: string | null;
  workspaceAuthority: WorkspaceMutationAuthority | null;
}

interface WorkspaceGitState {
  branch: string | null;
  headCommit: string | null;
  dirty: boolean;
  changedPaths: string[];
}

interface PreparedCommandExecution {
  approval: DirectCommandApprovalRecord;
  intent: PreparedCommandIntent;
  startedAt: string;
  beforeGit: WorkspaceGitState | null;
}

interface ExternalCommandOutcome {
  process: DesktopCommanderProcessResult | null;
  errorCode: string | null;
}

export interface HostCommandExecutionValue {
  ok: boolean;
  rootId: string;
  workdir: string;
  command: string;
  effect: DirectCommandEffect;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  errorCode: string | null;
  approval: {
    id: string;
    status: "consumed";
  };
  execution: {
    lane: "chat-direct";
    modelLoopOwner: "chatgpt";
    executionScope: "host";
    executor: string;
    selectionMode: "automatic" | "explicit";
    operationId: string;
    changedPaths: string[];
    evidenceBundleId: string | null;
  };
  evidence:
    | {
        kind: "direct-command-audit";
        auditId: string;
      }
    | {
        kind: "task-evidence";
        bundleId: string;
        itemId: string;
      };
}

function approvalExpiry(now: string): string {
  return new Date(Date.parse(now) + HOST_COMMAND_APPROVAL_TTL_MS).toISOString();
}

function exactCommandHash(input: {
  rootId: string;
  workdir: string;
  command: string;
  args: string[];
  effect: DirectCommandEffect;
  timeoutMs: number;
  executorId: string;
  targetKind: "workspace" | "pure-host";
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        policyVersion: HOST_COMMAND_POLICY_VERSION,
        ...input
      }),
      "utf8"
    )
    .digest("hex");
}

function processErrorCode(error: unknown): string {
  if (error instanceof DesktopCommanderProcessError) {
    switch (error.code) {
      case "DESKTOP_COMMANDER_PROCESS_INVALID":
        return "HOST_COMMAND_PROCESS_INVALID";
      case "DESKTOP_COMMANDER_PROCESS_TERMINATION_FAILED":
        return "HOST_COMMAND_TERMINATION_FAILED";
      case "DESKTOP_COMMANDER_PROCESS_RESULT_UNKNOWN":
        return "HOST_COMMAND_RESULT_UNKNOWN";
      case "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE":
        return "DOWNSTREAM_MAPPING_UNAVAILABLE";
    }
  }
  return "HOST_COMMAND_RESULT_UNKNOWN";
}

function redactKnownPrivatePaths(
  output: string,
  target: HostCommandWorkdirTarget,
  workspace: PrivateWorkspaceRecord | null
): string {
  const replacements: Array<[string, string]> = [
    [target.absolutePath, target.displayPath],
    [target.rootAbsolutePath, target.rootId]
  ];
  if (workspace) {
    replacements.push([workspace.privatePath, workspace.repoId]);
  }
  const home = os.homedir();
  if (home) {
    replacements.push([home, "~"]);
  }
  return replacements
    .sort((left, right) => right[0].length - left[0].length)
    .reduce(
      (value, [privatePath, publicPath]) =>
        privatePath ? value.split(privatePath).join(publicPath) : value,
      output
    );
}

export class HostCommandService {
  private readonly git: GitService;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    private readonly broker: DirectCapabilityBroker,
    private readonly processExecutor: HostCommandProcessExecutor,
    private readonly configPath?: string
  ) {
    this.git = new GitService(paths);
  }

  async prepare(
    context: OperationContext,
    input: HostCommandPrepareInput
  ): Promise<{
    ok: true;
    approval: DirectCommandApprovalRecord;
    replayed: boolean;
  }> {
    const { idempotencyKey, ...request } = input;
    const execution = this.repositories.idempotency.execute(
      "host.command.prepare",
      idempotencyKey,
      request,
      () => {
        const intent = this.prepareIntent(context, request);
        const approval = this.repositories.directCommandApprovals.create({
          rootId: intent.target.rootId,
          workdir: intent.target.relativePath,
          command: intent.policy.command,
          args: intent.policy.args,
          commandHash: intent.commandHash,
          effect: intent.policy.effect,
          timeoutMs: request.timeoutMs,
          executorId: intent.selection.executorId,
          targetKind: intent.classification.kind,
          workspaceId: intent.classification.workspaceId,
          repoId: intent.classification.repoId,
          sessionId: intent.sessionId,
          publicSummary: this.publicSummary(intent),
          expiresAt: approvalExpiry(context.now),
          now: context.now
        });
        return { ok: true as const, approval };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  async decide(
    context: OperationContext,
    input: HostCommandDecisionInput
  ): Promise<{
    ok: true;
    approval: DirectCommandApprovalRecord;
    replayed: boolean;
  }> {
    const { idempotencyKey, ...decision } = input;
    const execution = this.repositories.idempotency.execute(
      "host.command.decide",
      idempotencyKey,
      decision,
      () => ({
        ok: true as const,
        approval: this.repositories.directCommandApprovals.decide({
          id: decision.approvalId,
          decision: decision.decision,
          expectedRevision: decision.expectedRevision,
          now: context.now
        })
      }),
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  async execute(
    context: OperationContext,
    input: HostCommandExecuteInput
  ): Promise<HostCommandExecutionValue & { replayed: boolean }> {
    const {
      idempotencyKey,
      approvalId,
      expectedApprovalRevision,
      ...request
    } = input;
    const idempotencyInput = {
      approvalId,
      expectedApprovalRevision,
      ...request
    };

    const execution =
      await this.repositories.idempotency.executePreparedExternalMutation<
        PreparedCommandExecution,
        ExternalCommandOutcome,
        HostCommandExecutionValue
      >(
        "host.command.execute",
        idempotencyKey,
        idempotencyInput,
        () => {
          const approval = this.requireExecutableApproval(
            approvalId,
            expectedApprovalRevision,
            context.now
          );
          if (request.executorId && request.executorId !== approval.executorId) {
            throw new ServiceError(
              "HOST_COMMAND_HASH_MISMATCH",
              "Host command executor does not match the approved intent"
            );
          }
          const intent = this.prepareIntent(
            context,
            { ...request, executorId: approval.executorId },
            approval.executorId
          );
          this.assertApprovalMatches(approval, intent);
          const beforeGit =
            intent.policy.effect === "write" && intent.workspaceAuthority
              ? this.readWorkspaceGit(context, intent.workspaceAuthority.workspace)
              : null;
          const consumed = this.repositories.directCommandApprovals.consume({
            id: approval.id,
            expectedRevision: approval.revision,
            now: context.now
          });
          return {
            approval: consumed,
            intent,
            startedAt: context.now,
            beforeGit
          };
        },
        async (prepared) => {
          try {
            return {
              process: await this.processExecutor.execute({
                cwd: prepared.intent.target.absolutePath,
                command: prepared.intent.policy.command,
                args: prepared.intent.policy.args,
                timeoutMs: prepared.intent.request.timeoutMs,
                access: prepared.intent.policy.effect
              }),
              errorCode: null
            };
          } catch (error) {
            return {
              process: null,
              errorCode: processErrorCode(error)
            };
          }
        },
        (prepared, outcome) => this.commitExecution(context, prepared, outcome),
        undefined,
        context.now
      );

    return { ...execution.value, replayed: execution.replayed };
  }

  private prepareIntent(
    context: OperationContext,
    request: HostCommandRequest,
    forcedExecutorId?: string
  ): PreparedCommandIntent {
    let target: HostCommandWorkdirTarget;
    try {
      target = resolveHostCommandWorkdirTarget({
        rootId: request.rootId,
        workdir: request.workdir,
        requiredAccess: "read",
        ...(this.configPath ? { configPath: this.configPath } : {})
      });
    } catch (error) {
      if (error instanceof HostPathPolicyError) {
        throw new ServiceError(error.code, error.message);
      }
      throw error;
    }

    const classification = classifyHostTarget(
      this.repositories,
      target.absolutePath
    );
    let policy: CommandPolicyDecision;
    try {
      if (classification.kind === "pure-host") {
        try {
          const pureHostPolicy = evaluatePureHostCommand(
            request.command,
            request.args
          );
          assertHostCommandRelativePathsInsideRoot(
            target,
            pureHostPolicy.relativePathArgs
          );
          policy = pureHostPolicy;
        } catch (error) {
          if (error instanceof HostPathPolicyError) {
            throw error;
          }
          try {
            const broaderPolicy = evaluateWorkspaceCommand(
              request.command,
              request.args
            );
            if (broaderPolicy.effect === "write") {
              throw new ServiceError(
                "HOST_COMMAND_EFFECT_UNSUPPORTED",
                "Pure Host write-effect commands are not enabled in this phase"
              );
            }
          } catch (broaderError) {
            if (broaderError instanceof ServiceError) {
              throw broaderError;
            }
          }
          throw error;
        }
      } else {
        policy = evaluateWorkspaceCommand(request.command, request.args);
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      if (error instanceof HostPathPolicyError) {
        throw new ServiceError(error.code, error.message);
      }
      throw new ServiceError(
        "HOST_COMMAND_POLICY_BLOCKED",
        error instanceof Error ? error.message : "Host command policy rejected the request"
      );
    }

    if (policy.effect === "write") {
      try {
        target = resolveHostCommandWorkdirTarget({
          rootId: request.rootId,
          workdir: request.workdir,
          requiredAccess: "write",
          ...(this.configPath ? { configPath: this.configPath } : {})
        });
      } catch (error) {
        if (error instanceof HostPathPolicyError) {
          throw new ServiceError(error.code, error.message);
        }
        throw error;
      }
    }

    let sessionId: string | null = null;
    let workspaceAuthority: WorkspaceMutationAuthority | null = null;
    if (classification.kind === "workspace" && policy.effect === "write") {
      if (!classification.repoId) {
        throw new ServiceError(
          "CONTINUITY_RELATION_INVALID",
          "Workspace Host command has no repository mapping"
        );
      }
      const authority = assertChatDirectWriterLease(
        this.repositories,
        context,
        classification.repoId,
        request.sessionId
      );
      if (authority.workspace.id !== classification.workspaceId) {
        throw new ServiceError(
          "CONTINUITY_RELATION_INVALID",
          "Host command Workspace classification changed during governance checks"
        );
      }
      sessionId = authority.session.id;
      workspaceAuthority = authority;
    }

    let selection: DirectExecutorSelection;
    try {
      const executorId = forcedExecutorId ?? request.executorId;
      selection = this.broker.resolve({
        capability: "shell.exec",
        scope: "host",
        access: policy.effect,
        ...(executorId ? { executorId } : {})
      });
    } catch (error) {
      if (error instanceof DirectCapabilityBrokerError) {
        throw new ServiceError(error.code, error.message, {
          hint:
            "Probe the configured Desktop Commander Host Command mapping before retrying.",
          details: error.details
        });
      }
      throw error;
    }
    if (selection.executorId !== DESKTOP_COMMANDER_EXECUTOR_ID) {
      throw new ServiceError(
        "HOST_EXECUTOR_UNSUPPORTED",
        `Host Command does not support executor ${selection.executorId}`
      );
    }
    try {
      this.processExecutor.assertReady(policy.effect);
    } catch (error) {
      if (error instanceof DesktopCommanderProcessError) {
        throw new ServiceError(processErrorCode(error), error.message);
      }
      throw error;
    }

    const commandHash = exactCommandHash({
      rootId: target.rootId,
      workdir: target.relativePath,
      command: policy.command,
      args: policy.args,
      effect: policy.effect,
      timeoutMs: request.timeoutMs,
      executorId: selection.executorId,
      targetKind: classification.kind,
      workspaceId: classification.workspaceId,
      repoId: classification.repoId,
      sessionId
    });

    return {
      request,
      target,
      classification,
      policy,
      selection,
      commandHash,
      sessionId,
      workspaceAuthority
    };
  }

  private requireExecutableApproval(
    approvalId: string,
    expectedRevision: number,
    now: string
  ): DirectCommandApprovalRecord {
    const approval = this.repositories.directCommandApprovals.expireIfNeeded(
      approvalId,
      now
    );
    if (approval.status === "expired") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_EXPIRED",
        "Host command approval expired"
      );
    }
    if (approval.status === "consumed") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_CONSUMED",
        "Host command approval was already consumed"
      );
    }
    if (approval.status !== "approved") {
      throw new ServiceError(
        "HOST_COMMAND_APPROVAL_REQUIRED",
        "Host command requires an approved Direct Command approval"
      );
    }
    if (approval.revision !== expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Direct command approval ${approval.id} no longer has revision ${expectedRevision}`,
        {
          details: {
            expectedRevision,
            actualRevision: approval.revision
          }
        }
      );
    }
    return approval;
  }

  private assertApprovalMatches(
    approval: DirectCommandApprovalRecord,
    intent: PreparedCommandIntent
  ): void {
    const mismatch =
      approval.rootId !== intent.target.rootId ||
      approval.workdir !== intent.target.relativePath ||
      approval.command !== intent.policy.command ||
      JSON.stringify(approval.args) !== JSON.stringify(intent.policy.args) ||
      approval.commandHash !== intent.commandHash ||
      approval.effect !== intent.policy.effect ||
      approval.timeoutMs !== intent.request.timeoutMs ||
      approval.executorId !== intent.selection.executorId ||
      approval.targetKind !== intent.classification.kind ||
      approval.workspaceId !== intent.classification.workspaceId ||
      approval.repoId !== intent.classification.repoId ||
      approval.sessionId !== intent.sessionId;
    if (mismatch) {
      throw new ServiceError(
        "HOST_COMMAND_HASH_MISMATCH",
        "Host command no longer matches the approved exact intent"
      );
    }
  }

  private readWorkspaceGit(
    context: OperationContext,
    workspace: PrivateWorkspaceRecord
  ): WorkspaceGitState {
    const status = this.git.status(context, workspace.repoId);
    const headCommit =
      this.git.recentCommits(context, workspace.repoId, 1)[0]?.hash ??
      workspace.headCommit;
    return {
      branch: status.branch || workspace.branch,
      headCommit,
      dirty: status.entries.length > 0,
      changedPaths: status.entries
        .filter((entry) => entry.status !== "blocked")
        .map((entry) => entry.path)
        .sort()
    };
  }

  private commitExecution(
    context: OperationContext,
    prepared: PreparedCommandExecution,
    outcome: ExternalCommandOutcome
  ): HostCommandExecutionValue {
    const process = outcome.process;
    const status = outcome.errorCode
      ? "unknown"
      : process?.ok
        ? "succeeded"
        : "failed";
    const exitCode = process?.exitCode ?? null;
    const timedOut = process?.timedOut ?? false;
    const workspace = prepared.intent.classification.workspaceId
      ? this.repositories.workspaces.getPrivate(
          prepared.intent.classification.workspaceId
        )
      : null;
    const output = redactKnownPrivatePaths(
      process?.output ?? "",
      prepared.intent.target,
      workspace
    );

    const audit = this.repositories.directCommandAudit.create({
      rootId: prepared.intent.target.rootId,
      workdir: prepared.intent.target.relativePath,
      commandHash: prepared.intent.commandHash,
      effect: prepared.intent.policy.effect,
      executorId: prepared.intent.selection.executorId,
      approvalId: prepared.approval.id,
      exitCode,
      timedOut,
      status,
      errorCode: outcome.errorCode,
      startedAt: prepared.startedAt,
      completedAt: context.now,
      now: context.now
    });

    if (
      prepared.intent.classification.kind === "workspace" &&
      prepared.intent.policy.effect === "write"
    ) {
      return this.commitWorkspaceWrite(
        context,
        prepared,
        outcome,
        audit.id,
        output
      );
    }

    return {
      ok: Boolean(process?.ok && !outcome.errorCode),
      rootId: prepared.intent.target.rootId,
      workdir: prepared.intent.target.displayPath,
      command: prepared.intent.policy.command,
      effect: prepared.intent.policy.effect,
      exitCode,
      output,
      truncated: process?.truncated ?? false,
      timedOut,
      errorCode: outcome.errorCode,
      approval: {
        id: prepared.approval.id,
        status: "consumed"
      },
      execution: {
        lane: "chat-direct",
        modelLoopOwner: "chatgpt",
        executionScope: "host",
        executor: prepared.intent.selection.executorId,
        selectionMode: prepared.intent.selection.selectionMode,
        operationId: `chat_direct_${randomUUID()}`,
        changedPaths: [],
        evidenceBundleId: null
      },
      evidence: {
        kind: "direct-command-audit",
        auditId: audit.id
      }
    };
  }

  private commitWorkspaceWrite(
    context: OperationContext,
    prepared: PreparedCommandExecution,
    outcome: ExternalCommandOutcome,
    auditId: string,
    output: string
  ): HostCommandExecutionValue {
    const authority = prepared.intent.workspaceAuthority;
    if (!authority || !prepared.beforeGit) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Workspace Host command lost its governance context before evidence commit"
      );
    }
    const afterGit = this.readWorkspaceGit(context, authority.workspace);
    const latestWorkspace = this.repositories.workspaces.getPrivate(
      authority.workspace.id
    );
    this.repositories.workspaces.updateGitState(authority.workspace.id, {
      branch: afterGit.branch,
      headCommit: afterGit.headCommit,
      dirty: afterGit.dirty,
      expectedRevision: latestWorkspace.revision,
      now: context.now
    });

    let task = this.repositories.tasks.get(authority.task.id);
    let bundle = task.latestEvidenceBundleId
      ? this.repositories.evidence.getBundle(task.latestEvidenceBundleId)
      : null;
    if (
      !bundle ||
      bundle.taskId !== task.id ||
      bundle.sessionId !== authority.session.id
    ) {
      bundle = this.repositories.evidence.createBundle({
        taskId: task.id,
        sessionId: authority.session.id,
        now: context.now
      });
      task = this.repositories.tasks.setLatestEvidenceBundle(
        task.id,
        bundle.id,
        task.revision,
        context.now
      );
    }

    const process = outcome.process;
    const evidenceStatus =
      !outcome.errorCode && process?.ok && !process.timedOut ? "passed" : "failed";
    const summary = JSON.stringify({
      operation: "shell.exec",
      command: prepared.intent.policy.command,
      commandHash: prepared.intent.commandHash,
      effect: prepared.intent.policy.effect,
      executorId: prepared.intent.selection.executorId,
      approvalId: prepared.approval.id,
      auditId,
      exitCode: process?.exitCode ?? null,
      timedOut: process?.timedOut ?? false,
      errorCode: outcome.errorCode,
      git: {
        before: prepared.beforeGit,
        after: afterGit
      }
    });
    const item = this.repositories.evidence.addItem({
      bundleId: bundle.id,
      kind: "command",
      label: `Host Direct command ${prepared.intent.policy.command}`,
      status: evidenceStatus,
      required: false,
      summary,
      startedAt: prepared.startedAt,
      completedAt: context.now,
      now: context.now
    });

    return {
      ok: Boolean(process?.ok && !outcome.errorCode),
      rootId: prepared.intent.target.rootId,
      workdir: prepared.intent.target.displayPath,
      command: prepared.intent.policy.command,
      effect: prepared.intent.policy.effect,
      exitCode: process?.exitCode ?? null,
      output,
      truncated: process?.truncated ?? false,
      timedOut: process?.timedOut ?? false,
      errorCode: outcome.errorCode,
      approval: {
        id: prepared.approval.id,
        status: "consumed"
      },
      execution: {
        lane: "chat-direct",
        modelLoopOwner: "chatgpt",
        executionScope: "host",
        executor: prepared.intent.selection.executorId,
        selectionMode: prepared.intent.selection.selectionMode,
        operationId: `chat_direct_${randomUUID()}`,
        changedPaths: afterGit.changedPaths,
        evidenceBundleId: bundle.id
      },
      evidence: {
        kind: "task-evidence",
        bundleId: bundle.id,
        itemId: item.id
      }
    };
  }

  private publicSummary(intent: PreparedCommandIntent): Record<string, unknown> {
    return {
      operation: "shell.exec",
      command: intent.policy.command,
      argumentCount: intent.policy.args.length,
      workdir: intent.target.displayPath,
      effect: intent.policy.effect,
      timeoutMs: intent.request.timeoutMs,
      targetKind: intent.classification.kind,
      ...(intent.classification.workspaceId
        ? { workspaceId: intent.classification.workspaceId }
        : {}),
      ...(intent.classification.repoId
        ? { repoId: intent.classification.repoId }
        : {}),
      executorId: intent.selection.executorId,
      selectionMode: intent.selection.selectionMode,
      commandHash: intent.commandHash
    };
  }
}

export function buildDesktopCommanderHostCommandService(options: {
  paths: TokenPilotPaths;
  repositories: ContinuityRepositories;
  broker: DirectCapabilityBroker;
  configPath?: string;
}): HostCommandService {
  return new HostCommandService(
    options.paths,
    options.repositories,
    options.broker,
    new DesktopCommanderProcessAdapter(
      options.paths.runtimeDir,
      options.configPath
    ),
    options.configPath
  );
}
