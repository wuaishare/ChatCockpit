import { z } from "zod";

const identifierSchema = z.string().min(1).max(200);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const assessmentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const runtimeRecoveryActionSchema = z.enum([
  "resume-bound-codex",
  "fork-bound-codex",
  "bind-existing-codex-thread",
  "continue-via-handoff",
  "continue-chat-direct",
  "reconcile-runner-binding"
]);

export const recoveryAssessSchema = z.object({
  workspaceId: identifierSchema,
  taskId: identifierSchema,
  sessionId: identifierSchema.optional(),
  providerKind: z.string().min(1).max(100).optional(),
  idempotencyKey: idempotencyKeySchema
});

export const recoveryExecuteSchema = z
  .object({
    recoveryId: identifierSchema,
    assessmentHash: assessmentHashSchema,
    expectedRecoveryRevision: z.number().int().positive(),
    action: runtimeRecoveryActionSchema,
    targetThreadId: z.string().min(1).max(240).optional(),
    targetMode: z.enum(["chat-direct", "codex-session", "async-agent"]).optional(),
    idempotencyKey: idempotencyKeySchema
  })
  .superRefine((value, context) => {
    if (
      value.action === "bind-existing-codex-thread" &&
      !value.targetThreadId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetThreadId"],
        message: "bind-existing-codex-thread requires targetThreadId"
      });
    }
    if (value.action === "continue-via-handoff" && !value.targetMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetMode"],
        message: "continue-via-handoff requires targetMode"
      });
    }
  });

export const recoveryAttemptsQuerySchema = z.object({
  workspaceId: identifierSchema.optional(),
  taskId: identifierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const recoveryAttemptReadSchema = z.object({
  recoveryId: identifierSchema
});

export type RecoveryAssessInput = z.infer<typeof recoveryAssessSchema>;
export type RecoveryExecuteInput = z.infer<typeof recoveryExecuteSchema>;
export type RecoveryAttemptsQuery = z.infer<typeof recoveryAttemptsQuerySchema>;
export type RecoveryAttemptReadInput = z.infer<typeof recoveryAttemptReadSchema>;
