import { z } from "zod";

const identifierSchema = z.string().min(1).max(240);

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const argumentsSchema = z
  .record(z.string().min(1).max(200), z.unknown())
  .refine((value) => Object.keys(value).length <= 100, {
    message: "Capability Router arguments must contain at most 100 top-level keys"
  });

export const capabilityRouterListSchema = z
  .object({
    executorId: identifierSchema.optional()
  })
  .strict();

export const capabilityRouterInspectSchema = z
  .object({
    executorId: identifierSchema,
    toolName: identifierSchema
  })
  .strict();

export const capabilityRouterReadInvokeSchema = z
  .object({
    executorId: identifierSchema,
    toolName: identifierSchema,
    arguments: argumentsSchema
  })
  .strict();

export const capabilityRouterMutationPrepareSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    executorId: identifierSchema,
    toolName: identifierSchema,
    arguments: argumentsSchema
  })
  .strict();

export const capabilityRouterMutationInspectSchema = z.discriminatedUnion(
  "target",
  [
    z
      .object({
        target: z.literal("approval"),
        approvalId: identifierSchema
      })
      .strict(),
    z
      .object({
        target: z.literal("execution"),
        executionId: identifierSchema
      })
      .strict()
  ]
);

export const capabilityRouterMutationDecisionSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    approvalId: identifierSchema,
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["approved", "denied"])
  })
  .strict();

export const capabilityRouterMutationExecuteSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    approvalId: identifierSchema,
    expectedApprovalRevision: z.number().int().positive(),
    executorId: identifierSchema,
    toolName: identifierSchema,
    arguments: argumentsSchema
  })
  .strict();
