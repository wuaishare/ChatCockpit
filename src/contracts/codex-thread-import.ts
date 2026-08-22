import { z } from "zod";

const identifierSchema = z.string().min(1).max(160);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const codexThreadImportAssessSchema = z.object({
  workspaceId: identifierSchema,
  threadRef: z.string().min(1).max(512),
  idempotencyKey: idempotencyKeySchema
});

export const codexThreadImportExecuteSchema = z.object({
  importId: identifierSchema,
  assessmentHash: z.string().regex(/^[0-9a-f]{64}$/),
  expectedRevision: z.number().int().positive(),
  action: z.literal("handoff-to-chat-direct"),
  idempotencyKey: idempotencyKeySchema
});

export const codexThreadImportGetSchema = z.object({
  importId: identifierSchema
});

export const codexThreadImportContextSchema = z.object({
  importId: identifierSchema,
  cursor: z.string().min(1).max(256).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(40).optional()
});

export type CodexThreadImportAssessInput = z.infer<
  typeof codexThreadImportAssessSchema
>;
export type CodexThreadImportExecuteInput = z.infer<
  typeof codexThreadImportExecuteSchema
>;
export type CodexThreadImportGetInput = z.infer<typeof codexThreadImportGetSchema>;
export type CodexThreadImportContextInput = z.infer<
  typeof codexThreadImportContextSchema
>;
