import { randomUUID } from "node:crypto";
import fs from "node:fs";

import { BuiltinManagedProcessSupervisor } from "../core/builtin-managed-process.js";
import {
  buildTextPreviewFromBuffer,
  resolveReadableRepoFileTarget
} from "../core/files-api.js";
import {
  assertWriteContentAllowed,
  listRepoDirectory,
  resolveListableRepoPathTarget,
  resolveWritableRepoPathTarget
} from "../core/files-write.js";
import {
  prepareShellCommand,
  prepareWorkspaceExecCommand,
  publicSafeShellOutput
} from "../core/shell-api.js";
import { productIdentityForKey } from "../core/product-identity.js";
import { loadDownstreamMcpExecutorsConfig } from "../direct/downstream-mcp-config.js";
import type {
  FileEditPayload,
  FileListPayload,
  FileReadBatchPayload,
  FileReadPayload,
  FileWritePayload,
  GitCommitPayload,
  GitStagePayload,
  GitSyncPayload,
  SearchPayload,
  ShellRunPayload,
  TokenPilotPaths,
  WorkspaceExecPayload,
  WorkspaceProcessInputPayload,
  WorkspaceProcessReadPayload,
  WorkspaceProcessTerminatePayload
} from "../types.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { CoreWriterAuthorityRecord } from "../continuity/repositories/core-writer-authority-repository.js";
import type { WriterLeaseRecord } from "../continuity/types.js";
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
  compatibilityMode?: string;
}

type WithExecution<T> = T & { execution: ChatDirectExecutionMetadata };

function metadata(
  executor: ChatDirectExecutor,
  selectionMode: "automatic" | "explicit",
  changedPaths: string[] = [],
  fallbackReason?: string,
  compatibilityMode?: string
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
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(compatibilityMode ? { compatibilityMode } : {})
  };
}

function selectionMetadata(
  selection: DirectExecutorSelection,
  changedPaths: string[] = [],
  fallbackReason?: string,
  compatibilityMode?: string
): ChatDirectExecutionMetadata {
  return metadata(
    selection.executorId,
    selection.selectionMode,
    changedPaths,
    fallbackReason,
    compatibilityMode
  );
}

const CORE_WRITER_AUTHORITY_TTL_MS = 120_000;
const MANAGED_PROCESS_WRITER_AUTHORITY_TTL_MS = 10 * 60_000;
const MANAGED_PROCESS_LEASE_GUARD_INTERVAL_MS = 1_000;
const MANAGED_PROCESS_RECORD_RETENTION_MS = 30 * 60_000;

