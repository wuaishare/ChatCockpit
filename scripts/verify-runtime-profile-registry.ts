import assert from "node:assert/strict";

import type { RuntimeCapabilitySnapshot } from "../src/runtime/codex/runtime-adapter.ts";
import {
  CodexRuntimeProfileAdapter
} from "../src/runtime/resources/codex-runtime-profile-adapter.ts";
import {
  DownstreamRuntimeProfileAdapter
} from "../src/runtime/resources/downstream-runtime-profile-adapter.ts";
import {
  RuntimeProfileRegistry
} from "../src/runtime/resources/runtime-profile-registry.ts";

const codexCapability: RuntimeCapabilitySnapshot = {
  available: true,
  runtime: "codex-app-server",
  binarySource: "chatgpt-app",
  binaryVersion: "codex-cli fixture",
  protocolFamily: "app-server-v2",
  serverProtocolVersion: "2.0",
  stableMethods: ["thread/read", "thread/list"],
  experimentalApiEnabled: false,
  standaloneExecution: null
};

const codex = new CodexRuntimeProfileAdapter({
  capabilities: async () => codexCapability
});
const downstream = new DownstreamRuntimeProfileAdapter({
  probe: async () => [
    {
      executorId: "desktop-commander",
      displayName: "Desktop Commander",
      health: "ready",
      protocolFamily: "mcp-legacy-stdio",
      protocolVersion: "2025-03-26",
      serverName: "desktop-commander",
      serverVersion: "0.2.47",
      verifiedCapabilities: ["shell.exec", "files.read"],
      snapshotPath: "/private/runtime/downstream/desktop-commander.json"
    }
  ]
});
const registry = new RuntimeProfileRegistry([codex, downstream]);

const profiles = await registry.listProfiles();
assert.equal(profiles.length, 2);
const codexProfile = profiles.find((profile) => profile.providerKind === "codex");
const downstreamProfile = profiles.find(
  (profile) => profile.providerKind === "downstream-mcp"
);
assert.ok(codexProfile);
assert.ok(downstreamProfile);
assert.equal(codexProfile.executableSource, "bundled");
assert.equal(codexProfile.executableVersion, "codex-cli fixture");
assert.equal(codexProfile.compatibilityStatus, "ready");
assert.equal(downstreamProfile.displayName, "Desktop Commander");
assert.equal(downstreamProfile.executableVersion, "0.2.47");
assert.deepEqual(downstreamProfile.capabilities, ["files.read", "shell.exec"]);

const fetched = await registry.getProfile(codexProfile.id);
assert.deepEqual(fetched, codexProfile);

const publicJson = JSON.stringify(profiles);
for (const forbidden of [
  "/private/runtime/downstream/desktop-commander.json",
  "snapshotPath",
  "command",
  "args",
  "env"
]) {
  assert.equal(publicJson.includes(forbidden), false);
}

const unavailableCodex = new CodexRuntimeProfileAdapter({
  capabilities: async () => ({
    ...codexCapability,
    available: false,
    stableMethods: [],
    unavailableReason: "CODEX_AUTH_REQUIRED"
  })
});
const unavailable = (await unavailableCodex.listProfiles())[0];
assert.ok(unavailable);
assert.equal(unavailable.compatibilityStatus, "unavailable");
assert.equal(unavailable.authStatus, "required");

await assert.rejects(
  () => registry.getProfile("runtime_profile_missing"),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_PROFILE_NOT_FOUND"
);

process.stdout.write("VERIFY_RUNTIME_PROFILE_REGISTRY_OK\n");
