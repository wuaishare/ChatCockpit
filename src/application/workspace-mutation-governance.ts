import fs from "node:fs";
import path from "node:path";

import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  PrivateWorkspaceRecord,
  TaskRecord,
  WriterLeaseRecord
} from "../continuity/types.js";
import { isPathInsideRoot } from "../core/path-guards.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface ClassifiedHostTarget {
  kind: "workspace" | "pure-host";
  workspaceId: string | null;
  repoId: string | null;
  workspaceRelativePath: string | null;
}

export interface WorkspaceMutationAuthority {
  workspace: PrivateWorkspaceRecord;
  session: DevelopmentSessionRecord;
  task: TaskRecord;
  lease: WriterLeaseRecord;
}

function nearestExistingPath(target: string): string {
  let current = target;
  while (true) {
    try {
      fs.lstatSync(current);
      return current;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Host target has no resolvable filesystem ancestor"
      );
    }
    current = parent;
  }
}

function canonicalPotentialPath(target: string): string {
  const resolvedTarget = path.resolve(target);
  const existing = nearestExistingPath(resolvedTarget);
  const canonicalExisting = fs.realpathSync.native(existing);
  const remainder = path.relative(existing, resolvedTarget);
  return path.resolve(canonicalExisting, remainder);
}

export function classifyHostTarget(
  repositories: ContinuityRepositories,
  absoluteTarget: string
): ClassifiedHostTarget {
  const canonicalTarget = canonicalPotentialPath(absoluteTarget);
  const matches = repositories.workspaces
    .listPrivate()
    .map((workspace) => ({
      workspace,
      canonicalRoot: fs.realpathSync.native(workspace.privatePath)
    }))
    .filter(({ canonicalRoot }) =>
      isPathInsideRoot(canonicalRoot, canonicalTarget)
    )
    .sort((left, right) => right.canonicalRoot.length - left.canonicalRoot.length);

  if (matches.length === 0) {
    return {
      kind: "pure-host",
      workspaceId: null,
      repoId: null,
      workspaceRelativePath: null
    };
  }

  const best = matches[0];
  const equallyDeep = matches.filter(
    (candidate) => candidate.canonicalRoot.length === best.canonicalRoot.length
  );
  if (equallyDeep.length > 1) {
    throw new ServiceError(
      "CONTINUITY_RELATION_INVALID",
      "Host target maps ambiguously to multiple registered workspaces"
    );
  }

  const relativePath = path
    .relative(best.canonicalRoot, canonicalTarget)
    .replaceAll("\\", "/");
  if (
    path.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new ServiceError(
      "CONTINUITY_RELATION_INVALID",
      "Host target could not be projected safely into its workspace"
    );
  }

  return {
    kind: "workspace",
    workspaceId: best.workspace.id,
    repoId: best.workspace.repoId,
    workspaceRelativePath: relativePath || "."
  };
}

export const classifyHostMutationTarget = classifyHostTarget;

export function assertChatDirectWriterLease(
  repositories: ContinuityRepositories,
  context: OperationContext,
  repoId: string,
  sessionId: string | undefined
): WorkspaceMutationAuthority {
  const workspace = repositories.workspaces.findPrivateByRepoId(repoId);
  if (!workspace) {
    throw new ServiceError(
      "CONTINUITY_RELATION_INVALID",
      `No ChatCockpit workspace is mapped to repository ${repoId}`,
      { details: { repoId } }
    );
  }
  if (!sessionId) {
    throw new ServiceError(
      "WRITER_LEASE_REQUIRED",
      "A mutating Chat Direct operation requires a development session",
      {
        hint:
          "Start a chat-direct session, acquire the workspace writer lease, and retry with that sessionId.",
        details: { repoId, workspaceId: workspace.id }
      }
    );
  }

  const session = repositories.sessions.get(sessionId);
  if (
    session.projectId !== workspace.projectId ||
    session.workspaceId !== workspace.id
  ) {
    throw new ServiceError(
      "CONTINUITY_RELATION_INVALID",
      "The Chat Direct session does not belong to the requested repository workspace",
      {
        details: {
          sessionId: session.id,
          workspaceId: workspace.id,
          repoId
        }
      }
    );
  }
  if (session.mode !== "chat-direct") {
    throw new ServiceError(
      "CONTINUITY_RELATION_INVALID",
      "Only a chat-direct development session can authorize Chat Direct mutation",
      {
        details: {
          sessionId: session.id,
          sessionMode: session.mode,
          workspaceId: workspace.id
        }
      }
    );
  }
  if (["completed", "failed"].includes(session.status)) {
    throw new ServiceError(
      "CONTINUITY_RELATION_INVALID",
      "A completed or failed development session cannot mutate the workspace",
      {
        details: {
          sessionId: session.id,
          sessionStatus: session.status,
          workspaceId: workspace.id
        }
      }
    );
  }

  const task = repositories.tasks.get(session.taskId);
  if (
    task.projectId !== workspace.projectId ||
    task.workspaceId !== workspace.id ||
    task.activeSessionId !== session.id
  ) {
    throw new ServiceError(
      "CONTINUITY_RELATION_INVALID",
      "The Chat Direct session is not the active session for its workspace task",
      {
        details: {
          taskId: task.id,
          sessionId: session.id,
          activeSessionId: task.activeSessionId,
          workspaceId: workspace.id
        }
      }
    );
  }

  repositories.leases.reconcileExpired(context.now);
  const lease = repositories.leases.getActive(workspace.id);
  if (!lease) {
    throw new ServiceError(
      "WRITER_LEASE_REQUIRED",
      "The workspace has no active writer lease for this Chat Direct mutation",
      {
        hint:
          "Acquire a chat-direct writer lease for the session before retrying the mutation.",
        details: {
          sessionId: session.id,
          workspaceId: workspace.id,
          repoId
        }
      }
    );
  }
  if (lease.sessionId !== session.id || lease.holderType !== "chat-direct") {
    throw new ServiceError(
      "WRITER_LEASE_CONFLICT",
      "Another development session owns the workspace writer lease",
      {
        details: {
          leaseId: lease.id,
          leaseSessionId: lease.sessionId,
          requestedSessionId: session.id,
          holderType: lease.holderType,
          workspaceId: workspace.id,
          expiresAt: lease.expiresAt
        }
      }
    );
  }

  return { workspace, session, task, lease };
}
