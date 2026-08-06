import path from "node:path";

import { isPathInsideRoot } from "../../core/path-guards.js";
import type { PrivateWorkspaceRecord } from "../../continuity/types.js";
import type {
  RuntimeThreadProjection,
  RuntimeThreadStatus
} from "./runtime-adapter.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceKind(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  for (const key of ["kind", "type", "sourceKind"] as const) {
    const candidate = stringOrNull(record[key]);
    if (candidate) return candidate;
  }
  const entries = Object.keys(record);
  return entries.length === 1 ? entries[0] : null;
}

function threadStatus(value: unknown): RuntimeThreadStatus {
  if (typeof value === "string" && value.trim()) {
    return { type: value.trim() };
  }
  const record = asRecord(value);
  const type = stringOrNull(record.type) ?? "notLoaded";
  const activeFlags = Array.isArray(record.activeFlags)
    ? record.activeFlags.filter((item): item is string => typeof item === "string")
    : undefined;
  return activeFlags ? { type, activeFlags } : { type };
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value);
}

export function resolveThreadWorkspace(
  cwd: string | null,
  workspaces: PrivateWorkspaceRecord[]
): PrivateWorkspaceRecord | null {
  if (!cwd || !path.isAbsolute(cwd)) {
    return null;
  }

  const target = normalizeComparablePath(cwd);
  return (
    workspaces
      .filter((workspace) => isPathInsideRoot(workspace.privatePath, target))
      .sort(
        (left, right) =>
          normalizeComparablePath(right.privatePath).length -
          normalizeComparablePath(left.privatePath).length
      )[0] ?? null
  );
}

export function projectCodexThread(
  value: unknown,
  workspaces: PrivateWorkspaceRecord[]
): RuntimeThreadProjection {
  const thread = asRecord(value);
  const id = stringOrNull(thread.id);
  if (!id) {
    throw new Error("Codex thread response is missing an id");
  }

  const cwd = stringOrNull(thread.cwd);
  const workspace = resolveThreadWorkspace(cwd, workspaces);

  return {
    id,
    preview: stringOrNull(thread.preview) ?? "",
    modelProvider: stringOrNull(thread.modelProvider),
    createdAt: numberOrNull(thread.createdAt),
    updatedAt: numberOrNull(thread.updatedAt),
    recencyAt: numberOrNull(thread.recencyAt),
    sourceKind: stringOrNull(thread.sourceKind) ?? sourceKind(thread.source),
    status: threadStatus(thread.status),
    projectId: workspace?.projectId ?? null,
    workspaceId: workspace?.id ?? null,
    repoId: workspace?.repoId ?? null,
    parentThreadId: stringOrNull(thread.parentThreadId),
    agentNickname: stringOrNull(thread.agentNickname),
    agentRole: stringOrNull(thread.agentRole)
  };
}
