import { randomUUID } from "node:crypto";
import fs from "node:fs";

import {
  buildTextPreviewFromBuffer,
  resolveReadableRepoFileTarget
} from "../core/files-api.js";
import {
  assertWriteContentAllowed,
  listRepoDirectory,
  resolveWritableRepoPathTarget
} from "../core/files-write.js";
import { prepareShellCommand } from "../core/shell-api.js";
import type {
  FileEditPayload,
  FileListPayload,
  FileReadBatchPayload,
  FileReadPayload,
  FileWritePayload,
  GitCommitPayload,
  SearchPayload,
  ShellRunPayload,
  TokenPilotPaths
} from "../types.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { CodexStandaloneCapabilityStore } from "../runtime/codex/standalone-capabilities.js";
import { FilesService } from "./files-service.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";
import { SearchService } from "./search-service.js";
import { ServiceError } from "./service-error.js";
import { ShellService } from "./shell-service.js";

export type ChatDirectExecutor =
  | "codex-app-server-standalone"
  | "tokenpilot-direct"
  | "legacy-core";

export interface ChatDirectExecutionMetadata {
  lane: "chat-direct";
  modelLoopOwner: "chatgpt";
  executor: ChatDirectExecutor;
  operationId: string;
  changedPaths: string[];
  evidenceBundleId: string | null;
  fallbackReason?: string;
}

type WithExecution<T> = T & { execution: ChatDirectExecutionMetadata };

function metadata(
  executor: ChatDirectExecutor,
  changedPaths: string[] = [],
  fallbackReason?: string
): ChatDirectExecutionMetadata {
  return {
    lane: "chat-direct",
    modelLoopOwner: "chatgpt",
    executor,
    operationId: `chat_direct_${randomUUID()}`,
    changedPaths: [...changedPaths].sort(),
    evidenceBundleId: null,
    ...(fallbackReason ? { fallbackReason } : {})
  };
}

function serviceError(code: string, error: unknown): ServiceError {
  return error instanceof ServiceError
    ? error
    : new ServiceError(
        code,
        error instanceof Error ? error.message : String(error)
      );
}

