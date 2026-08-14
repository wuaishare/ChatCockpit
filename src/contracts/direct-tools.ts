import { z } from "zod";

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
      sessionId: z.string().min(1).max(160),
      path: z.string().min(1),
      content: z.string().min(1)
    }),
    fileEditSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160),
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
      workdir: z.string().optional()
    }),
    gitStatusSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId)
    }),
    gitDiffSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      staged: z.boolean().default(false)
    }),
    gitCommitSchema: z.object({
      ...directExecutorPreference,
      repoId: z.string().min(1).default(defaultRepoId),
      sessionId: z.string().min(1).max(160),
      message: z.string().min(1),
      body: z.string().optional()
    })
  };
}

const TOKENPILOT_DIRECT_TOOL_SCHEMAS = buildDirectToolSchemas("tokenpilot");

export const fileWriteSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.fileWriteSchema;
export const fileEditSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.fileEditSchema;
export const fileListSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.fileListSchema;
export const searchSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.searchSchema;
export const shellRunSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.shellRunSchema;
export const gitStatusSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.gitStatusSchema;
export const gitDiffSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.gitDiffSchema;
export const gitCommitSchema = TOKENPILOT_DIRECT_TOOL_SCHEMAS.gitCommitSchema;

export type FileReadInput = z.infer<typeof fileReadSchema>;
export type FileReadBatchInput = z.infer<typeof fileReadBatchSchema>;
export type FileWriteInput = z.infer<typeof fileWriteSchema>;
export type FileEditInput = z.infer<typeof fileEditSchema>;
export type FileListInput = z.infer<typeof fileListSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type ShellRunInput = z.infer<typeof shellRunSchema>;
export type GitStatusInput = z.infer<typeof gitStatusSchema>;
export type GitDiffInput = z.infer<typeof gitDiffSchema>;
export type GitCommitInput = z.infer<typeof gitCommitSchema>;
