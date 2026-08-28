import { z } from "zod";

const projectIdSchema = z.string().min(1).max(160);
const workspaceIdSchema = z.string().min(1).max(160);
const rootIdSchema = z.string().min(1).max(160);
const configRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const repoIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const projectSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const projectRootKindSchema = z.enum(["git-repository", "directory"]);
const projectRootRoleSchema = z.enum([
  "primary-source",
  "supporting-source",
  "documentation",
  "knowledge",
  "assets"
]);
const projectRootAccessSchema = z.enum(["read-write", "read-only"]);

export const projectRegistryListSchema = z.object({
  status: z.enum(["active", "archived"]).optional()
});

export const projectRegistryProjectParamsSchema = z.object({
  projectId: projectIdSchema
});

const projectRegistryRootInputSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  kind: projectRootKindSchema.optional(),
  role: projectRootRoleSchema.optional(),
  access: projectRootAccessSchema.optional(),
  repoId: repoIdSchema.optional()
}).superRefine((value, ctx) => {
  if (value.kind === "directory" && value.repoId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repoId"],
      message: "directory ProjectRoot must not declare repoId"
    });
  }
});

const projectRegistryCanonicalCreateSchema = z.object({
  slug: projectSlugSchema.optional(),
  displayName: z.string().trim().min(1).max(240),
  root: projectRegistryRootInputSchema,
  expectedConfigRevision: configRevisionSchema
});

const projectRegistryLegacyCreateSchema = z.object({
  slug: projectSlugSchema,
  displayName: z.string().trim().min(1).max(240),
  repoId: repoIdSchema,
  path: z.string().trim().min(1).max(4096),
  expectedConfigRevision: configRevisionSchema
});

export const projectRegistryCreateSchema = z.union([
  projectRegistryCanonicalCreateSchema,
  projectRegistryLegacyCreateSchema
]);

export const projectRegistryRenameSchema = z.object({
  displayName: z.string().trim().min(1).max(240),
  expectedConfigRevision: configRevisionSchema
});

export const projectRegistryAttachWorkspaceSchema = z.object({
  repoId: repoIdSchema,
  path: z.string().trim().min(1).max(4096),
  expectedConfigRevision: configRevisionSchema
});

export const projectRegistryWorkspaceParamsSchema = z.object({
  projectId: projectIdSchema,
  workspaceId: workspaceIdSchema
});

export const projectRegistryRootParamsSchema = z.object({
  projectId: projectIdSchema,
  rootId: rootIdSchema
});

export const projectRegistryAttachRootSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  kind: projectRootKindSchema,
  role: projectRootRoleSchema.optional(),
  access: projectRootAccessSchema.optional(),
  repoId: repoIdSchema.optional(),
  expectedConfigRevision: configRevisionSchema
}).superRefine((value, ctx) => {
  if (value.kind === "directory" && value.repoId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repoId"],
      message: "directory ProjectRoot must not declare repoId"
    });
  }
});

export const projectRegistryMutationSchema = z.object({
  expectedConfigRevision: configRevisionSchema
});

export type ProjectRegistryCreateInput = z.infer<typeof projectRegistryCreateSchema>;
export type ProjectRegistryAttachWorkspaceInput = z.infer<typeof projectRegistryAttachWorkspaceSchema>;
export type ProjectRegistryAttachRootInput = z.infer<typeof projectRegistryAttachRootSchema>;
