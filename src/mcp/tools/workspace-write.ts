import { z } from "zod";

import type { ChatDirectService } from "../../application/chat-direct-service.js";
import { ServiceError } from "../../application/service-error.js";
import { buildDirectToolSchemas } from "../../contracts/direct-tools.js";
import {
  fileEditToolOutputSchema,
  fileMutateToolOutputSchema,
  fileWriteToolOutputSchema,
  gitBranchToolOutputSchema,
  gitCommitToolOutputSchema,
  gitPushToolOutputSchema,
  gitStageToolOutputSchema,
  gitSyncToolOutputSchema,
  shellRunToolOutputSchema,
  workspaceExecToolOutputSchema,
  workspaceProcessControlToolOutputSchema,
  workspaceProcessReadToolOutputSchema
} from "../../contracts/mcp-core-outputs.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "../../core/product-identity.js";
import type { GitStatusResponse, ProductIdentityKey } from "../../types.js";
import type { McpIdempotencyStore } from "../idempotency-store.js";
import { productMcpToolName } from "../product-tool-identity.js";
import {
  defineMcpTool,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const readOnlyAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const reversibleMutationAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const destructiveMutationAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

const openWorldReversibleMutationAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

const openWorldDestructiveMutationAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true
};

function publicChangedPaths(status: GitStatusResponse): string[] {
  return status.entries
    .filter((entry) => entry.status !== "blocked")
    .map((entry) => entry.path)
    .sort();
}

function mutationValue<T extends Record<string, unknown>>(
  value: T,
  changedPaths: string[],
  evidenceHints: string[]
): T & {
  changedPaths: string[];
  evidenceHints: string[];
} {
  return {
    ...value,
    changedPaths,
    evidenceHints
  };
}

function withIdempotency<T extends Record<string, unknown>>(
  value: T,
  idempotencyKey: string,
  replayed: boolean
): T & {
  idempotency: {
    key: string;
    replayed: boolean;
  };
} {
  return {
    ...value,
    idempotency: {
      key: idempotencyKey,
      replayed
    }
  };
}

export interface WorkspaceWriteToolServices {
  chatDirect: ChatDirectService;
  idempotency: McpIdempotencyStore;
}

