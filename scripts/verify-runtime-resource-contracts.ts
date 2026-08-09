import assert from "node:assert/strict";

import {
  buildRuntimeProfileId,
  buildRuntimeResourceId,
  canonicalRuntimeResourceJson,
  hashRuntimeResource,
  hashRuntimeResourceSnapshot
} from "../src/application/runtime-resource-hash.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor
} from "../src/application/runtime-resource-types.ts";
import {
  runtimeProfileDescriptorSchema,
  runtimeResourceDescriptorSchema
} from "../src/contracts/runtime-resources.ts";

const profile: RuntimeProfileDescriptor = {
  id: buildRuntimeProfileId({
    providerKind: "codex",
    protocolKind: "native-app-server",
    instanceIdentity: "default"
  }),
  providerKind: "codex",
  protocolKind: "native-app-server",
  displayName: "Codex",
  executableSource: "bundled",
  executableVersion: "codex-cli fixture",
  protocolVersion: "2.0",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources.skills", "resources.mcp"],
  publicReason: null
};

function resource(name: string): RuntimeResourceDescriptor {
  const externalId = `skill:${name}`;
  const id = buildRuntimeResourceId({
    runtimeProfileId: profile.id,
    kind: "skill",
    externalId
  });
  const base = {
    id,
    runtimeProfileId: profile.id,
    kind: "skill" as const,
    externalId,
    displayName: name,
    description: `${name} description`,
    scope: "user" as const,
    installed: true,
    enabled: true,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable" as const,
    authStatus: "not-applicable" as const,
    compatibilityStatus: "ready" as const,
    sourceKind: "runtime-native" as const,
    sourceLabel: "Codex",
    capabilities: ["instruction"],
    publicReason: null
  };
  return {
    ...base,
    fingerprint: hashRuntimeResource(base)
  };
}

const alpha = resource("alpha");
const beta = resource("beta");

assert.equal(
  canonicalRuntimeResourceJson({ b: 2, a: { y: true, x: "same" } }),
  canonicalRuntimeResourceJson({ a: { x: "same", y: true }, b: 2 })
);
assert.equal(
  hashRuntimeResource({ b: 2, a: 1 }),
  hashRuntimeResource({ a: 1, b: 2 })
);
assert.equal(
  hashRuntimeResourceSnapshot(profile, [alpha, beta]),
  hashRuntimeResourceSnapshot(profile, [beta, alpha]),
  "Snapshot fingerprint must be independent of resource ordering"
);
assert.notEqual(
  buildRuntimeResourceId({
    runtimeProfileId: profile.id,
    kind: "skill",
    externalId: "skill:alpha"
  }),
  buildRuntimeResourceId({
    runtimeProfileId: buildRuntimeProfileId({
      providerKind: "codex",
      protocolKind: "native-app-server",
      instanceIdentity: "work"
    }),
    kind: "skill",
    externalId: "skill:alpha"
  }),
  "Resource identity must be isolated by Runtime Profile"
);

assert.equal(runtimeProfileDescriptorSchema.safeParse(profile).success, true);
assert.equal(runtimeResourceDescriptorSchema.safeParse(alpha).success, true);

for (const forbidden of [
  { ...alpha, absolutePath: "/private/runtime/skill.md" },
  { ...alpha, env: { API_KEY: "secret" } },
  { ...alpha, rawConfig: { model: "private" } },
  { ...alpha, command: "private-runtime-command" }
]) {
  assert.equal(
    runtimeResourceDescriptorSchema.safeParse(forbidden).success,
    false,
    "Public Runtime Resource schema must reject private/raw fields"
  );
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_CONTRACTS_OK\n");
