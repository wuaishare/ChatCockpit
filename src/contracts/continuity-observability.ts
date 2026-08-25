import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const boundedLimitSchema = z.coerce.number().int().min(1).max(100);
const nullableIdentifierSchema = identifierSchema.nullable();

export const trajectoryReadSchema = z.object({
  activityId: identifierSchema,
  limit: boundedLimitSchema.default(50)
});

export const continuityCapsuleSchema = z.object({
  workspaceId: identifierSchema,
  taskId: identifierSchema.optional(),
  activityId: identifierSchema.optional(),
  trajectoryLimit: boundedLimitSchema.default(20)
});

export const trajectoryEventSchema = z.object({
  id: identifierSchema,
  kind: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  code: z.string().max(80).nullable(),
  itemType: z.string().max(80).nullable(),
  createdAt: z.string()
});
export const trajectoryActivitySchema = z.object({
  id: identifierSchema,
  kind: z.enum(["agent-session", "job", "device-operation"]),
  scope: z.enum(["workspace", "repo", "host"]),
  status: z.string().min(1).max(80),
  title: z.string().max(240),
  targetDeviceId: identifierSchema,
  projectId: nullableIdentifierSchema,
  workspaceId: nullableIdentifierSchema,
  taskId: nullableIdentifierSchema,
  repoId: nullableIdentifierSchema,
  agentSessionId: nullableIdentifierSchema,
  runtime: z.object({
    runtimeKind: z.enum(["codex-app-server", "async-runner"]),
    externalThreadId: z.string().nullable(),
    turnId: z.string().nullable(),
    runStatus: z.string().nullable()
  }).nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().nullable()
});

export const trajectoryProjectionSchema = z.object({
  version: z.literal("1"),
  activity: trajectoryActivitySchema,
  events: z.array(trajectoryEventSchema).max(100),
  limit: z.number().int().min(1).max(100),
  bounded: z.literal(true)
});
const capsuleTrajectorySchema = z.object({
  activityId: identifierSchema,
  title: z.string().max(240),
  status: z.string().max(80),
  events: z.array(trajectoryEventSchema.omit({ id: true })).max(100)
});

export const continuityCapsuleProjectionSchema = z.object({
  version: z.literal("1"),
  project: z.object({ id: identifierSchema, name: z.string().max(240) }),
  workspace: z.object({
    id: identifierSchema,
    repoId: identifierSchema,
    kind: z.enum(["checkout", "worktree"])
  }),
  source: z.object({
    modelLoopOwner: z.enum(["chatgpt", "codex", "async-agent", "unknown"]),
    sessionId: nullableIdentifierSchema,
    sessionMode: z.enum(["chat-direct", "codex-session", "async-agent"]).nullable(),
    activityId: nullableIdentifierSchema,
    runtime: z.object({
      kind: z.string().max(80),
      id: identifierSchema,
      deepLink: z.string().max(512).nullable()
    }).nullable()
  }),
  git: z.object({
    available: z.boolean(),
    branch: z.string().nullable(),
    headCommit: z.string().nullable(),
    dirty: z.boolean(),
    changedPaths: z.array(z.string().max(512)).max(100)
  }),
  objective: z.string().max(600).nullable(),
  completedItems: z.array(z.string().max(400)).max(20),
  pendingItems: z.array(z.string().max(400)).max(20),
  risks: z.array(z.string().max(400)).max(20),
  nextAction: z.string().max(600).nullable(),
  verification: z.object({
    state: z.enum(["verified", "incomplete", "missing"]),
    items: z.array(z.object({
      kind: z.string().max(80),
      label: z.string().max(240),
      status: z.string().max(80),
      required: z.boolean()
    })).max(50)
  }),
  trajectory: capsuleTrajectorySchema.nullable(),
  markdown: z.string().max(12_000)
});

export const trajectoryToolOutputSchema = z.object({
  ok: z.literal(true),
  trajectory: trajectoryProjectionSchema
});
export const continuityCapsuleToolOutputSchema = z.object({
  ok: z.literal(true),
  capsule: continuityCapsuleProjectionSchema
});

export type TrajectoryReadInput = z.infer<typeof trajectoryReadSchema>;
export type ContinuityCapsuleInput = z.infer<typeof continuityCapsuleSchema>;
export type TrajectoryProjection = z.infer<typeof trajectoryProjectionSchema>;
export type ContinuityCapsuleProjection = z.infer<typeof continuityCapsuleProjectionSchema>;
