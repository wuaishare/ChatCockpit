import { z } from "zod";

export const jobProcessControlSchema = z.object({
  action: z.enum(["pause", "resume", "terminate"]),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
});

export type JobProcessControlInput = z.infer<typeof jobProcessControlSchema> & { jobId: string };
