import type { TokenPilotMcpTool } from "./tool-definition.js";

export const MCP_TOOL_SURFACE_PACKS = [
  "capability-routing",
  "host-admin",
  "device-admin",
  "workflow",
  "continuity-governance",
  "codex-native",
  "runtime-admin",
  "recovery"
] as const;

export type McpToolSurfacePack = (typeof MCP_TOOL_SURFACE_PACKS)[number];

export const MCP_TOOL_SURFACE_PACK_METADATA: Record<
  McpToolSurfacePack,
  { title: string; description: string }
> = {
  "capability-routing": { title: "Capability routing", description: "Advanced provider/capability discovery and governed invocation." },
  "host-admin": { title: "Host administration", description: "Host roots, files, commands, managed processes and governed mutations." },
  "device-admin": { title: "Device administration", description: "Remote device runtime status and explicit lifecycle operations." },
  workflow: { title: "Workflow", description: "Async jobs, development documents and workflow document binding." },
  "continuity-governance": { title: "Continuity governance", description: "Tasks, sessions, leases, handoffs, evidence and workspace snapshots." },
  "codex-native": { title: "Codex Native", description: "Explicit Codex Thread discovery, resume, native turns, approvals and events." },
  "runtime-admin": { title: "Runtime administration", description: "Runtime/resource inventory and governed resource mutations." },
  recovery: { title: "Recovery", description: "Explicit runtime recovery assessment and execution." }
};
export type McpToolSurfaceDisposition =
  | "core"
  | "deferred-pack"
  | "compatibility"
  | "consolidation-candidate";

export interface McpToolSurfaceClassification {
  disposition: McpToolSurfaceDisposition;
  pack: McpToolSurfacePack | null;
}

export const MCP_TOOL_SURFACE_DEFAULT_CORE_SUFFIXES = [
  "project.list",
  "project.get",
  "devices.targets.list",
  "files.list",
  "files.read",
  "files.readBatch",
  "files.write",
  "files.edit",
  "search.code",
  "shell.run",
  "workspace.exec",
  "workspace.process.read",
  "workspace.process.control",
  "git.status",
  "git.diff",
  "git.commit",
  "trajectory.read",
  "continuity.capsule",
  "tools.discover",
  "tools.invoke"
] as const;

const DEFERRED_BY_PACK = {
  "capability-routing": [
    "capabilities.read.invoke",
    "capabilities.mutation.prepare",
    "capabilities.mutation.inspect",
    "capabilities.mutation.execute"
  ],
  "host-admin": [
    "host.roots.list",
    "host.files.read",
    "host.mutation.prepare",
    "host.mutation.decide",
    "host.mutation.execute",
    "host.command.prepare",
    "host.command.decide",
    "host.command.execute",
    "host.process.prepare",
    "host.process.decide",
    "host.process.execute",
    "host.process.read",
    "host.process.list"
  ],
  "device-admin": [
    "devices.runtime.status",
    "devices.runtime.lifecycle.execute",
    "devices.runtime.operation.get"
  ],
  workflow: [
    "asyncJob.queue",
    "document.list",
    "document.get",
    "document.version.get",
    "document.create",
    "document.appendVersion",
    "document.updateStatus",
    "task.bindDocuments"
  ],
  "continuity-governance": [
    "continuity.importedContext.read",
    "workspace.snapshot",
    "task.create",
    "task.submitReview",
    "task.complete",
    "task.get",
    "session.start",
    "session.get",
    "lease.acquire",
    "lease.release",
    "handoff.prepare",
    "handoff.cancel",
    "handoff.fork",
    "handoff.accept",
    "evidence.record"
  ],
  "codex-native": [
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
  ],
  "runtime-admin": [
    "runtime.capabilities",
    "runtime.restart",
    "runtime.restart.read",
    "resources.inventory",
    "resources.inspect",
    "resources.mutation.prepare",
    "resources.mutation.inspect",
    "resources.mutation.execute"
  ],
  recovery: ["recovery.assess", "recovery.execute"]
} as const satisfies Record<McpToolSurfacePack, readonly string[]>;

