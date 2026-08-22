import { z } from "zod";

const configRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const rootIdSchema = z.string().regex(/^workspace_root_[a-f0-9]{24}$/);
const candidateIdSchema = z.string().regex(/^workspace_candidate_[a-f0-9]{32}$/);
const repoIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const workspaceDiscoveryRootCreateSchema = z.object({
  path: z.string().min(1).max(4096),
  expectedConfigRevision: configRevisionSchema
});

export const workspaceDiscoveryRootParamsSchema = z.object({
  rootId: rootIdSchema
});

export const workspaceDiscoveryRootMutationSchema = z.object({
  expectedConfigRevision: configRevisionSchema
});

export const workspaceDiscoveryImportSchema = z.object({
  candidateId: candidateIdSchema,
  repoId: repoIdSchema,
  expectedConfigRevision: configRevisionSchema,
  idempotencyKey: idempotencyKeySchema
});
