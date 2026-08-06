import { z } from "zod";

const identifierSchema = z.string().min(1).max(160);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const revisionSchema = z.number().int().positive();
const kindSchema = z.enum(["spec", "plan"]);
const statusSchema = z.enum([
  "draft",
  "ready",
  "approved",
  "superseded",
  "archived"
]);
const contentMarkdownSchema = z.string().min(1).max(250_000);

export const developmentDocumentCreateSchema = z.object({
  projectId: identifierSchema,
  workspaceId: identifierSchema,
  kind: kindSchema,
  title: z.string().min(1).max(240),
  contentMarkdown: contentMarkdownSchema,
  changeSummary: z.string().max(4_000).default("Initial version"),
  idempotencyKey: idempotencyKeySchema
});

export const developmentDocumentGetSchema = z.object({
  documentId: identifierSchema
});

export const developmentDocumentVersionGetSchema = z.object({
  documentId: identifierSchema,
  version: z.number().int().positive()
});

export const developmentDocumentListSchema = z.object({
  workspaceId: identifierSchema,
  kind: kindSchema.optional(),
  status: statusSchema.optional()
});

export const developmentDocumentAppendVersionSchema = z.object({
  documentId: identifierSchema,
  contentMarkdown: contentMarkdownSchema,
  changeSummary: z.string().max(4_000).default(""),
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const developmentDocumentStatusSchema = z.object({
  documentId: identifierSchema,
  status: statusSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const taskDocumentBindSchema = z.object({
  taskId: identifierSchema,
  specId: identifierSchema.nullable(),
  planId: identifierSchema.nullable(),
  expectedTaskRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export type DevelopmentDocumentCreateInput = z.infer<
  typeof developmentDocumentCreateSchema
>;
export type DevelopmentDocumentGetInput = z.infer<
  typeof developmentDocumentGetSchema
>;
export type DevelopmentDocumentVersionGetInput = z.infer<
  typeof developmentDocumentVersionGetSchema
>;
export type DevelopmentDocumentListInput = z.infer<
  typeof developmentDocumentListSchema
>;
export type DevelopmentDocumentAppendVersionInput = z.infer<
  typeof developmentDocumentAppendVersionSchema
>;
export type DevelopmentDocumentStatusInput = z.infer<
  typeof developmentDocumentStatusSchema
>;
export type TaskDocumentBindInput = z.infer<typeof taskDocumentBindSchema>;
