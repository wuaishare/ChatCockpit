import { z } from "zod";

const projectIdSchema = z.string().min(1).max(160);
const workspaceIdSchema = z.string().min(1).max(160);
const configRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const repoIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const projectSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);

export const projectRegistryListSchema = z.object({
  status: z.enum(["active", "archived"]).optional()
});

export const projectRegistryProjectParamsSchema = z.object({
  projectId: projectIdSchema
});

export const projectRegistryCreateSchema = z.object({
  slug: projectSlugSchema,
  displayName: z.string().trim().min(1).max(240),
  repoId: repoIdSchema,
  path: z.string().trim().min(1).max(4096),
  expectedConfigRevision: configRevisionSchema
});

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

export const projectRegistryMutationSchema = z.object({
  expectedConfigRevision: configRevisionSchema
});

export type ProjectRegistryCreateInput = z.infer<typeof projectRegistryCreateSchema>;
export type ProjectRegistryAttachWorkspaceInput = z.infer<typeof projectRegistryAttachWorkspaceSchema>;
