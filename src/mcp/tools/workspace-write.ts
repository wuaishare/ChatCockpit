import { z } from "zod";

import type { ChatDirectService } from "../../application/chat-direct-service.js";
import {
  fileEditSchema,
  fileWriteSchema,
  gitCommitSchema,
  shellRunSchema
} from "../../contracts/direct-tools.js";
import type { GitStatusResponse } from "../../types.js";
import type { McpIdempotencyStore } from "../idempotency-store.js";
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
  services: WorkspaceWriteToolServices
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.files.write",
      title: "Write repository file",
      description:
        "Create or overwrite a public-safe text file. Requires a chat-direct session that owns the active workspace writer lease plus an idempotency key.",
      inputSchema: fileWriteMcpSchema,
      annotations: destructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          "tokenpilot.files.write",
          idempotencyKey,
          payload,
          async () =>
            mutationValue(
              (await services.chatDirect.write(
                context,
                payload
              )) as unknown as Record<string, unknown>,
              [payload.path],
              ["tokenpilot.git.status", "tokenpilot.git.diff"]
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
      name: "tokenpilot.files.edit",
      title: "Edit repository file",
      description:
        "Apply one unique search-and-replace edit. Requires a chat-direct session that owns the active workspace writer lease plus an idempotency key.",
      inputSchema: fileEditMcpSchema,
      annotations: reversibleMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          "tokenpilot.files.edit",
          idempotencyKey,
          payload,
          async () =>
            mutationValue(
              (await services.chatDirect.edit(
                context,
                payload
              )) as unknown as Record<string, unknown>,
              [payload.path],
              ["tokenpilot.git.status", "tokenpilot.git.diff"]
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
      name: "tokenpilot.shell.run",
      title: "Run controlled repository command",
      description:
        "Run a command allowed by TokenPilot policy. Read-only commands may omit sessionId; potentially mutating commands require a chat-direct session that owns the active writer lease. Exposed-mode high-trust controls still apply.",
      inputSchema: shellRunMcpSchema,
      annotations: destructiveMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          "tokenpilot.shell.run",
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
              ["tokenpilot.git.status", "tokenpilot.git.diff"]
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
      name: "tokenpilot.git.commit",
      title: "Commit public-safe repository changes",
      description:
        "Stage and commit only public-safe changes. Requires a chat-direct session that owns the active workspace writer lease plus an idempotency key.",
      inputSchema: gitCommitMcpSchema,
      annotations: reversibleMutationAnnotations,
      handler: async (context, input) => {
        const { idempotencyKey, ...payload } = input;
        const execution = await services.idempotency.execute(
          "tokenpilot.git.commit",
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
              ["tokenpilot.git.status", "tokenpilot.git.diff"]
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