export class ChatDirectService {
  private readonly files: FilesService;
  private readonly git: GitService;
  private readonly searchService: SearchService;
  private readonly shellService: ShellService;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly runtime: RuntimeRouter,
    private readonly capabilities: CodexStandaloneCapabilityStore,
    private readonly repositories: ContinuityRepositories
  ) {
    this.files = new FilesService(paths);
    this.git = new GitService(paths);
    this.searchService = new SearchService(paths);
    this.shellService = new ShellService(paths);
  }

  async read(context: OperationContext, payload: FileReadPayload) {
    if (this.canUseStandalone("files.read")) {
      try {
        const target = resolveReadableRepoFileTarget(
          this.paths,
          payload.repoId,
          payload.path
        );
        const response = await this.runtime.readStandaloneFile(
          target.absolutePath
        );
        const file = buildTextPreviewFromBuffer(
          target.relativePath,
          Buffer.from(response.dataBase64, "base64"),
          { offset: payload.offset, limit: payload.limit }
        );
        return {
          ok: true as const,
          repoId: payload.repoId,
          file,
          execution: metadata("codex-app-server-standalone")
        };
      } catch (error) {
        if (!this.canFallbackRead(error)) {
          throw serviceError("FILES_READ_BLOCKED", error);
        }
      }
    }
    const value = this.files.read(context, payload);
    return {
      ...value,
      execution: metadata("tokenpilot-direct", [], "standalone-read-unavailable")
    };
  }

  async readBatch(context: OperationContext, payload: FileReadBatchPayload) {
    if (this.canUseStandalone("files.read")) {
      try {
        const files = [];
        for (const inputPath of payload.paths) {
          const target = resolveReadableRepoFileTarget(
            this.paths,
            payload.repoId,
            inputPath
          );
          const response = await this.runtime.readStandaloneFile(
            target.absolutePath
          );
          files.push(
            buildTextPreviewFromBuffer(
              target.relativePath,
              Buffer.from(response.dataBase64, "base64"),
              { offset: payload.offset, limit: payload.limit }
            )
          );
        }
        return {
          ok: true as const,
          repoId: payload.repoId,
          files,
          execution: metadata("codex-app-server-standalone")
        };
      } catch (error) {
        if (!this.canFallbackRead(error)) {
          throw serviceError("FILES_READ_BLOCKED", error);
        }
      }
    }
    const value = this.files.readBatch(context, payload);
    return {
      ...value,
      execution: metadata("tokenpilot-direct", [], "standalone-read-unavailable")
    };
  }

  async list(context: OperationContext, payload: FileListPayload) {
    if (this.canUseStandalone("files.list")) {
      try {
        const target = resolveWritableRepoPathTarget(
          this.paths,
          payload.repoId,
          payload.path,
          "Directory path"
        );
        await this.runtime.listStandaloneDirectory(target.absolutePath);
        const value = listRepoDirectory(this.paths, payload);
        return {
          ...value,
          execution: metadata("codex-app-server-standalone")
        };
      } catch (error) {
        if (!this.canFallbackRead(error)) {
          throw serviceError("FILES_LIST_BLOCKED", error);
        }
      }
    }
    const value = this.files.list(context, payload);
    return {
      ...value,
      execution: metadata("tokenpilot-direct", [], "standalone-list-unavailable")
    };
  }

  async write(context: OperationContext, payload: FileWritePayload) {
    this.assertWriterLease(context, payload.repoId, payload.sessionId);
    if (this.canUseStandalone("files.write")) {
      try {
        const target = resolveWritableRepoPathTarget(
          this.paths,
          payload.repoId,
          payload.path
        );
        assertWriteContentAllowed(payload.content);
        await this.runtime.writeStandaloneFile(
          target.absolutePath,
          Buffer.from(payload.content, "utf8").toString("base64")
        );
        const stat = fs.statSync(target.absolutePath);
        return {
          ok: true as const,
          repoId: payload.repoId,
          path: target.relativePath,
          written: true as const,
          size: stat.size,
          execution: metadata("codex-app-server-standalone", [
            target.relativePath
          ])
        };
      } catch (error) {
        if (this.canFallbackMutation(error)) {
          const value = this.files.write(context, payload);
          return {
            ...value,
            execution: metadata(
              "tokenpilot-direct",
              [payload.path],
              "standalone-write-unavailable"
            )
          };
        }
        throw serviceError("FILES_WRITE_BLOCKED", error);
      }
    }
    const value = this.files.write(context, payload);
    return {
      ...value,
      execution: metadata("tokenpilot-direct", [payload.path])
    };
  }

  async edit(context: OperationContext, payload: FileEditPayload) {
    this.assertWriterLease(context, payload.repoId, payload.sessionId);
    const value = this.files.edit(context, payload);
    return {
      ...value,
      execution: metadata("tokenpilot-direct", [payload.path])
    };
  }

  async search(context: OperationContext, payload: SearchPayload) {
    const value = this.searchService.search(context, payload);
    return {
      ...value,
      execution: metadata("tokenpilot-direct")
    };
  }

  async shell(context: OperationContext, payload: ShellRunPayload) {
    let prepared: ReturnType<typeof prepareShellCommand>;
    try {
      prepared = prepareShellCommand(this.paths, payload);
    } catch (error) {
      throw serviceError("SHELL_COMMAND_BLOCKED", error);
    }
    if (!prepared.standaloneReadOnly) {
      this.assertWriterLease(context, payload.repoId, payload.sessionId);
    }
    if (
      prepared.standaloneReadOnly &&
      this.canUseStandalone("command.exec")
    ) {
      const startedAt = Date.now();
      try {
        const result = await this.runtime.executeStandaloneCommand({
          command: [prepared.command, ...prepared.args],
          cwd: prepared.workdir,
          timeoutMs: prepared.timeoutMs,
          outputBytesCap: prepared.outputBytesCap,
          readOnly: true
        });
        const elapsed = Date.now() - startedAt;
        return {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout:
            result.stdout || (result.exitCode === 0 ? "(no output)" : ""),
          stderr: result.stderr,
          truncated: false,
          executedCommand: `${prepared.command} ${prepared.args.join(" ")} (${elapsed}ms)`,
          execution: metadata("codex-app-server-standalone")
        };
      } catch (error) {
        if (!this.canFallbackRead(error)) {
          throw serviceError("SHELL_COMMAND_BLOCKED", error);
        }
      }
    }
    const value = this.shellService.run(context, payload);
    return {
      ...value,
      execution: metadata(
        "tokenpilot-direct",
        [],
        prepared.standaloneReadOnly
          ? "standalone-command-unavailable"
          : "command-policy-kept-tokenpilot-direct"
      )
    };
  }

  async gitStatus(context: OperationContext, repoId: string) {
    const value = this.git.status(context, repoId);
    return { ...value, execution: metadata("tokenpilot-direct") };
  }

  async gitDiff(context: OperationContext, repoId: string, staged = false) {
    const value = this.git.diff(context, repoId, staged);
    return { ...value, execution: metadata("tokenpilot-direct") };
  }

  async gitCommit(context: OperationContext, payload: GitCommitPayload) {
    this.assertWriterLease(context, payload.repoId, payload.sessionId);
    const before = this.git.status(context, payload.repoId);
    const value = this.git.commit(context, payload);
    return {
      ...value,
      execution: metadata(
        "tokenpilot-direct",
        before.entries
          .filter((entry) => entry.status !== "blocked")
          .map((entry) => entry.path)
      )
    };
  }

  async recentCommits(
    context: OperationContext,
    repoId: string,
    limit = 10
  ) {
    const commits = this.git.recentCommits(context, repoId, limit);
    return {
      ok: true as const,
      repoId,
      commits,
      execution: metadata("tokenpilot-direct")
    };
  }

  private assertWriterLease(
    context: OperationContext,
    repoId: string,
    sessionId: string | undefined
  ): void {
    const workspace = this.repositories.workspaces.findPrivateByRepoId(repoId);
    if (!workspace) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        `No TokenPilot workspace is mapped to repository ${repoId}`,
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

    const session = this.repositories.sessions.get(sessionId);
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

    const task = this.repositories.tasks.get(session.taskId);
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

    this.repositories.leases.reconcileExpired(context.now);
    const lease = this.repositories.leases.getActive(workspace.id);
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
  }

  private canUseStandalone(
    operation: "files.read" | "files.write" | "files.list" | "command.exec"
  ): boolean {
    const snapshot = this.capabilities.read();
    const capability = snapshot?.operations[operation];
    return Boolean(
      snapshot?.directExecutionReady &&
        !snapshot.turnStartObserved &&
        capability?.status === "verified" &&
        capability.safeForChatDirect
    );
  }

  private canFallbackRead(error: unknown): boolean {
    return (
      error instanceof ServiceError &&
      [
        "CAPABILITY_UNAVAILABLE",
        "CODEX_BINARY_UNAVAILABLE",
        "CODEX_APP_SERVER_START_FAILED",
        "CODEX_APP_SERVER_DISCONNECTED",
        "CODEX_APP_SERVER_RPC_ERROR",
        "CODEX_STANDALONE_RESPONSE_INVALID"
      ].includes(error.code)
    );
  }

  private canFallbackMutation(error: unknown): boolean {
    return (
      error instanceof ServiceError &&
      [
        "CAPABILITY_UNAVAILABLE",
        "CODEX_BINARY_UNAVAILABLE",
        "CODEX_APP_SERVER_START_FAILED",
        "CODEX_APP_SERVER_RPC_ERROR"
      ].includes(error.code)
    );
  }
}
