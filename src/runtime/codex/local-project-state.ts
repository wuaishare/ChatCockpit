import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodexLocalProjectRootHint {
  sourceContextId: string;
  privatePath: string;
  label: string | null;
  observedAt: number | null;
  logicalProjectId: string | null;
  logicalProjectLabel: string | null;
  logicalProjectRootIndex: number | null;
  signalKind:
    | "native-project-root"
    | "native-saved-workspace-root"
    | "native-active-workspace-root"
    | "native-thread-workspace-root-hint";
}

export interface CodexLocalProjectStateSnapshot {
  available: boolean;
  inspectedContexts: number;
  roots: CodexLocalProjectRootHint[];
}

export interface CodexLocalProjectStateReading {
  readProjectRoots(): CodexLocalProjectStateSnapshot;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".codex");
}

export class CodexLocalProjectStateReader implements CodexLocalProjectStateReading {
  constructor(private readonly codexHome = defaultCodexHome()) {}

  readProjectRoots(): CodexLocalProjectStateSnapshot {
    const statePath = path.join(this.codexHome, ".codex-global-state.json");
    if (!fs.existsSync(statePath)) {
      return { available: false, inspectedContexts: 0, roots: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      return { available: false, inspectedContexts: 0, roots: [] };
    }
    const state = asRecord(parsed);
    const roots: CodexLocalProjectRootHint[] = [];
    let inspectedContexts = 0;

    for (const [projectKey, projectValue] of Object.entries(asRecord(state["local-projects"]))) {
      const project = asRecord(projectValue);
      const explicitProjectId = typeof project.id === "string" ? project.id.trim() : "";
      const projectId = explicitProjectId || projectKey;
      const label = typeof project.name === "string" && project.name.trim()
        ? project.name.trim()
        : null;
      const observedAt = finiteNumber(project.updatedAt);
      for (const [index, privatePath] of stringList(project.rootPaths).entries()) {
        inspectedContexts += 1;
        roots.push({
          sourceContextId: projectId,
          privatePath,
          label,
          observedAt,
          logicalProjectId: projectId,
          logicalProjectLabel: label,
          logicalProjectRootIndex: index,
          signalKind: "native-project-root"
        });
      }
    }

    for (const [index, privatePath] of stringList(state["electron-saved-workspace-roots"]).entries()) {
      inspectedContexts += 1;
      roots.push({
        sourceContextId: `saved-workspace-root-${index}`,
        privatePath,
        label: path.basename(privatePath) || null,
        observedAt: null,
        logicalProjectId: null,
        logicalProjectLabel: null,
        logicalProjectRootIndex: null,
        signalKind: "native-saved-workspace-root"
      });
    }

    for (const [index, privatePath] of stringList(state["active-workspace-roots"]).entries()) {
      inspectedContexts += 1;
      roots.push({
        sourceContextId: `active-workspace-root-${index}`,
        privatePath,
        label: path.basename(privatePath) || null,
        observedAt: null,
        logicalProjectId: null,
        logicalProjectLabel: null,
        logicalProjectRootIndex: null,
        signalKind: "native-active-workspace-root"
      });
    }

    for (const [threadId, privatePathValue] of Object.entries(asRecord(state["thread-workspace-root-hints"]))) {
      if (typeof privatePathValue !== "string" || !privatePathValue.trim()) continue;
      inspectedContexts += 1;
      roots.push({
        sourceContextId: threadId,
        privatePath: privatePathValue,
        label: path.basename(privatePathValue) || null,
        observedAt: null,
        logicalProjectId: null,
        logicalProjectLabel: null,
        logicalProjectRootIndex: null,
        signalKind: "native-thread-workspace-root-hint"
      });
    }

    return {
      available: true,
      inspectedContexts,
      roots
    };
  }
}
