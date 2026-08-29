import { z } from "zod";

import { DEFAULT_PRODUCT_IDENTITY } from "../core/product-identity.js";

const directExecutorPreference = {
  executorId: z.string().min(1).max(160).optional()
};

export const fileReadSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1),
  path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional()
});

export const fileReadBatchSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1).max(10),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional()
});

export function buildDirectToolSchemas(defaultRepoId: string) {
  return {
    fileReadSchema,
    fileReadBatchSchema,
    fileWriteSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional(),
      path: z.string().min(1),
      content: z.string().min(1)
    }),
    fileEditSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional(),
      path: z.string().min(1),
      search: z.string().min(1),
      replace: z.string()
    }),
    fileListSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      path: z.string().min(1).default(".")
    }),
    searchSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      pattern: z.string().min(1),
      path: z.string().optional(),
      maxResults: z.number().int().positive().max(40).optional(),
      contextLines: z.number().int().nonnegative().max(3).optional(),
      caseSensitive: z.boolean().optional()
    }),
    shellRunSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional(),
      command: z.string().min(1),
      args: z.array(z.string()),
      workdir: z.string().optional(),
      timeoutMs: z.number().int().min(1_000).max(120_000).optional()
    }),
    workspaceExecSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional(),
      command: z.string().min(1),
      args: z.array(z.string()),
      workdir: z.string().optional(),
      allowStdin: z.boolean().optional(),
      networkAccess: z.boolean().optional(),
      executionMode: z.enum(["native-sandbox", "host-managed"]).optional(),
      allowBuiltinFallback: z.boolean().optional()
    }),
    workspaceProcessReadSchema: z.object({
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional(),
      processId: z.string().min(1).max(200),
      cursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(200).optional()
    }),
    workspaceProcessControlSchema: z.discriminatedUnion("action", [
      z.object({
        repoId: z.string().min(1).default(defaultRepoId),
        sessionId: z.string().min(1).max(160).optional(),
        processId: z.string().min(1).max(200),
        action: z.literal("input"),
        input: z.string(),
        closeStdin: z.boolean().optional()
      }),
      z.object({
        repoId: z.string().min(1).default(defaultRepoId),
        sessionId: z.string().min(1).max(160).optional(),
        processId: z.string().min(1).max(200),
        action: z.literal("terminate")
      })
    ]),
    gitStatusSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId)
    }),
    gitDiffSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      staged: z.boolean().default(false)
    }),
    gitStageSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional(),
      paths: z.array(z.string().min(1).max(1024)).min(1).max(200)
    }),
    gitSyncSchema: z.discriminatedUnion("action", [
      z.object({
        ...directExecutorPreference,
        repoId: z.string().min(1).default(defaultRepoId),
        sessionId: z.string().min(1).max(160).optional(),
        action: z.literal("fetch"),
        prune: z.boolean().optional()
      }),
      z.object({
        ...directExecutorPreference,
        repoId: z.string().min(1).default(defaultRepoId),
        sessionId: z.string().min(1).max(160).optional(),
        action: z.literal("fast-forward"),
        prune: z.boolean().optional()
      }),
      z.object({
        ...directExecutorPreference,
        repoId: z.string().min(1).default(defaultRepoId),
        sessionId: z.string().min(1).max(160).optional(),
        action: z.literal("worktree-prune")
      })
    ]),
    gitPushSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional()
    }),
    gitCommitSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160).optional(),
      message: z.string().min(1),
      body: z.string().optional()
    })
  };
}

const DEFAULT_DIRECT_TOOL_SCHEMAS = buildDirectToolSchemas(DEFAULT_PRODUCT_IDENTITY.defaultRepoId);

export const fileWriteSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.fileWriteSchema;
export const fileEditSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.fileEditSchema;
export const fileListSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.fileListSchema;
export const searchSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.searchSchema;
export const shellRunSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.shellRunSchema;
export const workspaceExecSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.workspaceExecSchema;
export const workspaceProcessReadSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.workspaceProcessReadSchema;
export const workspaceProcessControlSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.workspaceProcessControlSchema;
export const gitStatusSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.gitStatusSchema;
export const gitDiffSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.gitDiffSchema;
export const gitStageSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.gitStageSchema;
export const gitSyncSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.gitSyncSchema;
export const gitPushSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.gitPushSchema;
export const gitCommitSchema = DEFAULT_DIRECT_TOOL_SCHEMAS.gitCommitSchema;

export type FileReadInput = z.infer<typeof fileReadSchema>;
export type FileReadBatchInput = z.infer<typeof fileReadBatchSchema>;
export type FileWriteInput = z.infer<typeof fileWriteSchema>;
export type FileEditInput = z.infer<typeof fileEditSchema>;
export type FileListInput = z.infer<typeof fileListSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type ShellRunInput = z.infer<typeof shellRunSchema>;
export type WorkspaceExecInput = z.infer<typeof workspaceExecSchema>;
export type WorkspaceProcessReadInput = z.infer<typeof workspaceProcessReadSchema>;
export type WorkspaceProcessControlInput = z.infer<typeof workspaceProcessControlSchema>;
export type GitStatusInput = z.infer<typeof gitStatusSchema>;
export type GitDiffInput = z.infer<typeof gitDiffSchema>;
export type GitStageInput = z.infer<typeof gitStageSchema>;
export type GitSyncInput = z.infer<typeof gitSyncSchema>;
export type GitPushInput = z.infer<typeof gitPushSchema>;
export type GitCommitInput = z.infer<typeof gitCommitSchema>;
