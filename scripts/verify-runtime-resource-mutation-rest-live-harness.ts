import assert from "node:assert/strict";
import fs from "node:fs";

import { runCodexPluginMutationRestLiveProof } from "./probe-codex-plugin-mutation-rest-live.ts";
import { runCodexSkillMutationRestLiveProof } from "./probe-codex-skill-mutation-rest-live.ts";

function read(relativePath: string): string {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const helper = read("scripts/test-support/runtime-resource-rest-live.ts");
const skillInventoryProof = read("scripts/probe-codex-skill-inventory-live.ts");
const skillProof = read("scripts/probe-codex-skill-mutation-rest-live.ts");
const pluginProof = read("scripts/probe-codex-plugin-mutation-rest-live.ts");

assert.match(helper, /buildServer\(/);
assert.match(helper, /CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED = "true"/);
assert.match(helper, /providerMethodCalls/);
assert.match(helper, /TrackingAppServerClient/);
assert.match(helper, /authorization:/);
assert.match(helper, /API_TOKEN/);

for (const route of [
  "/api/resources/inventory",
  "/api/resources/mutations/prepare",
  "/api/resources/mutations/decision",
  "/api/resources/mutations/execute",
  "/api/resources/mutations/activity"
]) {
  assert.equal(
    `${skillProof}\n${pluginProof}`.includes(route),
    true,
    `REST live proofs must exercise ${route}`
  );
}

for (const source of [skillProof, pluginProof]) {
  assert.equal(
    source.includes("providerMethodCalls"),
    true,
    "REST live proof must count ordered provider method calls"
  );
  assert.equal(
    source.includes("expectedSnapshotId: snapshotId"),
    true,
    "REST live proof must bind Prepare to the exact reviewed inventory snapshot"
  );
  assert.equal(
    source.includes("replayed, true"),
    true,
    "REST live proof must verify execute idempotency replay"
  );
  assert.equal(
    source.includes("requestedActor?.type, \"rest-api\"") &&
      source.includes("decidedActor?.type, \"rest-api\"") &&
      source.includes("executedActor?.type, \"rest-api\""),
    true,
    "REST live proof must verify persisted rest-api actor provenance"
  );
  assert.equal(
    source.includes("chatcockpit.resources.mutation."),
    false,
    "6B2C2 live proof must not depend on MCP mutation tools"
  );
  assert.equal(
    /\.request(?:<[^>]+>)?\(/.test(source),
    false,
    "REST live proof must not issue provider RPC directly"
  );
}

assert.equal(skillInventoryProof.includes("skills/list"), true);
assert.equal(skillInventoryProof.includes("skills/config/write"), false);
assert.equal(skillInventoryProof.includes("/api/resources/mutations/"), false);
assert.equal(skillInventoryProof.includes("turn/start"), false);
assert.equal(
  skillInventoryProof.includes("left.externalId.localeCompare(right.externalId)"),
  true,
  "Skill-only safety baseline must select the same deterministic candidate as the REST proof"
);

assert.match(skillProof, /CHATCOCKPIT_CODEX_SKILL_REST_MUTATION_PROOF/);
assert.match(skillProof, /I_UNDERSTAND_REVERSIBLE_REST_MUTATION/);
assert.match(skillProof, /Refusing real Codex Skill REST mutation without/);
assert.equal(skillProof.includes("skills/config/write"), true);
assert.equal(skillProof.includes("providerWriteCount: 2"), true);
assert.equal(
  skillProof.includes("operationFor(original.enabled)"),
  true,
  "Skill REST proof must restore original state through a new governed intent"
);

assert.match(pluginProof, /CHATCOCKPIT_CODEX_PLUGIN_REST_MUTATION_PROOF/);
assert.match(pluginProof, /I_UNDERSTAND_REVERSIBLE_PLUGIN_REST_MUTATION/);
assert.match(pluginProof, /Refusing real Codex Plugin REST mutation without/);
assert.equal(pluginProof.includes('"plugin.install"'), true);
assert.equal(pluginProof.includes('"plugin.uninstall"'), true);
assert.equal(pluginProof.includes("installWriteCount: 1"), true);
assert.equal(pluginProof.includes("uninstallWriteCount: 1"), true);
assert.equal(
  pluginProof.includes("runCodexPluginInventoryLiveProof"),
  true,
  "Plugin REST proof must verify read-only installed coverage before and after mutation"
);

const previousSkillOptIn = process.env.CHATCOCKPIT_CODEX_SKILL_REST_MUTATION_PROOF;
const previousPluginOptIn = process.env.CHATCOCKPIT_CODEX_PLUGIN_REST_MUTATION_PROOF;
delete process.env.CHATCOCKPIT_CODEX_SKILL_REST_MUTATION_PROOF;
delete process.env.CHATCOCKPIT_CODEX_PLUGIN_REST_MUTATION_PROOF;
try {
  await assert.rejects(
    () => runCodexSkillMutationRestLiveProof(),
    /Refusing real Codex Skill REST mutation without/
  );
  await assert.rejects(
    () => runCodexPluginMutationRestLiveProof(),
    /Refusing real Codex Plugin REST mutation without/
  );
} finally {
  if (previousSkillOptIn === undefined) {
    delete process.env.CHATCOCKPIT_CODEX_SKILL_REST_MUTATION_PROOF;
  } else {
    process.env.CHATCOCKPIT_CODEX_SKILL_REST_MUTATION_PROOF = previousSkillOptIn;
  }
  if (previousPluginOptIn === undefined) {
    delete process.env.CHATCOCKPIT_CODEX_PLUGIN_REST_MUTATION_PROOF;
  } else {
    process.env.CHATCOCKPIT_CODEX_PLUGIN_REST_MUTATION_PROOF = previousPluginOptIn;
  }
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_REST_LIVE_HARNESS_OK\n");
