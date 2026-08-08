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

export const fileWriteSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot"),
  sessionId: z.string().min(1).max(160),
  path: z.string().min(1),
  content: z.string().min(1)
});

export const fileEditSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot"),
  sessionId: z.string().min(1).max(160),
  path: z.string().min(1),
  search: z.string().min(1),
  replace: z.string()
});

export const fileListSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot"),
  path: z.string().min(1).default(".")
});

export const searchSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot"),
  pattern: z.string().min(1),
  path: z.string().optional(),
  maxResults: z.number().int().positive().max(40).optional(),
  contextLines: z.number().int().nonnegative().max(3).optional(),
  caseSensitive: z.boolean().optional()
});

export const shellRunSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot"),
  sessionId: z.string().min(1).max(160).optional(),
  command: z.string().min(1),
  args: z.array(z.string()),
  workdir: z.string().optional()
});

export const gitStatusSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot")
});

export const gitDiffSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot"),
  staged: z.boolean().default(false)
});

export const gitCommitSchema = z.object({
  ...directExecutorPreference,
  repoId: z.string().min(1).default("tokenpilot"),
  sessionId: z.string().min(1).max(160),
  message: z.string().min(1),
  body: z.string().optional()
});

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
