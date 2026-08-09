import { z } from "zod";

const identifierSchema = z.string().min(1).max(240);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const capabilitySchema = z.string().min(1).max(120);

export const runtimeResourceKindSchema = z.enum([
  "skill",
  "mcp-server",
  "plugin",
  "runtime-adapter",
  "acp-agent"
]);

export const runtimeResourceScopeSchema = z.enum([
  "user",
  "workspace",
  "runtime",
  "registry",
  "unknown"
]);

export const runtimeProfileDescriptorSchema = z
  .object({
    id: identifierSchema,
    providerKind: z.string().min(1).max(100),
    protocolKind: z.string().min(1).max(100),
    displayName: z.string().min(1).max(160),
    executableSource: z.enum(["bundled", "path", "custom", "registry"]).nullable(),
    executableVersion: z.string().max(200).nullable(),
    protocolVersion: z.string().max(120).nullable(),
    compatibilityStatus: z.enum([
      "ready",
      "degraded",
      "unsupported",
      "unavailable"
    ]),
    homeIdentityHash: hashSchema.nullable(),
    authStatus: z.enum(["ready", "required", "unknown", "not-applicable"]),
    capabilities: z.array(capabilitySchema).max(200),
    publicReason: z.string().max(500).nullable()
  })
  .strict();

export const runtimeResourceDescriptorSchema = z
  .object({
    id: identifierSchema,
    runtimeProfileId: identifierSchema,
    kind: runtimeResourceKindSchema,
    externalId: z.string().min(1).max(300),
    displayName: z.string().min(1).max(200),
    description: z.string().max(1000).nullable(),
    scope: runtimeResourceScopeSchema,
    installed: z.boolean().nullable(),
    enabled: z.boolean().nullable(),
    version: z.string().max(200).nullable(),
    availableVersion: z.string().max(200).nullable(),
    updateStatus: z.enum([
      "current",
      "update-available",
      "unknown",
      "not-applicable"
    ]),
    authStatus: z.enum([
      "ready",
      "required",
      "unsupported",
      "unknown",
      "not-applicable"
    ]),
    compatibilityStatus: z.enum(["ready", "degraded", "blocked", "unknown"]),
    sourceKind: z.enum(["runtime-native", "tokenpilot-local", "acp-registry"]),
    sourceLabel: z.string().min(1).max(160),
    capabilities: z.array(capabilitySchema).max(200),
    publicReason: z.string().max(500).nullable(),
    fingerprint: hashSchema
  })
  .strict();

export const runtimeResourceInventoryDiagnosticSchema = z
  .object({
    source: z.string().min(1).max(160),
    status: z.enum(["ready", "degraded", "failed"]),
    code: z.string().max(120).nullable(),
    message: z.string().max(500).nullable()
  })
  .strict();

export const runtimeResourceInventoryProjectionSchema = z
  .object({
    profile: runtimeProfileDescriptorSchema,
    resources: z.array(runtimeResourceDescriptorSchema).max(1000),
    diagnostics: z.array(runtimeResourceInventoryDiagnosticSchema).max(50)
  })
  .strict();

export const runtimeResourceInventoryRequestSchema = z
  .object({
    runtimeProfileId: identifierSchema,
    workspaceId: identifierSchema.optional(),
    idempotencyKey: idempotencyKeySchema
  })
  .strict();

export const runtimeResourceInspectSchema = z
  .object({
    target: z.enum(["profiles", "snapshot", "resource"]),
    id: identifierSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.target !== "profiles" && !value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `${value.target} inspection requires id`
      });
    }
    if (value.target === "profiles" && value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "profiles inspection does not accept id"
      });
    }
  });

export const runtimeResourceSnapshotParamsSchema = z
  .object({ snapshotId: identifierSchema })
  .strict();

export const runtimeResourceItemParamsSchema = z
  .object({ resourceId: identifierSchema })
  .strict();

export type RuntimeResourceInventoryRequest = z.infer<
  typeof runtimeResourceInventoryRequestSchema
>;
export type RuntimeResourceInspectInput = z.infer<
  typeof runtimeResourceInspectSchema
>;

export type RuntimeProfileDescriptorContract = z.infer<
  typeof runtimeProfileDescriptorSchema
>;
export type RuntimeResourceDescriptorContract = z.infer<
  typeof runtimeResourceDescriptorSchema
>;
