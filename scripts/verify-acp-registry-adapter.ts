import assert from "node:assert/strict";

import {
  ACP_REGISTRY_URL,
  AcpRegistryAdapter
} from "../src/runtime/resources/acp-registry-adapter.ts";
import { runtimeResourceDescriptorSchema } from "../src/contracts/runtime-resources.ts";

let fetchCalls = 0;
const registryPayload = {
  version: "1.0.0",
  agents: [
    {
      id: "fixture-agent",
      name: "Fixture Agent",
      version: "1.2.3",
      description: "Fixture ACP agent",
      repository: "https://example.invalid/fixture-agent",
      license: "Apache-2.0",
      distribution: {
        npx: {
          package: "@fixture/agent@1.2.3",
          args: ["--acp", "--private-arg"],
          env: { FIXTURE_SECRET: "secret-auth-token" }
        },
        binary: {
          "darwin-aarch64": {
            archive: "https://example.invalid/fixture-agent.tar.gz",
            cmd: "./private-agent-command",
            sha256: "a".repeat(64)
          }
        }
      }
    },
    {
      id: "python-agent",
      name: "Python Agent",
      version: "0.4.0",
      description: "Fixture uvx agent",
      distribution: {
        uvx: {
          package: "python-agent==0.4.0"
        }
      }
    }
  ],
  extensions: [
    {
      id: "fixture-extension",
      name: "Fixture Extension",
      version: "0.1.0",
      description: "Fixture ACP extension",
      distribution: {
        npx: {
          package: "@fixture/extension@0.1.0",
          args: ["--private-extension-arg"]
        }
      }
    }
  ]
};

const adapter = new AcpRegistryAdapter({
  fetchImpl: async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), ACP_REGISTRY_URL);
    assert.equal(init?.redirect, "error");
    return new Response(JSON.stringify(registryPayload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  },
  now: () => 1_000,
  cacheTtlMs: 60_000
});

const profiles = await adapter.listProfiles();
assert.equal(profiles.length, 1);
const profile = profiles[0]!;
assert.equal(profile.providerKind, "acp-registry");
assert.equal(profile.protocolKind, "registry-v1");
assert.equal(profile.executableSource, "registry");
assert.equal(profile.executableVersion, "1.0.0");
assert.equal(profile.compatibilityStatus, "ready");

const first = await adapter.inventory({ profile });
const second = await adapter.inventory({ profile });
assert.equal(fetchCalls, 1, "ACP Registry catalog must honor in-memory TTL cache");
assert.equal(first.resources.length, 2, "ACP extensions must not be projected as agent resources");
assert.deepEqual(second.resources, first.resources);
assert.equal(first.diagnostics[0]?.status, "ready");

const fixture = first.resources.find((resource) => resource.externalId === "acp:fixture-agent");
assert.ok(fixture);
assert.equal(fixture.kind, "acp-agent");
assert.equal(fixture.scope, "registry");
assert.equal(fixture.installed, false);
assert.equal(fixture.enabled, null);
assert.equal(fixture.version, "1.2.3");
assert.deepEqual(fixture.capabilities, [
  "acp",
  "auth-supported",
  "distribution:binary",
  "distribution:npx",
  "platform:darwin-aarch64"
]);
for (const resource of first.resources) {
  assert.equal(runtimeResourceDescriptorSchema.safeParse(resource).success, true);
}

const publicJson = JSON.stringify(first);
for (const forbidden of [
  "@fixture/agent@1.2.3",
  "@fixture/extension@0.1.0",
  "python-agent==0.4.0",
  "--private-extension-arg",
  "--private-arg",
  "secret-auth-token",
  "private-agent-command",
  "fixture-agent.tar.gz",
  "FIXTURE_SECRET",
  "\"package\"",
  "\"archive\"",
  "\"cmd\"",
  "\"args\"",
  "\"env\""
]) {
  assert.equal(publicJson.includes(forbidden), false, `ACP catalog leaked ${forbidden}`);
}

await assert.rejects(
  () => adapter.inventory({ profile: { ...profile, providerKind: "codex" } }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_PROFILE_MISMATCH"
);

const invalidSchema = new AcpRegistryAdapter({
  fetchImpl: async () =>
    new Response(
      JSON.stringify({
        version: "1.0.0",
        agents: [
          {
            id: "bad agent",
            name: "Bad Agent",
            version: "1.0.0",
            description: "invalid id",
            distribution: { npx: { package: "bad" } }
          }
        ]
      }),
      { status: 200 }
    )
});
await assert.rejects(
  () => invalidSchema.listProfiles(),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ACP_REGISTRY_INVALID"
);

const unknownTopLevel = new AcpRegistryAdapter({
  fetchImpl: async () =>
    new Response(
      JSON.stringify({
        version: "1.0.0",
        agents: [],
        extensions: [],
        unexpected: true
      }),
      { status: 200 }
    )
});
await assert.rejects(
  () => unknownTopLevel.listProfiles(),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ACP_REGISTRY_INVALID"
);

const oversized = new AcpRegistryAdapter({
  fetchImpl: async () =>
    new Response("x".repeat(2 * 1024 * 1024 + 1), {
      status: 200,
      headers: { "content-length": String(2 * 1024 * 1024 + 1) }
    })
});
await assert.rejects(
  () => oversized.listProfiles(),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ACP_REGISTRY_TOO_LARGE"
);

let requestedUrl = "";
const redirect = new AcpRegistryAdapter({
  fetchImpl: async (input) => {
    requestedUrl = String(input);
    return new Response(null, {
      status: 302,
      headers: { location: "https://malicious.invalid/registry.json" }
    });
  }
});
await assert.rejects(() => redirect.listProfiles());
assert.equal(requestedUrl, ACP_REGISTRY_URL);

process.stdout.write("VERIFY_ACP_REGISTRY_ADAPTER_OK\n");
