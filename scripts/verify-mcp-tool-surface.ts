import assert from "node:assert/strict";

import {
  MCP_CODEX_INVOKE_SUFFIXES,
  MCP_CONTINUITY_INVOKE_SUFFIXES,
  MCP_CORE_GOVERNANCE_INVOKE_SUFFIXES,
  MCP_RUNTIME_INVOKE_SUFFIXES,
  MCP_TOOL_SURFACE_CLASSIFICATION_COUNT,
  MCP_TOOL_SURFACE_DEFAULT_CORE_SUFFIXES,
  assertMcpToolSurfaceClassified,
  classifyMcpToolSurface,
  listMcpToolSurfaceClassifications,
  mcpToolSurfaceSuffix,
  selectMcpToolsForSurface
} from "../src/mcp/tool-surface.ts";

const classifications = listMcpToolSurfaceClassifications();

assert.equal(MCP_TOOL_SURFACE_CLASSIFICATION_COUNT, 103);
assert.equal(classifications.length, 103);
assert.equal(MCP_TOOL_SURFACE_DEFAULT_CORE_SUFFIXES.length, 26);

const byDisposition = Object.groupBy(
  classifications,
  (item) => item.disposition
);
assert.equal(byDisposition.core?.length, 26);
assert.equal(byDisposition["deferred-pack"]?.length, 63);
assert.equal(byDisposition.compatibility?.length, 8);
assert.equal(byDisposition["consolidation-candidate"]?.length, 3);
assert.equal(byDisposition["operator-only"]?.length, 3);

const byPack = Object.groupBy(
  classifications.filter((item) => item.pack !== null),
  (item) => item.pack as string
);
assert.equal(byPack["capability-routing"]?.length, 7);
assert.equal(byPack["host-admin"]?.length, 10);
assert.equal(byPack["device-admin"]?.length, 3);
assert.equal(byPack.workflow?.length, 8);
assert.equal(byPack["continuity-governance"]?.length, 17);
assert.equal(byPack["codex-native"]?.length, 18);
assert.equal(byPack["runtime-admin"]?.length, 8);
assert.equal(byPack.recovery?.length, 2);

assert.deepEqual(
  [...MCP_CONTINUITY_INVOKE_SUFFIXES].sort(),
  [
    "continuity.importedContext.read",
    "continuity.capsule",
    "workspace.snapshot",
    "task.create",
    "task.get",
    "session.start",
    "session.finish",
    "session.get",
    "lease.acquire",
    "lease.release",
    "evidence.record",
    "handoff.prepare",
    "handoff.cancel",
    "handoff.fork",
    "handoff.accept",
    "task.submitReview",
    "task.complete"
  ].sort()
);
assert.deepEqual(
  [...MCP_RUNTIME_INVOKE_SUFFIXES].sort(),
  ["runtime.restart", "runtime.restart.read"].sort()
);
assert.deepEqual(
  [...MCP_CORE_GOVERNANCE_INVOKE_SUFFIXES].sort(),
  [...MCP_CONTINUITY_INVOKE_SUFFIXES, ...MCP_RUNTIME_INVOKE_SUFFIXES].sort()
);
assert.deepEqual(
  [...MCP_CODEX_INVOKE_SUFFIXES].sort(),
  [
    "codex.context.read",
    "codex.thread.list",
    "codex.account.status",
    "codex.thread.start",
    "codex.thread.resume",
    "codex.thread.fork",
    "codex.thread.turn.start",
    "codex.thread.turn.interrupt",
    "codex.thread.approvals.list",
    "codex.thread.events.read",
    "codex.thread.read"
  ].sort()
);
for (const suffix of MCP_CONTINUITY_INVOKE_SUFFIXES) {
  assert.deepEqual(classifyMcpToolSurface(`chatcockpit.${suffix}`), {
    disposition: "deferred-pack",
    pack: "continuity-governance"
  });
}
for (const suffix of MCP_RUNTIME_INVOKE_SUFFIXES) {
  assert.deepEqual(classifyMcpToolSurface(`chatcockpit.${suffix}`), {
    disposition: "deferred-pack",
    pack: "runtime-admin"
  });
}
for (const suffix of MCP_CODEX_INVOKE_SUFFIXES) {
  assert.deepEqual(classifyMcpToolSurface(`chatcockpit.${suffix}`), {
    disposition: "deferred-pack",
    pack: "codex-native"
  });
}

