import { z } from "zod";

import type { ChatDirectService } from "../../application/chat-direct-service.js";
import { buildDirectToolSchemas } from "../../contracts/direct-tools.js";
import {
  fileEditToolOutputSchema,
  fileWriteToolOutputSchema,
  gitCommitToolOutputSchema,
  shellRunToolOutputSchema
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
    shellRunSchema
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
      name: toolName("shell.run"),
      title: "Run controlled repository command",
      description:
        `Run a command allowed by ${identity.displayName} policy. Read-only commands require no writer authority. OAuth MCP callers receive bounded workspace writer authority automatically for mutating commands; callers using an explicit chat-direct session must own its active writer lease. Exposed-mode high-trust controls still apply.`,
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
      name: toolName("git.commit"),
      title: "Commit public-safe repository changes",
      description:
        "Stage and commit only public-safe changes. OAuth MCP callers receive bounded workspace writer authority automatically; callers using an explicit chat-direct session must own its active writer lease. An idempotency key is always required.",
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
            const before = await services.chatDirect.gitStatus(
              context,
              payload.repoId
            );
            const value = await services.chatDirect.gitCommit(
              context,
              payload
            );
            return mutationValue(
              value as unknown as Record<string, unknown>,
              publicChangedPaths(before),
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
