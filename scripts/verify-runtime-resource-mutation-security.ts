import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function readTree(relativeRoot: string): string {
  const root = path.join(process.cwd(), relativeRoot);
  if (!fs.existsSync(root)) return "";
  const chunks: string[] = [];
  const visit = (entryPath: string): void => {
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entryPath).sort()) {
        visit(path.join(entryPath, name));
      }
      return;
    }
    if (/\.(?:ts|tsx|js|mjs|json|ya?ml|md|css)$/.test(entryPath)) {
      chunks.push(fs.readFileSync(entryPath, "utf8"));
    }
  };
  visit(root);
  return chunks.join("\n");
}

const skillAdapter = readFile("src/runtime/resources/codex-skill-mutation-adapter.ts");
const pluginAdapter = readFile("src/runtime/resources/codex-plugin-mutation-adapter.ts");
const service = readFile("src/application/runtime-resource-mutation-service.ts");
const reconciliation = readFile(
  "src/application/runtime-resource-mutation-reconciliation-service.ts"
);
const liveProof = readFile("scripts/probe-codex-skill-mutation-live.ts");
const mutationKernel = `${skillAdapter}\n${pluginAdapter}\n${service}`;

const skillProviderMethods = [
  ...skillAdapter.matchAll(/client\.request<unknown>\(\s*"([^"]+)"/g)
]
  .map((match) => match[1]!)
  .sort();
assert.deepEqual(skillProviderMethods, ["skills/config/write", "skills/list"]);

const pluginProviderMethods = [
  ...pluginAdapter.matchAll(/client\.request<unknown>\(\s*"([^"]+)"/g)
]
  .map((match) => match[1]!)
  .sort();
assert.deepEqual(pluginProviderMethods, [
  "plugin/install",
  "plugin/installed",
  "plugin/list",
  "plugin/uninstall"
]);

for (const forbiddenMethod of [
  "turn/start",
  "config/batchWrite",
  "marketplace/add",
  "marketplace/remove",
  "marketplace/upgrade",
  "mcpServer/oauth/login",
  "plugin/search"
]) {
  assert.equal(
    mutationKernel.includes(`"${forbiddenMethod}"`),
    false,
    `Phase 6B2B mutation kernel must not call ${forbiddenMethod}`
  );
}

assert.equal(
  reconciliation.includes("CodexSkillMutationAdapter"),
  false,
  "Reconciliation must not depend on the Skill provider mutation adapter"
);
assert.equal(
  reconciliation.includes("CodexPluginMutationAdapter"),
  false,
  "Reconciliation must not depend on the Plugin provider mutation adapter"
);
assert.equal(
  reconciliation.includes("CodexAppServerClient"),
  false,
  "Reconciliation must not open a provider mutation-capable client"
);
assert.equal(
  reconciliation.includes(".setEnabled("),
  false,
  "Reconciliation must never replay a Skill mutation"
);
assert.equal(
  reconciliation.includes(".install("),
  false,
  "Reconciliation must never replay a Plugin install"
);
assert.equal(
  reconciliation.includes(".uninstall("),
  false,
  "Reconciliation must never replay a Plugin uninstall"
);

assert.equal(
  liveProof.includes("TOKENPILOT_CODEX_SKILL_MUTATION_PROOF"),
  true,
  "Real Codex Skill mutation proof must require an explicit opt-in environment variable"
);
assert.equal(
  liveProof.includes("I_UNDERSTAND_REVERSIBLE_MUTATION"),
  true,
  "Real Codex Skill mutation proof must require the explicit reversible-mutation acknowledgement"
);
assert.equal(
  liveProof.includes("Refusing real Codex Skill mutation without"),
  true,
  "Real Codex Skill mutation proof must fail closed when opt-in is absent"
);
assert.equal(
  liveProof.includes("new RuntimeResourceMutationService("),
  true,
  "Real Codex Skill mutation proof must execute through the governed mutation service"
);
assert.equal(
  liveProof.includes("governedTransition({"),
  true,
  "Real Codex Skill mutation proof must use the governed transition lifecycle"
);
assert.equal(
  liveProof.includes(".setEnabled("),
  false,
  "Real Codex Skill mutation proof must not call the provider mutation adapter directly"
);
assert.equal(
  /\.request(?:<[^>]+>)?\(\s*["']skills\/config\/write["']/.test(liveProof),
  false,
  "Real Codex Skill mutation proof must not issue provider-specific write requests directly"
);
assert.equal(
  liveProof.includes("operationFor(original.enabled)"),
  true,
  "Real Codex Skill mutation proof must restore the original Skill state through a new governed intent"
);

const externalSurfaces = [
  "src/server",
  "src/mcp",
  "openapi",
  "web/src"
]
  .map(readTree)
  .join("\n");
for (const forbiddenSurface of [
  "/api/resources/mutations",
  "tokenpilot.resources.mutation.prepare",
  "tokenpilot.resources.mutation.decide",
  "tokenpilot.resources.mutation.execute",
  "tokenpilot.resources.mutation.reconcile"
]) {
  assert.equal(
    externalSurfaces.includes(forbiddenSurface),
    false,
    `Phase 6B2B internal kernel must not expose ${forbiddenSurface}`
  );
}

const repositorySource = readFile(
  "src/continuity/repositories/runtime-resource-mutation-repository.ts"
);
const persistenceAndPublicMutationLayer = `${service}\n${repositorySource}`;
for (const publicLeak of [
  "authorizationUrl",
  "rawConfig",
  "marketplacePath",
  "remoteMarketplaceName",
  "installUrl"
]) {
  assert.equal(
    persistenceAndPublicMutationLayer.includes(publicLeak),
    false,
    `Mutation persistence/public layer must not persist or project ${publicLeak}`
  );
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_SECURITY_OK\n");