const COMPATIBILITY_BY_PACK = {
  "codex-native": [
    "codex.session.bind",
    "codex.session.resume",
    "codex.session.fork",
    "codex.turn.start",
    "codex.turn.interrupt",
    "codex.approval.respond",
    "codex.events.read"
  ]
} as const satisfies Partial<Record<McpToolSurfacePack, readonly string[]>>;

const CONSOLIDATION_CANDIDATES_BY_PACK = {
  "capability-routing": [
    "direct.executors.list",
    "capabilities.list",
    "capabilities.inspect"
  ]
} as const satisfies Partial<Record<McpToolSurfacePack, readonly string[]>>;

const classifications = new Map<string, McpToolSurfaceClassification>();

function addClassification(
  suffix: string,
  classification: McpToolSurfaceClassification
): void {
  if (classifications.has(suffix)) {
    throw new Error(`Duplicate MCP tool surface classification: ${suffix}`);
  }
  classifications.set(suffix, classification);
}

for (const suffix of MCP_TOOL_SURFACE_DEFAULT_CORE_SUFFIXES) {
  addClassification(suffix, { disposition: "core", pack: null });
}
for (const [pack, suffixes] of Object.entries(DEFERRED_BY_PACK)) {
  for (const suffix of suffixes) {
    addClassification(suffix, {
      disposition: "deferred-pack",
      pack: pack as McpToolSurfacePack
    });
  }
}
for (const [pack, suffixes] of Object.entries(COMPATIBILITY_BY_PACK)) {
  for (const suffix of suffixes) {
    addClassification(suffix, {
      disposition: "compatibility",
      pack: pack as McpToolSurfacePack
    });
  }
}
for (const [pack, suffixes] of Object.entries(CONSOLIDATION_CANDIDATES_BY_PACK)) {
  for (const suffix of suffixes) {
    addClassification(suffix, {
      disposition: "consolidation-candidate",
      pack: pack as McpToolSurfacePack
    });
  }
}

export const MCP_TOOL_SURFACE_CLASSIFICATION_COUNT = classifications.size;

export function mcpToolSurfaceSuffix(name: string): string {
  if (name.startsWith("chatcockpit.")) return name.slice("chatcockpit.".length);
  if (name.startsWith("tokenpilot.")) return name.slice("tokenpilot.".length);
  return name;
}

export function classifyMcpToolSurface(
  name: string
): McpToolSurfaceClassification | null {
  return classifications.get(mcpToolSurfaceSuffix(name)) ?? null;
}

export function listMcpToolSurfaceClassifications(): Array<{
  suffix: string;
  disposition: McpToolSurfaceDisposition;
  pack: McpToolSurfacePack | null;
}> {
  return [...classifications.entries()]
    .map(([suffix, value]) => ({ suffix, ...value }))
    .sort((a, b) => a.suffix.localeCompare(b.suffix));
}

export function assertMcpToolSurfaceClassified(
  tools: readonly Pick<TokenPilotMcpTool, "name">[]
): void {
  const unknown = tools
    .map((tool) => tool.name)
    .filter((name) => classifyMcpToolSurface(name) === null)
    .sort();
  if (unknown.length > 0) {
    throw new Error(`Unclassified MCP tools: ${unknown.join(", ")}`);
  }
}

export function isDefaultCoreMcpTool(name: string): boolean {
  return classifyMcpToolSurface(name)?.disposition === "core";
}

export type McpToolSurfaceSelection =
  | { kind: "core" }
  | { kind: "full" }
  | { kind: "pack"; pack: McpToolSurfacePack };

export function selectMcpToolsForSurface<T extends Pick<TokenPilotMcpTool, "name">>(
  tools: readonly T[],
  selection: McpToolSurfaceSelection
): T[] {
  assertMcpToolSurfaceClassified(tools);
  if (selection.kind === "full") return [...tools];
  return tools.filter((tool) => {
    const classification = classifyMcpToolSurface(tool.name);
    if (!classification) return false;
    if (classification.disposition === "core") return true;
    if (selection.kind !== "pack" || classification.pack !== selection.pack) return false;
    return classification.disposition === "deferred-pack" || classification.disposition === "consolidation-candidate";
  });
}

export function mcpToolSurfacePackPath(pack: McpToolSurfacePack): string {
  return `/mcp/packs/${pack}`;
}
