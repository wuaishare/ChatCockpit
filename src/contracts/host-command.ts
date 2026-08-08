import { z } from "zod";

const hostRootIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const identifierSchema = z.string().min(1).max(160);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const revisionSchema = z.number().int().positive();

export const hostCommandRequestSchema = z.object({
  rootId: hostRootIdSchema,
  workdir: z.string().min(1).max(4096).optional(),
  command: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._+-]+$/),
  args: z.array(z.string().min(1).max(2048)).max(64).default([]),
  timeoutMs: z.number().int().min(250).max(15_000).default(5_000),
  sessionId: identifierSchema.optional(),
  executorId: identifierSchema.optional()
});

export const hostCommandPrepareSchema = hostCommandRequestSchema.extend({
  idempotencyKey: idempotencyKeySchema
});

export const hostCommandDecisionSchema = z.object({
  approvalId: identifierSchema,
  expectedRevision: revisionSchema,
  decision: z.enum(["approved", "denied"]),
  idempotencyKey: idempotencyKeySchema
});

export const hostCommandExecuteSchema = hostCommandRequestSchema.extend({
  approvalId: identifierSchema,
  expectedApprovalRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export type HostCommandRequest = z.infer<typeof hostCommandRequestSchema>;
export type HostCommandPrepareInput = z.infer<typeof hostCommandPrepareSchema>;
export type HostCommandDecisionInput = z.infer<typeof hostCommandDecisionSchema>;
export type HostCommandExecuteInput = z.infer<typeof hostCommandExecuteSchema>;
