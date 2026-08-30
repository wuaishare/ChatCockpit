import { z } from "zod";

const hostRootIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const identifierSchema = z.string().min(1).max(160);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const revisionSchema = z.number().int().positive();
const processIdSchema = z.string().regex(/^host_process_[A-Za-z0-9_-]{8,160}$/);

export const hostProcessStartRequestSchema = z
  .object({
    operation: z.literal("start"),
    scope: z.enum(["workspace", "host"]).default("workspace"),
    rootId: hostRootIdSchema,
    workdir: z.string().min(1).max(4096).optional(),
    command: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._+-]+$/),
    args: z.array(z.string().min(1).max(2048)).max(64).default([]),
    sessionId: identifierSchema.optional(),
    executorId: identifierSchema.optional(),
    startupTimeoutMs: z.number().int().min(100).max(5_000).default(1_000)
  })
  .superRefine((value, context) => {
    if (value.scope === "workspace" && !value.sessionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessionId"],
        message: "Workspace Host Process requires sessionId"
      });
    }
    if (value.scope === "host" && value.sessionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessionId"],
        message: "Pure Host Process must not supply a development session"
      });
    }
  });

export const hostProcessInputRequestSchema = z.object({
  operation: z.literal("input"),
  processId: processIdSchema,
  sessionId: identifierSchema.optional(),
  input: z.string().min(1).max(8_192),
  waitForPrompt: z.boolean().default(true),
  timeoutMs: z.number().int().min(100).max(8_000).default(2_000)
});

export const hostProcessStopRequestSchema = z.object({
  operation: z.literal("stop"),
  processId: processIdSchema,
  sessionId: identifierSchema.optional()
});

export const hostProcessRequestSchema = z.discriminatedUnion("operation", [
  hostProcessStartRequestSchema,
  hostProcessInputRequestSchema,
  hostProcessStopRequestSchema
]);

export const hostProcessPrepareSchema = z.intersection(
  hostProcessRequestSchema,
  z.object({ idempotencyKey: idempotencyKeySchema })
);

export const hostProcessDecisionSchema = z.object({
  approvalId: identifierSchema,
  expectedRevision: revisionSchema,
  decision: z.enum(["approved", "denied"]),
  idempotencyKey: idempotencyKeySchema
});

export const hostProcessExecuteSchema = z.intersection(
  hostProcessRequestSchema,
  z.object({
    approvalId: identifierSchema,
    expectedApprovalRevision: revisionSchema,
    idempotencyKey: idempotencyKeySchema
  })
);

export const hostProcessReadSchema = z.object({
  processId: processIdSchema,
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).max(1_000).optional(),
  waitMs: z.number().int().min(0).max(5_000).optional()
});

export const hostProcessListSchema = z.object({
  scope: z.enum(["workspace", "host"]).optional(),
  workspaceId: identifierSchema.optional(),
  sessionId: identifierSchema.optional(),
  status: z
    .enum(["starting", "running", "exited", "terminated", "failed", "stale"])
    .optional()
});

export type HostProcessStartRequest = z.infer<
  typeof hostProcessStartRequestSchema
>;
export type HostProcessInputRequest = z.infer<
  typeof hostProcessInputRequestSchema
>;
export type HostProcessStopRequest = z.infer<
  typeof hostProcessStopRequestSchema
>;
export type HostProcessRequest = z.infer<typeof hostProcessRequestSchema>;
export type HostProcessPrepareInput = z.infer<typeof hostProcessPrepareSchema>;
export type HostProcessDecisionInput = z.infer<typeof hostProcessDecisionSchema>;
export type HostProcessExecuteInput = z.infer<typeof hostProcessExecuteSchema>;
export type HostProcessReadInput = z.infer<typeof hostProcessReadSchema>;
export type HostProcessListInput = z.infer<typeof hostProcessListSchema>;
