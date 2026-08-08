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
import {
  DirectCapabilityBroker,
  DirectCapabilityBrokerError,
  type DirectCapabilityAccess,
  type DirectCapabilityId,
  type DirectExecutorSelection,
  type DirectExecutionScope
} from "../direct/capability-broker.js";
import { FilesService } from "./files-service.js";
import { GitService } from "./git-service.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";
import { SearchService } from "./search-service.js";
import { ServiceError, wrapServiceOperationError } from "./service-error.js";
import { ShellService } from "./shell-service.js";
import { assertChatDirectWriterLease } from "./workspace-mutation-governance.js";

export type { DirectExecutionScope } from "../direct/capability-broker.js";
export type ChatDirectExecutor = string;

export interface ChatDirectExecutionMetadata {
  lane: "chat-direct";
  modelLoopOwner: "chatgpt";
  executionScope: DirectExecutionScope;
  executor: ChatDirectExecutor;
  selectionMode: "automatic" | "explicit";
  operationId: string;
  changedPaths: string[];
  evidenceBundleId: string | null;
  fallbackReason?: string;
}

type WithExecution<T> = T & { execution: ChatDirectExecutionMetadata };

function metadata(
  executor: ChatDirectExecutor,
  selectionMode: "automatic" | "explicit",
  changedPaths: string[] = [],
  fallbackReason?: string
): ChatDirectExecutionMetadata {
  return {
    lane: "chat-direct",
    modelLoopOwner: "chatgpt",
    executionScope: "workspace",
    executor,
    selectionMode,
    operationId: `chat_direct_${randomUUID()}`,
    changedPaths: [...changedPaths].sort(),
    evidenceBundleId: null,
    ...(fallbackReason ? { fallbackReason } : {})
  };
}

function selectionMetadata(
  selection: DirectExecutorSelection,
  changedPaths: string[] = [],
  fallbackReason?: string
): ChatDirectExecutionMetadata {
  return metadata(
    selection.executorId,
    selection.selectionMode,
    changedPaths,
    fallbackReason
  );
}

