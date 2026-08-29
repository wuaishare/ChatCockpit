import { z } from "zod";

import type { ChatDirectService } from "../../application/chat-direct-service.js";
import { buildDirectToolSchemas } from "../../contracts/direct-tools.js";
import {
  fileEditToolOutputSchema,
  fileWriteToolOutputSchema,
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
    fileWriteSchema,
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
      name: toolName("workspace.exec"),
      title: "Start governed workspace process",
      description:
        "Start a governed long-running command in the selected repository workspace. The default executionMode=native-sandbox uses the verified native backend, whose sandbox constrains writes and can deny network access. For the narrow allowlist of macOS build scripts that must create their own SwiftPM/Xcode child sandbox, executionMode=host-managed explicitly uses ChatCockpit's governed built-in process supervisor and requires networkAccess=true because that lane does not claim OS-level network denial. allowBuiltinFallback remains a compatibility escape hatch only when native execution is unavailable. All modes retain command/path policy, writer authority, streamed output, bounded retention, and idempotent process start.",
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
        "Send stdin to or terminate a managed workspace process. Access remains bound to the development session or OAuth authorization grant that started the process. An idempotency key is required so retries cannot duplicate stdin writes.",
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
              return {
                ...(await services.chatDirect.workspaceProcessInput(
                  context,
                  payload
                )),
                action: "input" as const
              };
            }
            return {
              ...(await services.chatDirect.workspaceProcessTerminate(
                context,
                payload
              )),
              action: "terminate" as const
            };
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
        `Run a bounded command allowed by ${identity.displayName} policy. The default timeout is 45 seconds and callers may request up to 120 seconds with timeoutMs; use workspace.exec for longer-running or streamed commands. Read-only commands require no writer authority. OAuth MCP callers receive bounded workspace writer authority automatically for mutating commands; callers using an explicit chat-direct session must own its active writer lease. Exposed-mode high-trust controls still apply.`,
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
      name: toolName("git.sync"),
      title: "Synchronize repository with configured upstream",
      description:
        "Perform one governed Git synchronization action without caller-supplied remotes, refspecs, merge targets, paths, or arbitrary Git options. fetch resolves exactly one configured HTTPS/SSH upstream URL, ignores repository remote.fetch refspecs, disables automatic tag fetching, and updates only the validated standard remote-tracking ref for the configured upstream branch; fast-forward requires a completely clean index/worktree, compares and merges only that exact tracking ref, refuses divergence, unsafe upstream paths, external checkout filters, and non-ff merges; worktree-prune removes only stale worktree metadata. Repository hooks and dangerous inherited Git process settings are disabled or neutralized. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
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
            const value = await services.chatDirect.gitSync(context, payload);
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
      title: "Push current committed HEAD to configured upstream",
      description:
        "Push only the exact current committed HEAD object to the current attached branch's configured upstream branch. The operation requires a completely clean worktree/index and complete non-shallow, non-grafted history; resolves exactly one validated upstream HTTPS/SSH URL; requires the push URL to match that fetch URL; fetches only the configured upstream branch with tags and repository remote.fetch refspecs ignored into FETCH_HEAD; refuses HEAD drift, behind or diverged history, unsafe credential helpers and push configuration, and any non-commit-safe outgoing path before pushing. All outgoing paths are audited, while at most 500 are returned together with pathCount and pathsTruncated metadata. The final push uses the immutable HEAD object id and validated refs/heads target and never accepts caller-supplied remotes, refspecs, branches, tags, delete, force, or arbitrary Git options. Hooks, signing, follow-tags, push options, custom receive-pack, mirror semantics, submodule recursion, replacement refs, unsafe TLS overrides, and dangerous inherited Git process settings are disabled or refused. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
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
