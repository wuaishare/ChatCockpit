import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const runtimeNodeArtifactSchema = z
  .object({
    artifact: z.string().min(1),
    sha256: sha256Schema
  })
  .strict();

export const nodeRuntimeInputManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    platform: z.literal("darwin"),
    architectures: z
      .object({
        arm64: runtimeNodeArtifactSchema,
        x64: runtimeNodeArtifactSchema
      })
      .strict()
  })
  .strict();

export type RuntimeNodeArtifact = z.infer<typeof runtimeNodeArtifactSchema>;
export type NodeRuntimeInputManifest = z.infer<typeof nodeRuntimeInputManifestSchema>;
export type NodeRuntimeArchitecture = keyof NodeRuntimeInputManifest["architectures"];

export function parseNodeRuntimeInputManifest(input: unknown): NodeRuntimeInputManifest {
  return nodeRuntimeInputManifestSchema.parse(input);
}