function serviceError(code: string, error: unknown): ServiceError {
  return wrapServiceOperationError(
    code,
    error,
    "Chat Direct execution could not be completed safely.",
    "Retry after checking the selected workspace, runtime capability, and operation policy."
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
    private readonly broker: DirectCapabilityBroker,
    private readonly repositories: ContinuityRepositories
  ) {
    this.files = new FilesService(paths);
    this.git = new GitService(paths);
    this.searchService = new SearchService(paths);
    this.shellService = new ShellService(paths);
  }

  listExecutors() {
    return {
      ok: true as const,
      modelLoopOwner: "chatgpt" as const,
      hostDirectExposed: false as const,
      executors: this.broker.catalog()
    };
  }

  async read(context: OperationContext, payload: FileReadPayload) {
    const selection = this.select("files.read", "read", payload.executorId);
    if (selection.executorId === "codex-app-server-standalone") {
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
          execution: selectionMetadata(selection)
        };
      } catch (error) {
        if (!this.canFallbackRead(selection, error)) {
          throw serviceError("FILES_READ_BLOCKED", error);
        }
        const fallback = this.fallbackSelection("files.read", "read");
        const value = this.files.read(context, payload);
        return {
          ...value,
          execution: selectionMetadata(
            fallback,
            [],
            "standalone-read-unavailable"
          )
        };
      }
    }
    const value = this.files.read(context, payload);
    return {
      ...value,
      execution: selectionMetadata(selection)
    };
  }

  async readBatch(context: OperationContext, payload: FileReadBatchPayload) {
    const selection = this.select("files.readBatch", "read", payload.executorId);
    if (selection.executorId === "codex-app-server-standalone") {
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
          execution: selectionMetadata(selection)
        };
      } catch (error) {
        if (!this.canFallbackRead(selection, error)) {
          throw serviceError("FILES_READ_BLOCKED", error);
        }
        const fallback = this.fallbackSelection("files.readBatch", "read");
        const value = this.files.readBatch(context, payload);
        return {
          ...value,
          execution: selectionMetadata(
            fallback,
            [],
            "standalone-read-unavailable"
          )
        };
      }
    }
    const value = this.files.readBatch(context, payload);
    return {
      ...value,
      execution: selectionMetadata(selection)
    };
  }

  async list(context: OperationContext, payload: FileListPayload) {
    const selection = this.select("files.list", "read", payload.executorId);
    if (selection.executorId === "codex-app-server-standalone") {
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
          execution: selectionMetadata(selection)
        };
      } catch (error) {
        if (!this.canFallbackRead(selection, error)) {
          throw serviceError("FILES_LIST_BLOCKED", error);
        }
        const fallback = this.fallbackSelection("files.list", "read");
        const value = this.files.list(context, payload);
        return {
          ...value,
          execution: selectionMetadata(
            fallback,
            [],
            "standalone-list-unavailable"
          )
        };
      }
    }
    const value = this.files.list(context, payload);
    return {
      ...value,
      execution: selectionMetadata(selection)
    };
  }

  async write(context: OperationContext, payload: FileWritePayload) {
    assertChatDirectWriterLease(
      this.repositories,
      context,
      payload.repoId,
      payload.sessionId
    );
    const selection = this.select("files.write", "write", payload.executorId);
    if (selection.executorId === "codex-app-server-standalone") {
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
          execution: selectionMetadata(selection, [target.relativePath])
        };
      } catch (error) {
        if (!this.canFallbackMutation(selection, error)) {
          throw serviceError("FILES_WRITE_BLOCKED", error);
        }
        const fallback = this.fallbackSelection("files.write", "write");
        const value = this.files.write(context, payload);
        return {
          ...value,
          execution: selectionMetadata(
            fallback,
            [payload.path],
            "standalone-write-unavailable"
          )
        };
      }
    }
    const value = this.files.write(context, payload);
    return {
      ...value,
      execution: selectionMetadata(selection, [payload.path])
    };
  }

  async edit(context: OperationContext, payload: FileEditPayload) {
    assertChatDirectWriterLease(
      this.repositories,
      context,
      payload.repoId,
      payload.sessionId
    );
    const selection = this.select("files.edit", "write", payload.executorId);
    const value = this.files.edit(context, payload);
    return {
      ...value,
      execution: selectionMetadata(selection, [payload.path])
    };
  }

  async search(context: OperationContext, payload: SearchPayload) {
    const selection = this.select("search.content", "read", payload.executorId);
    const value = this.searchService.search(context, payload);
    return {
      ...value,
      execution: selectionMetadata(selection)
    };
  }

  async shell(context: OperationContext, payload: ShellRunPayload) {
    let prepared: ReturnType<typeof prepareShellCommand>;
    try {
      prepared = prepareShellCommand(this.paths, payload);
    } catch (error) {
      throw serviceError("SHELL_COMMAND_BLOCKED", error);
    }
    const access: DirectCapabilityAccess = prepared.standaloneReadOnly
      ? "read"
      : "write";
    if (access === "write") {
      assertChatDirectWriterLease(
        this.repositories,
        context,
        payload.repoId,
        payload.sessionId
      );
    }
    const selection = this.select("shell.exec", access, payload.executorId);
    if (selection.executorId === "codex-app-server-standalone") {
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
          execution: selectionMetadata(selection)
        };
      } catch (error) {
        if (!this.canFallbackRead(selection, error)) {
          throw serviceError("SHELL_COMMAND_BLOCKED", error);
        }
        const fallback = this.fallbackSelection("shell.exec", "read");
        const value = this.shellService.run(context, payload);
        return {
          ...value,
          execution: selectionMetadata(
            fallback,
            [],
            "standalone-command-unavailable"
          )
        };
      }
    }
    const value = this.shellService.run(context, payload);
    return {
      ...value,
      execution: selectionMetadata(
        selection,
        [],
        access === "write" && selection.selectionMode === "automatic"
          ? "command-policy-kept-tokenpilot-direct"
          : undefined
      )
    };
  }

  async gitStatus(
    context: OperationContext,
    repoId: string,
    executorId?: string
  ) {
    const selection = this.select("git.status", "read", executorId);
    const value = this.git.status(context, repoId);
    return { ...value, execution: selectionMetadata(selection) };
  }

  async gitDiff(
    context: OperationContext,
    repoId: string,
    staged = false,
    executorId?: string
  ) {
    const selection = this.select("git.diff", "read", executorId);
    const value = this.git.diff(context, repoId, staged);
    return { ...value, execution: selectionMetadata(selection) };
  }

  async gitCommit(context: OperationContext, payload: GitCommitPayload) {
    assertChatDirectWriterLease(
      this.repositories,
      context,
      payload.repoId,
      payload.sessionId
    );
    const selection = this.select("git.commit", "write", payload.executorId);
    const before = this.git.status(context, payload.repoId);
    const value = this.git.commit(context, payload);
    return {
      ...value,
      execution: selectionMetadata(
        selection,
        before.entries
          .filter((entry) => entry.status !== "blocked")
          .map((entry) => entry.path)
      )
    };
  }

  async recentCommits(
    context: OperationContext,
    repoId: string,
    limit = 10,
    executorId?: string
  ) {
    const selection = this.select("git.log", "read", executorId);
    const commits = this.git.recentCommits(context, repoId, limit);
    return {
      ok: true as const,
      repoId,
      commits,
      execution: selectionMetadata(selection)
    };
  }

  private select(
    capability: DirectCapabilityId,
    access: DirectCapabilityAccess,
    executorId?: string
  ): DirectExecutorSelection {
    try {
      return this.broker.resolve({
        capability,
        scope: "workspace",
        access,
        ...(executorId ? { executorId } : {})
      });
    } catch (error) {
      if (error instanceof DirectCapabilityBrokerError) {
        throw new ServiceError(error.code, error.message, {
          hint:
            "Inspect tokenpilot.direct.executors.list and choose an executor that supports the requested Workspace Direct capability.",
          details: error.details
        });
      }
      throw error;
    }
  }

  private fallbackSelection(
    capability: DirectCapabilityId,
    access: DirectCapabilityAccess
  ): DirectExecutorSelection {
    const selection = this.select(capability, access, "tokenpilot-direct");
    return { ...selection, selectionMode: "automatic" };
  }

  private canFallbackRead(
    selection: DirectExecutorSelection,
    error: unknown
  ): boolean {
    return (
      selection.selectionMode === "automatic" &&
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

  private canFallbackMutation(
    selection: DirectExecutorSelection,
    error: unknown
  ): boolean {
    return (
      selection.selectionMode === "automatic" &&
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
