import assert from "node:assert/strict";

import {
  MCP_CONTINUITY_INVOKE_SUFFIXES,
  MCP_TOOL_SURFACE_CLASSIFICATION_COUNT,
  MCP_TOOL_SURFACE_DEFAULT_CORE_SUFFIXES,
  assertMcpToolSurfaceClassified,
  classifyMcpToolSurface,
  listMcpToolSurfaceClassifications,
  mcpToolSurfaceSuffix,
  selectMcpToolsForSurface
} from "../src/mcp/tool-surface.ts";

const classifications = listMcpToolSurfaceClassifications();

assert.equal(MCP_TOOL_SURFACE_CLASSIFICATION_COUNT, 94);
assert.equal(classifications.length, 94);
assert.equal(MCP_TOOL_SURFACE_DEFAULT_CORE_SUFFIXES.length, 20);

const byDisposition = Object.groupBy(
  classifications,
  (item) => item.disposition
);
assert.equal(byDisposition.core?.length, 20);
assert.equal(byDisposition["deferred-pack"]?.length, 64);
assert.equal(byDisposition.compatibility?.length, 7);
assert.equal(byDisposition["consolidation-candidate"]?.length, 3);

const byPack = Object.groupBy(
  classifications.filter((item) => item.pack !== null),
  (item) => item.pack as string
);
assert.equal(byPack["capability-routing"]?.length, 7);
assert.equal(byPack["host-admin"]?.length, 13);
assert.equal(byPack["device-admin"]?.length, 3);
assert.equal(byPack.workflow?.length, 8);
assert.equal(byPack["continuity-governance"]?.length, 15);
assert.equal(byPack["codex-native"]?.length, 18);
assert.equal(byPack["runtime-admin"]?.length, 8);
assert.equal(byPack.recovery?.length, 2);

assert.deepEqual(
  [...MCP_CONTINUITY_INVOKE_SUFFIXES].sort(),
  [
    "task.create",
    "task.get",
    "session.start",
    "session.get",
    "evidence.record",
    "task.submitReview",
    "task.complete"
  ].sort()
);
for (const suffix of MCP_CONTINUITY_INVOKE_SUFFIXES) {
  assert.deepEqual(classifyMcpToolSurface(`chatcockpit.${suffix}`), {
    disposition: "deferred-pack",
    pack: "continuity-governance"
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
    "codex.turn.start"
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
assert.equal(productionBaseline.length, 91);
assert.equal(
  productionBaseline.filter((item) => item.disposition === "core").length,
  20
);

const syntheticTools = classifications.map((item) => ({ name: `chatcockpit.${item.suffix}` }));
assert.equal(selectMcpToolsForSurface(syntheticTools, { kind: "core" }).length, 20);
assert.equal(selectMcpToolsForSurface(syntheticTools, { kind: "full" }).length, 94);
assert.equal(
  selectMcpToolsForSurface(syntheticTools, { kind: "pack", pack: "codex-native" }).length,
  31
);
assert.equal(
  selectMcpToolsForSurface(syntheticTools, { kind: "pack", pack: "capability-routing" }).length,
  27
);
assert.equal(
  selectMcpToolsForSurface(syntheticTools, { kind: "pack", pack: "codex-native" })
    .some((tool) => tool.name === "chatcockpit.codex.turn.start"),
  false
);

console.log("MCP_TOOL_SURFACE_VERIFICATION_OK");
