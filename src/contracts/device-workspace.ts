import { z } from "zod";

export const deviceWorkspaceInvokeSchema = z.object({
  targetDevice: z.string().min(1).max(180),
  action: z.string().min(1).max(120).regex(/^[a-z][a-z0-9.-]*$/),
  params: z.record(z.string(), z.unknown()).default({})
}).strict();

export const deviceWorkspaceTargetSchema = z.object({
  id: z.string().min(1).max(180),
  kind: z.literal("device"),
  locality: z.enum(["local", "remote"]),
  displayName: z.string().min(1).max(160),
  platform: z.string().min(1).max(80),
  architecture: z.string().min(1).max(80),
  presence: z.enum(["online", "offline"]),
  executionPolicy: z.enum(["active", "paused"]),
  executionAvailable: z.boolean()
}).strict();

export const deviceWorkspaceInvokeOutputSchema = z.object({
  ok: z.literal(true),
  action: z.string().min(1).max(120),
  target: deviceWorkspaceTargetSchema,
  result: z.unknown()
}).strict();

export type DeviceWorkspaceInvokeInput = z.infer<typeof deviceWorkspaceInvokeSchema>;
