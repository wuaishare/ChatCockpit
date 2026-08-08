import { z } from "zod";

export const hostFileReadSchema = z.object({
  rootId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  path: z.string().min(1).max(4096),
  executorId: z.string().min(1).max(160).optional()
});
