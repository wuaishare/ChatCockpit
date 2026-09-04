import { z } from "zod";

const identifierSchema = z.string().min(1).max(160);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const revisionSchema = z.number().int().positive();
const isoDateSchema = z.string().datetime({ offset: true });

export const projectListSchema = z.object({
  status: z.enum(["active", "archived"]).optional()
});

export const projectGetSchema = z.object({
  projectId: identifierSchema
});

export const workspaceSnapshotSchema = z.object({
  workspaceId: identifierSchema
});

export const taskCreateSchema = z.object({
  projectId: identifierSchema,
  workspaceId: identifierSchema,
  specId: identifierSchema.nullable().optional(),
  planId: identifierSchema.nullable().optional(),
  parentTaskId: identifierSchema.nullable().optional(),
  title: z.string().min(1).max(240),
  goal: z.string().min(1).max(12_000),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  executionPolicy: z
    .enum(["planning-required", "planning-optional"])
    .default("planning-optional"),
  idempotencyKey: idempotencyKeySchema
});

export const taskGetSchema = z.object({
  taskId: identifierSchema
});

export const taskSubmitReviewSchema = z.object({
  taskId: identifierSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const taskCompleteSchema = z.object({
  taskId: identifierSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const sessionStartSchema = z.object({
  taskId: identifierSchema,
  title: z.string().min(1).max(240),
  mode: z.enum(["chat-direct", "codex-session", "async-agent"]),
  expectedTaskRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const sessionGetSchema = z.object({
  sessionId: identifierSchema
});

export const sessionFinishSchema = z.object({
  sessionId: identifierSchema,
  outcome: z.enum(["completed", "failed"]).default("completed"),
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const leaseAcquireSchema = z.object({
  sessionId: identifierSchema,
  holderId: identifierSchema,
  expiresAt: isoDateSchema,
  idempotencyKey: idempotencyKeySchema
});

export const leaseReleaseSchema = z.object({
  leaseId: identifierSchema,
  sessionId: identifierSchema,
  holderId: identifierSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const handoffPrepareSchema = z.object({
  taskId: identifierSchema,
  sessionId: identifierSchema,
  toMode: z
    .enum(["chat-direct", "codex-session", "async-agent", "unassigned"])
    .default("unassigned"),
  goal: z.string().min(1).max(12_000),
  completedItems: z.array(z.string().min(1).max(2_000)).max(200).default([]),
  pendingItems: z.array(z.string().min(1).max(2_000)).max(200).default([]),
  changedFiles: z.array(z.string().min(1).max(1_024)).max(500).default([]),
  risks: z.array(z.string().min(1).max(2_000)).max(200).default([]),
  nextAction: z.string().min(1).max(4_000),
  gitHead: z.string().min(1).max(160).nullable().optional(),
  gitBranch: z.string().min(1).max(512).nullable().optional(),
  gitDirty: z.boolean(),
  diffArtifactId: identifierSchema.nullable().optional(),
  evidenceBundleId: identifierSchema.nullable().optional(),
  expectedTaskRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const handoffAcceptSchema = z.object({
  handoffId: identifierSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const handoffCancelSchema = z.object({
  handoffId: identifierSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

export const handoffForkSchema = z.object({
  handoffId: identifierSchema,
  expectedRevision: revisionSchema,
  title: z.string().min(1).max(240),
  sessionTitle: z.string().min(1).max(240),
  mode: z.enum(["chat-direct", "codex-session", "async-agent"]).optional(),
  idempotencyKey: idempotencyKeySchema
});

export const evidenceRecordSchema = z.object({
  taskId: identifierSchema,
  sessionId: identifierSchema,
  bundleId: identifierSchema.optional(),
  kind: z.enum([
    "command",
    "test",
    "build",
    "lint",
    "typecheck",
    "diff",
    "review",
    "screenshot",
    "manual"
  ]),
  label: z.string().min(1).max(240),
  status: z.enum(["passed", "failed", "skipped", "not-run"]),
  required: z.boolean().default(false),
  command: z.string().max(4_000).nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
  artifactId: identifierSchema.nullable().optional(),
  summary: z.string().max(8_000).default(""),
  startedAt: isoDateSchema.nullable().optional(),
  completedAt: isoDateSchema.nullable().optional(),
  expectedTaskRevision: revisionSchema.optional(),
  idempotencyKey: idempotencyKeySchema
});

export type ProjectListInput = z.infer<typeof projectListSchema>;
export type ProjectGetInput = z.infer<typeof projectGetSchema>;
export type WorkspaceSnapshotInput = z.infer<typeof workspaceSnapshotSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskGetInput = z.infer<typeof taskGetSchema>;
export type TaskSubmitReviewInput = z.infer<typeof taskSubmitReviewSchema>;
export type TaskCompleteInput = z.infer<typeof taskCompleteSchema>;
export type SessionStartInput = z.infer<typeof sessionStartSchema>;
export type SessionGetInput = z.infer<typeof sessionGetSchema>;
export type SessionFinishInput = z.infer<typeof sessionFinishSchema>;
export type LeaseAcquireInput = z.infer<typeof leaseAcquireSchema>;
export type LeaseReleaseInput = z.infer<typeof leaseReleaseSchema>;
export type HandoffPrepareInput = z.infer<typeof handoffPrepareSchema>;
export type HandoffAcceptInput = z.infer<typeof handoffAcceptSchema>;
export type HandoffCancelInput = z.infer<typeof handoffCancelSchema>;
export type HandoffForkInput = z.infer<typeof handoffForkSchema>;
export type EvidenceRecordInput = z.infer<typeof evidenceRecordSchema>;
