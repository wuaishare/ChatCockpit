import assert from "node:assert/strict";
import fs from "node:fs";

import { runCodexPluginMutationMcpLiveProof } from "./probe-codex-plugin-mutation-mcp-live.ts";

const OPT_IN_ENV = "CHATCOCKPIT_CODEX_PLUGIN_MCP_MUTATION_PROOF";
const OPT_IN_VALUE = "I_UNDERSTAND_REVERSIBLE_MCP_OPERATOR_MUTATION";

const proofSource = fs.readFileSync(
  new URL("./probe-codex-plugin-mutation-mcp-live.ts", import.meta.url),
  "utf8"
);
const harnessSource = fs.readFileSync(
  new URL("./test-support/runtime-resource-rest-live.ts", import.meta.url),
  "utf8"
);
const mcpToolSource = fs.readFileSync(
  new URL("../src/mcp/tools/runtime-resource-mutations.ts", import.meta.url),
  "utf8"
);

assert.equal(proofSource.includes(`const OPT_IN_ENV = "${OPT_IN_ENV}"`), true);
assert.equal(proofSource.includes(`const OPT_IN_VALUE = "${OPT_IN_VALUE}"`), true);
const proofFunctionSource = proofSource.match(
  /export async function runCodexPluginMutationMcpLiveProof[\s\S]*?(?=\nfunction isMainModule)/
)?.[0];
assert.ok(proofFunctionSource, "Real MCP/operator proof function must remain inspectable");
assert.equal(
  proofFunctionSource.indexOf("process.env[OPT_IN_ENV]") <
    proofFunctionSource.indexOf("runCodexPluginInventoryLiveProof"),
  true,
  "Real MCP/operator proof must fail closed before starting live baseline work"
);

assert.equal(proofSource.includes('"chatcockpit.resources.mutation.prepare"'), true);
assert.equal(proofSource.includes('"chatcockpit.resources.mutation.execute"'), true);
assert.equal(proofSource.includes('"chatcockpit.resources.mutation.inspect"'), true);
assert.equal(proofSource.includes('"chatcockpit.resources.mutation.decide"'), false);
assert.equal(mcpToolSource.includes('name: "chatcockpit.resources.mutation.decide"'), false);
assert.equal(mcpToolSource.includes('name: "chatcockpit.resources.mutation.reconcile"'), false);

const transitionSource = proofSource.match(
  /async function governedTransition[\s\S]*?(?=\nexport async function runCodexPluginMutationMcpLiveProof)/
)?.[0];
assert.ok(transitionSource, "Governed MCP/operator transition helper must remain inspectable");
assert.equal(
  transitionSource.includes('harness.mcp<{') &&
    transitionSource.includes('"chatcockpit.resources.mutation.prepare"'),
  true,
  "Prepare must traverse the real MCP tool contract"
);
assert.equal(
  transitionSource.includes('harness.rest<{') &&
    transitionSource.includes('"POST", "/api/resources/mutations/decision"'),
  true,
  "Approval decision must traverse the operator REST contract"
);
assert.equal(
  transitionSource.includes('"chatcockpit.resources.mutation.execute"'),
  true,
  "Execute must traverse the real MCP tool contract"
);
assert.equal(
  transitionSource.includes('prepared.approval.requestedActor?.type, "remote-mcp"'),
  true
);
assert.equal(
  transitionSource.includes('decision.approval.decidedActor?.type, "rest-api"'),
  true
);
assert.equal(
  transitionSource.includes('executed.execution.executedActor?.type, "remote-mcp"'),
  true
);

assert.equal(
  proofSource.includes("await governedTransition(\n              harness,\n              currentResource"),
  true,
  "Cleanup must restore state through a new governed MCP/operator intent"
);
assert.equal(
  proofSource.includes("plugin/install") && proofSource.includes("plugin/uninstall"),
  true
);
for (const forbiddenDirectCall of [
  '.request<unknown>("plugin/install"',
  '.request<unknown>("plugin/uninstall"',
  'client.request("plugin/install"',
  'client.request("plugin/uninstall"'
]) {
  assert.equal(
    proofSource.includes(forbiddenDirectCall),
    false,
    "Real MCP/operator proof must not issue provider mutation RPCs directly"
  );
}
for (const forbiddenProviderMethod of ["turn/start", "plugin/search", "marketplace/"]) {
  assert.equal(
    proofSource.includes(`methods.has("${forbiddenProviderMethod}")`) ||
      proofSource.includes(`startsWith("${forbiddenProviderMethod}")`) ||
      proofSource.includes(`entry === "${forbiddenProviderMethod}"`),
    true,
    `Real MCP/operator proof must explicitly guard ${forbiddenProviderMethod}`
  );
}

assert.equal(harnessSource.includes("async <T>(\n      toolName: string"), true);
assert.equal(harnessSource.includes('method: "tools/call"'), true);
assert.equal(harnessSource.includes("structuredContent"), true);

const previous = process.env[OPT_IN_ENV];
delete process.env[OPT_IN_ENV];
try {
  await assert.rejects(
    () => runCodexPluginMutationMcpLiveProof(),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes(`${OPT_IN_ENV}=${OPT_IN_VALUE}`)
  );
} finally {
  if (previous === undefined) delete process.env[OPT_IN_ENV];
  else process.env[OPT_IN_ENV] = previous;
}

process.stdout.write("VERIFY_CODEX_PLUGIN_MUTATION_MCP_LIVE_HARNESS_OK\n");
