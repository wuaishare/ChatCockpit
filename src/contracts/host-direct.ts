import { z } from "zod";

const hostRootIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const hostPathSchema = z.string().min(1).max(4096);
const identifierSchema = z.string().min(1).max(160);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const revisionSchema = z.number().int().positive();

export const hostFileReadSchema = z.object({
  rootId: hostRootIdSchema,
  path: hostPathSchema,
  executorId: identifierSchema.optional()
});

const hostWriteMutationSchema = z.object({
  operation: z.literal("files.write"),
  rootId: hostRootIdSchema,
  path: hostPathSchema,
  content: z.string().max(64 * 1024),
  sessionId: identifierSchema.optional(),
  executorId: identifierSchema.optional()
});

const hostEditMutationSchema = z.object({
  operation: z.literal("files.edit"),
  rootId: hostRootIdSchema,
  path: hostPathSchema,
  oldText: z.string().min(1).max(64 * 1024),
  newText: z.string().max(64 * 1024),
  sessionId: identifierSchema.optional(),
  executorId: identifierSchema.optional()
});

export const hostMutationRequestSchema = z.discriminatedUnion("operation", [
  hostWriteMutationSchema,
  hostEditMutationSchema
]);

export const hostMutationPrepareSchema = z.intersection(
  hostMutationRequestSchema,
  z.object({ idempotencyKey: idempotencyKeySchema })
);

export const hostMutationDecisionSchema = z.object({
  approvalId: identifierSchema,
  expectedRevision: revisionSchema,
  decision: z.enum(["approved", "denied"]),
  idempotencyKey: idempotencyKeySchema
});

export const hostMutationExecuteSchema = z.intersection(
  hostMutationRequestSchema,
  z.object({
    approvalId: identifierSchema,
    expectedApprovalRevision: revisionSchema,
    idempotencyKey: idempotencyKeySchema
  })
);

export type HostFileReadInput = z.infer<typeof hostFileReadSchema>;
export type HostMutationRequest = z.infer<typeof hostMutationRequestSchema>;
export type HostMutationPrepareInput = z.infer<typeof hostMutationPrepareSchema>;
export type HostMutationDecisionInput = z.infer<typeof hostMutationDecisionSchema>;
export type HostMutationExecuteInput = z.infer<typeof hostMutationExecuteSchema>;
