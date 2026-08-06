import { z } from "zod";

const identifierSchema = z.string().min(1).max(256);
const revisionSchema = z.number().int().positive();
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const asyncJobQueueSchema = z.object({
  taskId: identifierSchema,
  sessionId: identifierSchema,
  expectedTaskRevision: revisionSchema,
  expectedSessionRevision: revisionSchema,
  repoId: identifierSchema,
  title: z.string().min(1).max(500),
  instructions: z.string().min(1).max(100_000),
  executionMode: z.enum(["plan", "review", "develop"]).default("develop"),
  worktreePolicy: z.enum(["auto", "always", "never"]).default("auto"),
  branchName: z.string().min(1).max(512).optional(),
  approvalPolicy: z.enum(["untrusted", "on-request", "never"]).default("never"),
  sandbox: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .default("workspace-write"),
  verificationCommands: z.array(z.string().min(1).max(4_000)).max(100).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(4_000)).max(100).optional(),
  commitPolicy: z.enum(["none", "propose", "commit"]).default("propose"),
  commitTitle: z.string().min(1).max(500).optional(),
  commitBody: z.string().min(1).max(10_000).optional(),
  idempotencyKey: idempotencyKeySchema
});

export type AsyncJobQueueInput = z.infer<typeof asyncJobQueueSchema>;