assert.deepEqual(
  classifications
    .filter((item) => item.disposition === "compatibility")
    .map((item) => item.suffix)
    .sort(),
  [
    "codex.approval.respond",
    "codex.events.read",
    "codex.session.bind",
    "codex.session.fork",
    "codex.session.resume",
    "codex.turn.interrupt",
    "codex.turn.start",
    "shell.run"
  ].sort()
);

assert.deepEqual(
  classifications
    .filter((item) => item.disposition === "consolidation-candidate")
    .map((item) => item.suffix)
    .sort(),
  [
    "capabilities.inspect",
    "capabilities.list",
    "direct.executors.list"
  ].sort()
);

for (const suffix of MCP_TOOL_SURFACE_DEFAULT_CORE_SUFFIXES) {
  assert.deepEqual(classifyMcpToolSurface(`chatcockpit.${suffix}`), {
    disposition: "core",
    pack: null
  });
  assert.deepEqual(classifyMcpToolSurface(`tokenpilot.${suffix}`), {
    disposition: "core",
    pack: null
  });
}

for (const name of [
  "chatcockpit.host.command.decide",
  "chatcockpit.host.mutation.decide",
  "chatcockpit.host.process.decide"
]) {
  assert.deepEqual(classifyMcpToolSurface(name), {
    disposition: "operator-only",
    pack: null
  });
}
assert.equal(mcpToolSurfaceSuffix("chatcockpit.files.read"), "files.read");
assert.equal(mcpToolSurfaceSuffix("tokenpilot.files.read"), "files.read");
assert.equal(classifyMcpToolSurface("chatcockpit.unknown.tool"), null);
assert.throws(
  () => assertMcpToolSurfaceClassified([{ name: "chatcockpit.unknown.tool" }]),
  /Unclassified MCP tools: chatcockpit\.unknown\.tool/
);

const productionBaseline = classifications.filter(
  (item) => ![
    "resources.mutation.prepare",
    "resources.mutation.inspect",
    "resources.mutation.execute"
  ].includes(item.suffix)
);
assert.equal(productionBaseline.length, 100);
assert.equal(
  productionBaseline.filter((item) => item.disposition === "core").length,
  26
);

const syntheticTools = classifications.map((item) => ({ name: `chatcockpit.${item.suffix}` }));
assert.equal(selectMcpToolsForSurface(syntheticTools, { kind: "core" }).length, 26);
const coreSurface = selectMcpToolsForSurface(syntheticTools, { kind: "core" });
assert.equal(coreSurface.some((tool) => tool.name === "chatcockpit.files.mutate"), true);
assert.equal(coreSurface.some((tool) => tool.name === "chatcockpit.git.branch"), true);
assert.equal(coreSurface.some((tool) => tool.name === "chatcockpit.devices.workspace.invoke"), true);
assert.equal(coreSurface.some((tool) => tool.name === "chatcockpit.tools.invoke"), true);
assert.equal(coreSurface.some((tool) => tool.name === "chatcockpit.shell.run"), false);
const fullSurface = selectMcpToolsForSurface(syntheticTools, { kind: "full" });
assert.equal(fullSurface.length, 100);
assert.equal(fullSurface.some((tool) => tool.name === "chatcockpit.shell.run"), true);
for (const name of [
  "chatcockpit.host.command.decide",
  "chatcockpit.host.mutation.decide",
  "chatcockpit.host.process.decide"
]) {
  assert.equal(fullSurface.some((tool) => tool.name === name), false);
}
assert.equal(
  selectMcpToolsForSurface(syntheticTools, { kind: "pack", pack: "codex-native" }).length,
  37
);
assert.equal(
  selectMcpToolsForSurface(syntheticTools, { kind: "pack", pack: "capability-routing" }).length,
  33
);
assert.equal(
  selectMcpToolsForSurface(syntheticTools, { kind: "pack", pack: "codex-native" })
    .some((tool) => tool.name === "chatcockpit.codex.turn.start"),
  false
);

console.log("MCP_TOOL_SURFACE_VERIFICATION_OK");