interface ManagedChatDirectProcess {
  repoId: string;
  repoRoot: string;
  processId: string;
  backend: "codex-standalone" | "builtin-direct";
  sessionId: string | null;
  actorType: OperationContext["actorType"];
  actorId: string | null;
  authorizationGrantId: string | null;
  authority: CoreWriterAuthorityRecord | null;
  continuityLease: WriterLeaseRecord | null;
  selection: DirectExecutorSelection;
  access: DirectCapabilityAccess;
  compatibilityMode: string | null;
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
  private readonly managedProcesses = new Map<string, ManagedChatDirectProcess>();
  private readonly builtinManagedProcesses = new BuiltinManagedProcessSupervisor();

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly runtime: RuntimeRouter,
    private readonly broker: DirectCapabilityBroker,
    private readonly repositories: ContinuityRepositories,
    private readonly directExecutorsConfigPath?: string
  ) {
    this.files = new FilesService(paths);
    this.git = new GitService(paths);
    this.searchService = new SearchService(paths);
    this.shellService = new ShellService(paths);
  }

  private acquireMutationAuthority(
    context: OperationContext,
    repoId: string,
    sessionId?: string,
    ttlMs = CORE_WRITER_AUTHORITY_TTL_MS
  ): CoreWriterAuthorityRecord | null {
    if (sessionId) {
      assertChatDirectWriterLease(
        this.repositories,
        context,
        repoId,
        sessionId
      );
      return null;
    }

    if (context.actorType !== "remote-mcp" || !context.authorizationGrantId) {
      throw new ServiceError(
        "WRITER_LEASE_REQUIRED",
        "A mutating Chat Direct operation requires either a development session or an authorized remote MCP caller",
        {
          hint:
            "Use an OAuth-authorized remote MCP connection, or supply a development session that owns the workspace writer lease.",
          details: { repoId, actorType: context.actorType }
        }
      );
    }

    const workspace = this.repositories.workspaces.findPrivateByRepoId(repoId);
    if (!workspace) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        `No ChatCockpit workspace is mapped to repository ${repoId}`,
        { details: { repoId } }
      );
    }
    if (workspace.status !== "ready") {
      throw new ServiceError(
        "WORKSPACE_NOT_READY",
        "Core remote development mutation requires a ready ChatCockpit workspace",
        { details: { repoId, workspaceId: workspace.id, workspaceStatus: workspace.status } }
      );
    }

    return this.repositories.coreWriterAuthorities.acquire({
      workspaceId: workspace.id,
      holderRequestId: context.requestId,
      actorType: context.actorType,
      actorId: context.actorId,
      authorizationGrantId: context.authorizationGrantId,
      expiresAt: new Date(
        Date.parse(context.now) + ttlMs
      ).toISOString(),
      now: context.now
    });
  }

  private releaseMutationAuthority(
    context: OperationContext,
    authority: CoreWriterAuthorityRecord | null
  ): void {
    if (!authority) return;
    try {
      this.repositories.coreWriterAuthorities.release(authority.id, {
        holderRequestId: context.requestId,
        expectedRevision: authority.revision,
        now: context.now
      });
    } catch {
      // The mutation result is already authoritative. A failed release must not
      // encourage a caller retry that could duplicate the write; the bounded
      // authority remains fail-safe and will expire automatically.
    }
  }

  private getManagedProcess(
    context: OperationContext,
    repoId: string,
    processId: string,
    sessionId?: string
  ): ManagedChatDirectProcess {
    const record = this.managedProcesses.get(processId);
    if (!record || record.repoId !== repoId) {
      throw new ServiceError(
        "WORKSPACE_PROCESS_NOT_FOUND",
        "Managed workspace process is unavailable"
      );
    }
    if (record.sessionId) {
      if (sessionId !== record.sessionId) {
        throw new ServiceError(
          "WORKSPACE_PROCESS_ACCESS_DENIED",
          "Managed workspace process belongs to another development session"
        );
      }
    } else if (record.authorizationGrantId) {
      if (context.authorizationGrantId !== record.authorizationGrantId) {
        throw new ServiceError(
          "WORKSPACE_PROCESS_ACCESS_DENIED",
          "Managed workspace process belongs to another authorization grant"
        );
      }
    } else if (
      context.authorizationGrantId ||
      context.actorType !== record.actorType ||
      context.actorId !== record.actorId
    ) {
      throw new ServiceError(
        "WORKSPACE_PROCESS_ACCESS_DENIED",
        "Managed workspace process belongs to another caller principal"
      );
    }
    return record;
  }

  private renewManagedProcessAuthority(
    context: OperationContext,
    record: ManagedChatDirectProcess
  ): void {
    if (!record.authority) return;
    record.authority = this.repositories.coreWriterAuthorities.renew(
      record.authority.id,
      {
        holderRequestId: record.authority.holderRequestId,
        expectedRevision: record.authority.revision,
        expiresAt: new Date(
          Date.parse(context.now) + MANAGED_PROCESS_WRITER_AUTHORITY_TTL_MS
        ).toISOString(),
        now: context.now
      }
    );
  }

  private releaseManagedProcessAuthority(
    record: ManagedChatDirectProcess,
    now = new Date().toISOString()
  ): void {
    const authority = record.authority;
    if (!authority) return;
    try {
      this.repositories.coreWriterAuthorities.release(authority.id, {
        holderRequestId: authority.holderRequestId,
        expectedRevision: authority.revision,
        now
      });
    } catch {
      // Fail-safe: the bounded authority will expire even if release races with expiry.
    } finally {
      record.authority = null;
    }
  }

  private readManagedProcess(
    record: ManagedChatDirectProcess,
    cursor = 0,
    limit = 100
  ) {
    return record.backend === "builtin-direct"
      ? Promise.resolve(this.builtinManagedProcesses.read(record.processId, cursor, limit))
      : this.runtime.readStandaloneProcess(record.processId, cursor, limit);
  }

  private waitManagedProcess(record: ManagedChatDirectProcess) {
    return record.backend === "builtin-direct"
      ? this.builtinManagedProcesses.wait(record.processId)
      : this.runtime.waitStandaloneProcess(record.processId);
  }

  private inputManagedProcess(
    record: ManagedChatDirectProcess,
    input: string,
    closeStdin = false
  ) {
    return record.backend === "builtin-direct"
      ? this.builtinManagedProcesses.write(record.processId, input, closeStdin)
      : this.runtime.writeStandaloneProcess(record.processId, input, closeStdin);
  }

  private terminateManagedProcess(record: ManagedChatDirectProcess) {
    return record.backend === "builtin-direct"
      ? this.builtinManagedProcesses.terminate(record.processId)
      : this.runtime.terminateStandaloneProcess(record.processId);
  }

  private superviseManagedProcess(record: ManagedChatDirectProcess): void {
    const heartbeat = record.authority
      ? setInterval(() => {
          const authority = record.authority;
          if (!authority) return;
          const now = new Date().toISOString();
          try {
            record.authority = this.repositories.coreWriterAuthorities.renew(
              authority.id,
              {
                holderRequestId: authority.holderRequestId,
                expectedRevision: authority.revision,
                expiresAt: new Date(
                  Date.parse(now) + MANAGED_PROCESS_WRITER_AUTHORITY_TTL_MS
                ).toISOString(),
                now
              }
            );
          } catch {
            void this.terminateManagedProcess(record).catch(() => undefined);
          }
        }, 60_000)
      : null;
    heartbeat?.unref?.();

    const leaseGuard = record.continuityLease
      ? setInterval(() => {
          const lease = record.continuityLease;
          if (!lease) return;
          const now = new Date().toISOString();
          try {
            this.repositories.leases.reconcileExpired(now);
            const active = this.repositories.leases.getActive(lease.workspaceId);
            if (
              !active ||
              active.id !== lease.id ||
              active.sessionId !== lease.sessionId ||
              active.holderType !== "chat-direct"
            ) {
              throw new Error("Managed process lost its Continuity writer lease");
            }
            record.continuityLease = active;
          } catch {
            record.continuityLease = null;
            void this.terminateManagedProcess(record).catch(() => undefined);
          }
        }, MANAGED_PROCESS_LEASE_GUARD_INTERVAL_MS)
      : null;
    leaseGuard?.unref?.();

    void this.waitManagedProcess(record)
      .catch(() => undefined)
      .finally(() => {
        if (heartbeat) clearInterval(heartbeat);
        if (leaseGuard) clearInterval(leaseGuard);
        this.releaseManagedProcessAuthority(record);
        const cleanup = setTimeout(() => {
          this.managedProcesses.delete(record.processId);
        }, MANAGED_PROCESS_RECORD_RETENTION_MS);
        cleanup.unref?.();
      });
  }

  listExecutors() {
    return {
      ok: true as const,
      modelLoopOwner: "chatgpt" as const,
      hostDirectExposed: true as const,
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
        const target = resolveListableRepoPathTarget(
          this.paths,
          payload.repoId,
          payload.path
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
    const authority = this.acquireMutationAuthority(
      context,
      payload.repoId,
      payload.sessionId
    );
    try {
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
    } finally {
      this.releaseMutationAuthority(context, authority);
    }
  }

  async edit(context: OperationContext, payload: FileEditPayload) {
    const authority = this.acquireMutationAuthority(
      context,
      payload.repoId,
      payload.sessionId
    );
    try {
      const selection = this.select("files.edit", "write", payload.executorId);
      const value = this.files.edit(context, payload);
      return {
        ...value,
        execution: selectionMetadata(selection, [payload.path])
      };
    } finally {
      this.releaseMutationAuthority(context, authority);
    }
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
    const authority =
      access === "write"
        ? this.acquireMutationAuthority(context, payload.repoId, payload.sessionId)
        : null;
    try {
      const selection =
        !payload.executorId && (prepared.gitMetadataWrite || prepared.hostRuntimeAccess)
          ? this.fallbackSelection("shell.exec", access)
          : this.select("shell.exec", access, payload.executorId);
      if (selection.executorId === "codex-app-server-standalone") {
        const startedAt = Date.now();
        try {
          const result = await this.runtime.executeStandaloneCommand({
            command: [prepared.command, ...prepared.args],
            cwd: prepared.workdir,
            timeoutMs: prepared.timeoutMs,
            outputBytesCap: prepared.outputBytesCap,
            readOnly: access === "read"
          });
          const elapsed = Date.now() - startedAt;
          return {
            ok: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout:
              publicSafeShellOutput(result.stdout, prepared.repoRoot) ||
              (result.exitCode === 0 ? "(no output)" : ""),
            stderr: publicSafeShellOutput(result.stderr, prepared.repoRoot),
            truncated: false,
            executedCommand: `${prepared.command} ${prepared.args.join(" ")} (${elapsed}ms)`,
            execution: selectionMetadata(
              selection,
              [],
              undefined,
              result.compatibilityMode
            )
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
            ? `command-policy-kept-${
                productIdentityForKey(this.paths.productIdentity).builtInDirectExecutorId
              }`
            : undefined
        )
      };
    } finally {
      this.releaseMutationAuthority(context, authority);
    }
  }

  async workspaceExec(
    context: OperationContext,
    payload: WorkspaceExecPayload
  ) {
    let prepared: ReturnType<typeof prepareWorkspaceExecCommand>;
    try {
      const hostPermissionProfile = loadDownstreamMcpExecutorsConfig(
        this.directExecutorsConfigPath
      ).hostPermissionProfile;
      prepared = prepareWorkspaceExecCommand(
        this.paths,
        payload,
        hostPermissionProfile
      );
    } catch (error) {
      throw serviceError("SHELL_COMMAND_BLOCKED", error);
    }
    const access: DirectCapabilityAccess = prepared.readOnly ? "read" : "write";
    const builtInExecutorId = productIdentityForKey(
      this.paths.productIdentity
    ).builtInDirectExecutorId;
    const hostManaged = prepared.executionMode === "host-managed";
    if (
      hostManaged &&
      payload.executorId &&
      payload.executorId !== builtInExecutorId
    ) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Host-managed workspace execution must use the governed built-in process supervisor",
        { details: { executorId: payload.executorId, requiredExecutorId: builtInExecutorId } }
      );
    }
    const selection = hostManaged
      ? this.fallbackSelection("shell.exec", access)
      : this.select("shell.exec", access, payload.executorId);
    const nativeBackend =
      !hostManaged && selection.executorId === "codex-app-server-standalone";
    const builtInBackend = hostManaged || selection.executorId === builtInExecutorId;
    if (!nativeBackend && !builtInBackend) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        `Managed workspace execution does not support executor ${selection.executorId}`
      );
    }
    if (
      !hostManaged &&
      builtInBackend &&
      payload.allowBuiltinFallback !== true
    ) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Managed workspace native execution is unavailable. Set allowBuiltinFallback=true only when this authenticated operator explicitly accepts the governed built-in process fallback.",
        {
          details: {
            executorId: selection.executorId,
            nativeExecutorId: "codex-app-server-standalone"
          }
        }
      );
    }
    if (builtInBackend && payload.networkAccess !== true) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        hostManaged
          ? "Host-managed workspace execution cannot prove OS-level network denial. Set networkAccess=true only for an explicitly allowlisted trusted build task."
          : "The built-in managed process fallback cannot prove OS-level network denial. Restore the native executor for network-isolated execution, or explicitly allow network access for this trusted task.",
        {
          details: {
            executorId: selection.executorId,
            executionMode: prepared.executionMode,
            networkAccess: false
          }
        }
      );
    }
    let continuityLease: WriterLeaseRecord | null = null;
    const authority =
      access === "write" && !payload.sessionId
        ? this.acquireMutationAuthority(
            context,
            payload.repoId,
            undefined,
            MANAGED_PROCESS_WRITER_AUTHORITY_TTL_MS
          )
        : null;
    if (access === "write" && payload.sessionId) {
      continuityLease = assertChatDirectWriterLease(
        this.repositories,
        context,
        payload.repoId,
        payload.sessionId
      ).lease;
    }
    try {
      const started = nativeBackend
        ? await this.runtime.startStandaloneProcess({
            command: [prepared.command, ...prepared.args],
            cwd: prepared.workdir,
            readOnly: access === "read",
            allowStdin: payload.allowStdin === true,
            networkAccess: payload.networkAccess === true
          })
        : this.builtinManagedProcesses.start({
            command: prepared.command,
            args: prepared.args,
            cwd: prepared.workdir,
            allowStdin: payload.allowStdin === true
          });
      const backend: ManagedChatDirectProcess["backend"] = nativeBackend
        ? "codex-standalone"
        : "builtin-direct";
      const record: ManagedChatDirectProcess = {
        repoId: payload.repoId,
        repoRoot: prepared.repoRoot,
        processId: started.processId,
        backend,
        sessionId: payload.sessionId ?? null,
        actorType: context.actorType,
        actorId: context.actorId,
        authorizationGrantId: context.authorizationGrantId ?? null,
        authority,
        continuityLease,
        selection,
        access,
        compatibilityMode: started.compatibilityMode ?? null
      };
      this.managedProcesses.set(started.processId, record);
      this.superviseManagedProcess(record);
      return {
        ok: true as const,
        repoId: payload.repoId,
        processId: started.processId,
        state: started.state,
        execution: selectionMetadata(
          selection,
          [],
          builtInBackend
            ? hostManaged
              ? "explicit-host-managed-execution"
              : selection.selectionMode === "automatic"
                ? "native-managed-executor-unavailable"
                : "explicit-builtin-managed-executor"
            : undefined,
          started.compatibilityMode
        )
      };
    } catch (error) {
      this.releaseMutationAuthority(context, authority);
      throw serviceError("WORKSPACE_EXEC_BLOCKED", error);
    }
  }

  async workspaceProcessRead(
    context: OperationContext,
    payload: WorkspaceProcessReadPayload
  ) {
    const record = this.getManagedProcess(
      context,
      payload.repoId,
      payload.processId,
      payload.sessionId
    );
    const snapshot = await this.readManagedProcess(
      record,
      payload.cursor ?? 0,
      payload.limit ?? 100
    );
    const publicSnapshot = {
      ...snapshot,
      chunks: snapshot.chunks.map((chunk) => ({
        ...chunk,
        content: publicSafeShellOutput(chunk.content, record.repoRoot)
      }))
    };
    return {
      ok: true as const,
      repoId: payload.repoId,
      ...publicSnapshot,
      execution: selectionMetadata(
        record.selection,
        [],
        undefined,
        record.compatibilityMode ?? undefined
      )
    };
  }

  async workspaceProcessInput(
    context: OperationContext,
    payload: WorkspaceProcessInputPayload
  ) {
    const record = this.getManagedProcess(
      context,
      payload.repoId,
      payload.processId,
      payload.sessionId
    );
    if (record.access === "write" && record.sessionId) {
      assertChatDirectWriterLease(
        this.repositories,
        context,
        payload.repoId,
        record.sessionId
      );
    }
    await this.inputManagedProcess(
      record,
      payload.input,
      payload.closeStdin === true
    );
    return {
      ok: true as const,
      repoId: payload.repoId,
      processId: payload.processId,
      accepted: true as const,
      execution: selectionMetadata(
        record.selection,
        [],
        undefined,
        record.compatibilityMode ?? undefined
      )
    };
  }

  async workspaceProcessTerminate(
    context: OperationContext,
    payload: WorkspaceProcessTerminatePayload
  ) {
    const record = this.getManagedProcess(
      context,
      payload.repoId,
      payload.processId,
      payload.sessionId
    );
    await this.terminateManagedProcess(record);
    return {
      ok: true as const,
      repoId: payload.repoId,
      processId: payload.processId,
      terminationRequested: true as const,
      execution: selectionMetadata(
        record.selection,
        [],
        undefined,
        record.compatibilityMode ?? undefined
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

  async gitStage(context: OperationContext, payload: GitStagePayload) {
    const authority = this.acquireMutationAuthority(
      context,
      payload.repoId,
      payload.sessionId
    );
    try {
      const selection = this.select("git.stage", "write", payload.executorId);
      const value = this.git.stage(context, payload);
      return {
        ...value,
        execution: selectionMetadata(selection, value.paths)
      };
    } finally {
      this.releaseMutationAuthority(context, authority);
    }
  }

  async gitSync(context: OperationContext, payload: GitSyncPayload) {
    const authority = this.acquireMutationAuthority(
      context,
      payload.repoId,
      payload.sessionId
    );
    try {
      const selection = this.select("git.sync", "write", payload.executorId);
      const value = this.git.sync(context, payload);
      return {
        ...value,
        execution: selectionMetadata(selection, value.paths)
      };
    } finally {
      this.releaseMutationAuthority(context, authority);
    }
  }

  async gitCommit(context: OperationContext, payload: GitCommitPayload) {
    const authority = this.acquireMutationAuthority(
      context,
      payload.repoId,
      payload.sessionId
    );
    try {
      const selection = this.select("git.commit", "write", payload.executorId);
      const stagedPaths = this.git.stagedPaths(context, payload.repoId);
      const value = this.git.commit(context, payload);
      return {
        ...value,
        execution: selectionMetadata(selection, stagedPaths)
      };
    } finally {
      this.releaseMutationAuthority(context, authority);
    }
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
            `Inspect ${productIdentityForKey(this.paths.productIdentity).mcpNamespace}.direct.executors.list and choose an executor that supports the requested Workspace Direct capability.`,
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
    const selection = this.select(
      capability,
      access,
      productIdentityForKey(this.paths.productIdentity).builtInDirectExecutorId
    );
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
