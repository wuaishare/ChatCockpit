import path from "node:path";

import { productIdentityForKey } from "./product-identity.js";
import type { TokenPilotPaths } from "../types.js";

function normalizeRelative(value: string): string {
  return value.split(path.sep).join("/").replace(/^\.\/+/, "");
}

function relativeInside(root: string, candidate: string): string | null {
  const relative = path.relative(root, candidate);
  if (!relative) return "";
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  return normalizeRelative(relative);
}

export function logicalPathForFile(
  paths: TokenPilotPaths,
  filePath: string,
  repoRoot: string = paths.repoRoot
): string {
  const stateRelative = relativeInside(paths.stateRoot, filePath);
  if (stateRelative !== null) {
    const stateDirName = productIdentityForKey(paths.productIdentity).stateDirName;
    return stateRelative ? `${stateDirName}/${stateRelative}` : stateDirName;
  }

  const repoRelative = relativeInside(repoRoot, filePath);
  if (repoRelative !== null) return repoRelative;

  throw new Error("Artifact path is outside both the product state root and mapped repository root");
}

export function resolveLogicalPath(
  paths: TokenPilotPaths,
  repoRoot: string,
  logicalPath: string
): string {
  const normalized = path.posix.normalize(logicalPath).replace(/^\.\/+/, "");
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\\")
  ) {
    throw new Error("Logical path must stay within a known root");
  }

  const stateDirName = productIdentityForKey(paths.productIdentity).stateDirName;
  if (normalized === stateDirName) return paths.stateRoot;
  if (normalized.startsWith(`${stateDirName}/`)) {
    const relative = normalized.slice(stateDirName.length + 1);
    return path.join(paths.stateRoot, ...relative.split("/"));
  }

  return path.join(repoRoot, ...normalized.split("/"));
}
