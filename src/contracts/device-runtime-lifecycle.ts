import { z } from "zod";

export const remoteDeviceIdSchema = z
  .string()
  .regex(/^cc_device_[A-Za-z0-9_-]{20,80}$/);

export const deviceRuntimeOperationIdSchema = z
  .string()
  .regex(/^cc_device_runtime_op_[A-Za-z0-9_-]{20,120}$/);

export const deviceRuntimeMutationActionSchema = z.enum([
  "start",
  "stop",
  "restart"
]);

export const deviceRuntimeIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const deviceRuntimeStatusSchema = z
  .object({ deviceId: remoteDeviceIdSchema })
  .strict();

export const deviceRuntimeLifecycleExecuteSchema = z
  .object({
    idempotencyKey: deviceRuntimeIdempotencyKeySchema,
    deviceId: remoteDeviceIdSchema,
    action: deviceRuntimeMutationActionSchema,
    expectedStateRevision: z.number().int().nonnegative().optional()
  })
  .strict();

export const deviceRuntimeOperationGetSchema = z
  .object({ operationId: deviceRuntimeOperationIdSchema })
  .strict();
