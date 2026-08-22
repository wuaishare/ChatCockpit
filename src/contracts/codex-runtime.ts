import { z } from "zod";

const optionalBooleanSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    return value === "true" || value === "1";
  });

const codexPrimaryThreadSourceKindSchema = z.enum([
  "cli",
  "vscode",
  "exec",
  "appServer",
  "unknown"
]);

export const codexThreadListSchema = z.object({
  cursor: z.string().min(1).nullable().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  workspaceId: z.string().min(1).optional(),
  searchTerm: z.string().min(1).max(500).optional(),
  archived: optionalBooleanSchema,
  sourceKinds: z.array(codexPrimaryThreadSourceKindSchema).max(5).optional()
});

export const codexThreadReadSchema = z.object({
  threadId: z.string().min(1),
  includeTurns: optionalBooleanSchema.default(false)
});

const nativeRuntimeMutationBaseSchema = z.object({
  workspaceId: z.string().min(1).max(160),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexNativeThreadStartSchema = nativeRuntimeMutationBaseSchema;

export const codexNativeThreadResumeSchema = nativeRuntimeMutationBaseSchema.extend({
  threadId: z.string().min(1).max(240)
});

export const codexNativeThreadForkSchema = codexNativeThreadResumeSchema.extend({
  lastTurnId: z.string().min(1).max(240).nullable().optional()
});

const runtimeMutationBaseSchema = z.object({
  sessionId: z.string().min(1).max(160),
  threadId: z.string().min(1).max(240),
  expectedSessionRevision: z.number().int().positive(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexSessionBindSchema = runtimeMutationBaseSchema;

export const codexSessionResumeSchema = runtimeMutationBaseSchema;

export const codexSessionForkSchema = runtimeMutationBaseSchema.extend({
  lastTurnId: z.string().min(1).max(240).nullable().optional()
});

export const codexTurnStartSchema = z.object({
  sessionId: z.string().min(1).max(160),
  text: z.string().min(1).max(50_000),
  expectedSessionRevision: z.number().int().positive(),
  expectedTaskRevision: z.number().int().positive(),
  leaseDurationSeconds: z.number().int().min(60).max(3_600).default(900),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexTurnInterruptSchema = z.object({
  runId: z.string().min(1).max(160),
  expectedRunRevision: z.number().int().positive(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexNativeTurnStartSchema = z.object({
  workspaceId: z.string().min(1).max(160),
  threadId: z.string().min(1).max(240),
  text: z.string().min(1).max(50_000),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexNativeTurnInterruptSchema = z.object({
  workspaceId: z.string().min(1).max(160),
  threadId: z.string().min(1).max(240),
  turnId: z.string().min(1).max(240),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexNativeApprovalListSchema = z.object({
  threadId: z.string().min(1).max(240).optional()
});

export const codexNativeApprovalRespondSchema = z.object({
  approvalId: z.string().min(1).max(160),
  expectedRevision: z.number().int().positive(),
  decision: z.enum(["accept", "decline", "cancel"]),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexNativeEventsQuerySchema = z.object({
  threadId: z.string().min(1).max(240),
  afterSequence: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const codexApprovalRespondSchema = z.object({
  approvalId: z.string().min(1).max(160),
  expectedRevision: z.number().int().positive(),
  decision: z.enum(["accept", "decline", "cancel"]),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
});

export const codexRuntimeEventsQuerySchema = z
  .object({
    sessionId: z.string().min(1).max(160).optional(),
    runId: z.string().min(1).max(160).optional(),
    afterSequence: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
  .refine((value) => Boolean(value.sessionId || value.runId), {
    message: "sessionId or runId is required"
  });

export type CodexThreadListInput = z.infer<typeof codexThreadListSchema>;
export type CodexThreadReadInput = z.infer<typeof codexThreadReadSchema>;
export type CodexNativeThreadStartInput = z.infer<typeof codexNativeThreadStartSchema>;
export type CodexNativeThreadResumeInput = z.infer<typeof codexNativeThreadResumeSchema>;
export type CodexNativeThreadForkInput = z.infer<typeof codexNativeThreadForkSchema>;
export type CodexSessionBindInput = z.infer<typeof codexSessionBindSchema>;
export type CodexSessionResumeInput = z.infer<typeof codexSessionResumeSchema>;
export type CodexSessionForkInput = z.infer<typeof codexSessionForkSchema>;
export type CodexTurnStartInput = z.infer<typeof codexTurnStartSchema>;
export type CodexTurnInterruptInput = z.infer<typeof codexTurnInterruptSchema>;
export type CodexNativeTurnStartInput = z.infer<typeof codexNativeTurnStartSchema>;
export type CodexNativeTurnInterruptInput = z.infer<
  typeof codexNativeTurnInterruptSchema
>;
export type CodexNativeApprovalListInput = z.infer<
  typeof codexNativeApprovalListSchema
>;
export type CodexNativeApprovalRespondInput = z.infer<
  typeof codexNativeApprovalRespondSchema
>;
export type CodexNativeEventsQuery = z.infer<typeof codexNativeEventsQuerySchema>;
export type CodexApprovalRespondInput = z.infer<
  typeof codexApprovalRespondSchema
>;
export type CodexRuntimeEventsQuery = z.infer<
  typeof codexRuntimeEventsQuerySchema
>;
