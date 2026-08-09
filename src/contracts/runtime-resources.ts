import { z } from "zod";

const identifierSchema = z.string().min(1).max(240);
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

export type RuntimeProfileDescriptorContract = z.infer<
  typeof runtimeProfileDescriptorSchema
>;
export type RuntimeResourceDescriptorContract = z.infer<
  typeof runtimeResourceDescriptorSchema
>;
