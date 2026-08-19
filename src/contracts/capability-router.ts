import { z } from "zod";

const identifierSchema = z.string().min(1).max(240);
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