export function buildWorkspaceWriteTools(
  services: WorkspaceWriteToolServices,
  productIdentity: ProductIdentityKey = DEFAULT_PRODUCT_IDENTITY.key
): TokenPilotMcpTool[] {
  const identity = productIdentityForKey(productIdentity);
  const {
    fileEditSchema,
    fileMutateSchema,
    fileWriteSchema,
    gitBranchSchema,
    gitCommitSchema,
    gitPushSchema,
    gitStageSchema,
    gitSyncSchema,
    shellRunSchema,
    workspaceExecSchema,
    workspaceProcessControlSchema,
    workspaceProcessReadSchema
  } = buildDirectToolSchemas(identity.defaultRepoId);
  const fileWriteMcpSchema = fileWriteSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const fileEditMcpSchema = fileEditSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const fileMutateMcpSchema = fileMutateSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const shellRunMcpSchema = shellRunSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const workspaceExecMcpSchema = workspaceExecSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const workspaceProcessControlMcpSchema = workspaceProcessControlSchema.and(
    z.object({ idempotencyKey: idempotencyKeySchema })
  );
  const gitStageMcpSchema = gitStageSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const gitBranchMcpSchema = gitBranchSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const gitSyncMcpSchema = gitSyncSchema.and(
    z.object({ idempotencyKey: idempotencyKeySchema })
  );
  const gitPushMcpSchema = gitPushSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const gitCommitMcpSchema = gitCommitSchema.extend({
    idempotencyKey: idempotencyKeySchema
  });
  const toolName = (suffix: string) => productMcpToolName(suffix, productIdentity);
  const gitEvidenceHints = [toolName("git.status"), toolName("git.diff")];

  return [
    defineMcpTool({
      name: toolName("files.write"),
      title: "Write repository file",
      description:
        "Create or overwrite a public-safe text file. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
      inputSchema: fileWriteMcpSchema,
      outputSchema: fileWriteToolOutputSchema,
      annotations: destructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("files.write"),
          idempotencyKey,
          payload,
          async () =>
            mutationValue(
              (await services.chatDirect.write(
                context,
                payload
              )) as unknown as Record<string, unknown>,
              [payload.path],
              gitEvidenceHints
            )
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("files.edit"),
      title: "Edit repository file",
      description:
        "Apply one unique search-and-replace edit. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
      inputSchema: fileEditMcpSchema,
      outputSchema: fileEditToolOutputSchema,
      annotations: reversibleMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("files.edit"),
          idempotencyKey,
          payload,
          async () =>
            mutationValue(
              (await services.chatDirect.edit(
                context,
                payload
              )) as unknown as Record<string, unknown>,
              [payload.path],
              gitEvidenceHints
            )
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("files.mutate"),
      title: "Mutate repository file",
      description:
        "Delete or move/rename one public-safe text-like repository file without opening a general shell. Directory mutations, symbolic links, protected paths, destination overwrite, and paths outside the mapped repository are refused. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
      inputSchema: fileMutateMcpSchema,
      outputSchema: fileMutateToolOutputSchema,
      annotations: destructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("files.mutate"),
          idempotencyKey,
          payload,
          async () => {
            const value = await services.chatDirect.mutate(context, payload);
            return mutationValue(
              value as unknown as Record<string, unknown>,
              value.execution.changedPaths,
              gitEvidenceHints
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("workspace.exec"),
      title: "Start governed workspace process",
      description:
        "Primary Coding Runtime execution primitive for normal project development. In the default Workspace Development profile, use this tool for general CLIs, shells, interpreters, Git commands, tests, builds and long-running processes; unknown commands are governed as writes instead of being rejected by a source allowlist. The default executionMode=native-sandbox constrains Workspace writes and can deny network access; networkAccess remains false unless explicitly requested. The Restricted Workspace profile preserves the conservative command surface for untrusted projects. Host/device administration is a separate permission domain. executionMode=host-managed remains only for explicitly governed compatibility workloads that cannot run in the native sandbox. All modes retain writer authority, path/symlink preflight, public-safe output projection, streamed process control, bounded retention and idempotency.",
      inputSchema: workspaceExecMcpSchema,
      outputSchema: workspaceExecToolOutputSchema,
      annotations: openWorldDestructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("workspace.exec"),
          idempotencyKey,
          payload,
          async () =>
            (await services.chatDirect.workspaceExec(
              context,
              payload
            )) as unknown as Record<string, unknown>
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("workspace.process.read"),
      title: "Read workspace process",
      description:
        "Read bounded streamed output and terminal state for a managed workspace process. Use the returned nextCursor to continue reading without replaying prior chunks.",
      inputSchema: workspaceProcessReadSchema,
      outputSchema: workspaceProcessReadToolOutputSchema,
      annotations: readOnlyAnnotations,
      handler: async (context, input) =>
        services.chatDirect.workspaceProcessRead(context, input)
    }),
    defineMcpTool({
      name: toolName("workspace.process.control"),
      title: "Control workspace process",
      description:
        "Control a managed workspace process through a forward-compatible action envelope. Current actions are input, resize and terminate; future actions may use params without changing the frozen public JSON Schema. Access remains bound to the development session or OAuth authorization grant that started the process. Resize is available only for native Codex App Server PTY sessions. Unsupported actions are rejected server-side, and an idempotency key is required so retries cannot duplicate control actions.",
      inputSchema: workspaceProcessControlMcpSchema,
      outputSchema: workspaceProcessControlToolOutputSchema,
      annotations: openWorldDestructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("workspace.process.control"),
          idempotencyKey,
          payload,
          async () => {
            if (payload.action === "input") {
              if (payload.input === undefined) {
                throw new ServiceError(
                  "WORKSPACE_PROCESS_CONTROL_INPUT_INVALID",
                  "Workspace process input control requires an input string"
                );
              }
              return {
                ...(await services.chatDirect.workspaceProcessInput(context, {
                  repoId: payload.repoId,
                  ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
                  processId: payload.processId,
                  input: payload.input,
                  ...(payload.closeStdin !== undefined
                    ? { closeStdin: payload.closeStdin }
                    : {})
                })),
                action: "input" as const
              };
            }
            if (payload.action === "resize") {
              if (payload.rows === undefined || payload.cols === undefined) {
                throw new ServiceError(
                  "WORKSPACE_PROCESS_CONTROL_INPUT_INVALID",
                  "Workspace process resize control requires rows and cols"
                );
              }
              return {
                ...(await services.chatDirect.workspaceProcessResize(context, {
                  repoId: payload.repoId,
                  ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
                  processId: payload.processId,
                  rows: payload.rows,
                  cols: payload.cols
                })),
                action: "resize" as const
              };
            }
            if (payload.action === "terminate") {
              return {
                ...(await services.chatDirect.workspaceProcessTerminate(context, {
                  repoId: payload.repoId,
                  ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
                  processId: payload.processId
                })),
                action: "terminate" as const
              };
            }
            throw new ServiceError(
              "WORKSPACE_PROCESS_CONTROL_ACTION_UNSUPPORTED",
              `Unsupported workspace process control action: ${payload.action}`,
              {
                hint: "Use chatcockpit.tools.discover to inspect the latest Core tool schema and supported controls.",
                details: {
                  action: payload.action,
                  supportedActions: ["input", "resize", "terminate"]
                }
              }
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("shell.run"),
      title: "Run controlled repository command",
      description:
        `Compatibility quick-command surface with a deliberately conservative allowlist. Prefer workspace.exec for normal development commands, arbitrary CLIs, shells, interpreters, Git mutations, tests, builds, networked operations, or anything that may run longer than a short bounded call. The default timeout is 45 seconds and callers may request up to 120 seconds. Read-only commands require no writer authority; mutating compatibility commands remain governed by workspace writer authority and exposed-mode controls.`,
      inputSchema: shellRunMcpSchema,
      outputSchema: shellRunToolOutputSchema,
      annotations: destructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("shell.run"),
          idempotencyKey,
          payload,
          async () => {
            const value = await services.chatDirect.shell(context, payload);
            const status = await services.chatDirect.gitStatus(
              context,
              payload.repoId
            );
            return mutationValue(
              value as unknown as Record<string, unknown>,
              publicChangedPaths(status),
              gitEvidenceHints
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("git.stage"),
      title: "Stage explicit public-safe repository paths",
      description:
        "Stage only explicitly named, currently changed, public-safe repository paths using literal Git pathspec semantics. Directory-wide adds, glob/pathspec expansion, parent traversal, absolute paths, blocked local state, secrets, and unsupported binary artifacts are refused. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
      inputSchema: gitStageMcpSchema,
      outputSchema: gitStageToolOutputSchema,
      annotations: reversibleMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("git.stage"),
          idempotencyKey,
          payload,
          async () => {
            const value = await services.chatDirect.gitStage(context, payload);
            return mutationValue(
              value as unknown as Record<string, unknown>,
              value.execution.changedPaths,
              [toolName("git.status"), `${toolName("git.diff")}?staged=true`]
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("git.branch"),
      title: "Create, switch, or delete a governed local branch",
      description:
        "Perform one governed local branch lifecycle action. create starts a new local branch at the exact current HEAD and switches to it; switch accepts only an existing local branch and validates all checkout paths and filter attributes before changing the worktree; delete refuses the current branch and uses merge-safe git branch -d only, never force deletion. All mutations require a clean worktree/index, an attached current branch, optional expected-current-branch drift protection, workspace writer authority, and an idempotency key. Remote branch DWIM, arbitrary revisions, caller-supplied Git options and shell execution are not exposed.",
      inputSchema: gitBranchMcpSchema,
      outputSchema: gitBranchToolOutputSchema,
      annotations: destructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("git.branch"),
          idempotencyKey,
          payload,
          async () => {
            const value = await services.chatDirect.gitBranch(context, payload);
            return mutationValue(
              value as unknown as Record<string, unknown>,
              value.execution.changedPaths,
              gitEvidenceHints
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("git.sync"),
      title: "Synchronize repository with configured upstream",
      description:
        "Perform one governed Git synchronization action through a forward-compatible action envelope. Current actions are fetch, fast-forward and worktree-prune; unsupported future action names are rejected server-side. Callers cannot supply remotes, refspecs, merge targets, paths, or arbitrary Git options. fetch resolves exactly one configured HTTPS/SSH upstream URL, ignores repository remote.fetch refspecs, disables automatic tag fetching, and updates only the validated standard remote-tracking ref for the configured upstream branch; fast-forward requires a completely clean index/worktree and refuses divergence; worktree-prune removes only stale worktree metadata. Repository hooks and dangerous inherited Git process settings are disabled or neutralized. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
      inputSchema: gitSyncMcpSchema,
      outputSchema: gitSyncToolOutputSchema,
      annotations: openWorldReversibleMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("git.sync"),
          idempotencyKey,
          payload,
          async () => {
            if (!["fetch", "fast-forward", "worktree-prune"].includes(payload.action)) {
              throw new ServiceError(
                "GIT_SYNC_ACTION_UNSUPPORTED",
                `Unsupported governed Git synchronization action: ${payload.action}`,
                {
                  hint: "Use chatcockpit.tools.discover to inspect the latest Core Git synchronization schema.",
                  details: {
                    action: payload.action,
                    supportedActions: ["fetch", "fast-forward", "worktree-prune"]
                  }
                }
              );
            }
            const value = await services.chatDirect.gitSync(context, {
              ...(payload.executorId ? { executorId: payload.executorId } : {}),
              repoId: payload.repoId,
              ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
              action: payload.action as "fetch" | "fast-forward" | "worktree-prune",
              ...(payload.prune !== undefined ? { prune: payload.prune } : {})
            });
            return mutationValue(
              value as unknown as Record<string, unknown>,
              value.execution.changedPaths,
              gitEvidenceHints
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("git.push"),
      title: "Push or first-publish current committed HEAD",
      description:
        "Push only the exact current committed HEAD object through governed Git. By default the current attached branch must already have one configured upstream. With publishCurrentBranch=true, the branch must have no upstream: ChatCockpit requires exactly one safe configured remote, resolves its symbolic default branch without assuming a branch name, requires that default history to be an ancestor of the immutable current HEAD, audits every outgoing path, and publishes only to the same-name refs/heads target. A server-generated empty force-with-lease precondition is used only to atomically require a missing remote branch; callers still cannot supply remotes, refspecs, branches, force, delete, tags, or arbitrary Git options. If the same-name remote already points to the exact audited HEAD, first-publish mode may recover by establishing the standard tracking upstream without rewriting the remote. All modes require a completely clean worktree/index and complete non-shallow, non-grafted history; validate HTTPS/SSH fetch and push URLs, credential helpers and push configuration; refuse HEAD drift and unsafe paths; disable hooks, signing, follow-tags, push options, custom receive-pack, mirror semantics, submodule recursion, replacement refs, unsafe TLS overrides, and dangerous inherited Git process settings. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
      inputSchema: gitPushMcpSchema,
      outputSchema: gitPushToolOutputSchema,
      annotations: openWorldReversibleMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("git.push"),
          idempotencyKey,
          payload,
          async () => {
            const value = await services.chatDirect.gitPush(context, payload);
            return mutationValue(
              value as unknown as Record<string, unknown>,
              value.execution.changedPaths,
              gitEvidenceHints
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    }),
    defineMcpTool({
      name: toolName("git.commit"),
      title: "Commit staged public-safe repository changes",
      description:
        "Commit only changes that were already staged and are public-safe. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
      inputSchema: gitCommitMcpSchema,
      outputSchema: gitCommitToolOutputSchema,
      annotations: reversibleMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          toolName("git.commit"),
          idempotencyKey,
          payload,
          async () => {
            const value = await services.chatDirect.gitCommit(
              context,
              payload
            );
            return mutationValue(
              value as unknown as Record<string, unknown>,
              value.execution.changedPaths,
              gitEvidenceHints
            );
          }
        );
        return withIdempotency(
          execution.value,
          idempotencyKey,
          execution.replayed
        );
      }
    })
  ];
}
