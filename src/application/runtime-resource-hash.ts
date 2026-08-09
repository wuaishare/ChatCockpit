import { createHash } from "node:crypto";

import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "./runtime-resource-types.js";

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Runtime Resource canonical JSON requires finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === undefined ? null : canonicalize(entry)
    );
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        result[key] = canonicalize(entry);
      }
    }
    return result;
  }
  throw new TypeError(
    `Runtime Resource canonical JSON does not support ${typeof value}`
  );
}

export function canonicalRuntimeResourceJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashRuntimeResource(value: unknown): string {
  return createHash("sha256")
    .update(canonicalRuntimeResourceJson(value), "utf8")
    .digest("hex");
}

export function buildRuntimeProfileId(input: {
  providerKind: string;
  protocolKind: string;
  instanceIdentity: string;
}): string {
  const digest = hashRuntimeResource({
    providerKind: input.providerKind,
    protocolKind: input.protocolKind,
    instanceIdentity: input.instanceIdentity
  });
  return `runtime_profile_${digest.slice(0, 32)}`;
}

export function buildRuntimeResourceId(input: {
  runtimeProfileId: string;
  kind: string;
  externalId: string;
}): string {
  const digest = hashRuntimeResource({
    runtimeProfileId: input.runtimeProfileId,
    kind: input.kind,
    externalId: input.externalId
  });
  return `resource_${digest.slice(0, 32)}`;
}

function normalizedProfile(profile: RuntimeProfileDescriptor): RuntimeProfileDescriptor {
  return {
    ...profile,
    capabilities: [...profile.capabilities].sort()
  };
}

function normalizedResource(resource: RuntimeResourceDescriptor): RuntimeResourceDescriptor {
  return {
    ...resource,
    capabilities: [...resource.capabilities].sort()
  };
}

export function hashRuntimeResourceSnapshot(
  profile: RuntimeProfileDescriptor,
  resources: RuntimeResourceDescriptor[]
): string {
  return hashRuntimeResource({
    profile: normalizedProfile(profile),
    resources: [...resources]
      .map(normalizedResource)
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}
