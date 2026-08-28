import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_DISCOVERY_MAX_CHILDREN = 200;
export const WORKSPACE_DISCOVERY_MAX_CANDIDATES = 100;

export interface WorkspaceDiscoveryCandidate {
  candidateId: string;
  name: string;
  suggestedRepoId: string;
  git: {
    repository: true;
    branch: string | null;
    headCommit: string | null;
    dirty: boolean;
  };
  registration: "registered" | "unregistered";
  existingRepoId: string | null;
}

export interface WorkspaceDiscoveryPrivateCandidate extends WorkspaceDiscoveryCandidate {
  privatePath: string;
}

export interface WorkspaceDiscoveryScan {
  inspectedEntries: number;
  truncated: boolean;
  candidates: WorkspaceDiscoveryPrivateCandidate[];
}

function canonical(input: string): string {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function runGit(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 2_000,
    maxBuffer: 128 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? "").trim();
}

export function workspaceDiscoveryRootId(root: string): string {
  return `workspace_root_${createHash("sha256").update(canonical(root)).digest("hex").slice(0, 24)}`;
}

export function suggestedWorkspaceRepoId(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return normalized || "workspace";
}

export function workspaceDiscoveryCandidateId(input: {
  configRevision: string;
  canonicalRoot: string;
  canonicalChild: string;
}): string {
  return `workspace_candidate_${createHash("sha256")
    .update(`${input.configRevision}\0${input.canonicalRoot}\0${input.canonicalChild}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function gitMetadataForRoot(candidatePath: string): WorkspaceDiscoveryPrivateCandidate["git"] | null {
  const status = runGit(candidatePath, ["status", "--porcelain=v2", "--branch"]);
  if (status === null) return null;
  const head = runGit(candidatePath, ["rev-parse", "HEAD"]);
  const branchLine = status
    .split(/\r?\n/)
    .find((line) => line.startsWith("# branch.head "));
  const rawBranch = branchLine?.slice("# branch.head ".length).trim() ?? "";
  const branch = !rawBranch || rawBranch === "(detached)" ? null : rawBranch;
  const dirty = status
    .split(/\r?\n/)
    .some((line) => line.length > 0 && !line.startsWith("# "));

  return {
    repository: true,
    branch,
    headCommit: head || null,
    dirty
  };
}

export interface ResolvedProjectRootGitRoot {
  privatePath: string;
  git: WorkspaceDiscoveryPrivateCandidate["git"];
}

export function resolveProjectRootGitRoot(candidatePath: string): ResolvedProjectRootGitRoot | null {
  const topLevel = runGit(candidatePath, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) return null;
  const privatePath = canonical(topLevel);
  const git = gitMetadataForRoot(privatePath);
  return git ? { privatePath, git } : null;
}

/** @deprecated Use resolveProjectRootGitRoot for root discovery. */
export const resolveWorkspaceGitRoot = resolveProjectRootGitRoot;

export function inspectWorkspaceGitRoot(
  candidatePath: string
): WorkspaceDiscoveryPrivateCandidate["git"] | null {
  const resolved = resolveProjectRootGitRoot(candidatePath);
  if (!resolved || resolved.privatePath !== canonical(candidatePath)) return null;
  return resolved.git;
}

export function scanWorkspaceDiscoveryRoot(input: {
  root: string;
  configRevision: string;
  repoMappings: Record<string, { path: string }>;
}): WorkspaceDiscoveryScan {
  const canonicalRoot = canonical(input.root);
  const registeredByPath = new Map(
    Object.entries(input.repoMappings).map(([repoId, mapping]) => [canonical(mapping.path), repoId])
  );

  const entries = fs
    .readdirSync(canonicalRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const inspected = entries.slice(0, WORKSPACE_DISCOVERY_MAX_CHILDREN);
  const candidates: WorkspaceDiscoveryPrivateCandidate[] = [];

  for (const entry of inspected) {
    if (candidates.length >= WORKSPACE_DISCOVERY_MAX_CANDIDATES) break;
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const child = path.join(canonicalRoot, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(child);
    } catch {
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;

    const canonicalChild = canonical(child);
    if (path.dirname(canonicalChild) !== canonicalRoot) continue;
    const git = inspectWorkspaceGitRoot(canonicalChild);
    if (!git) continue;

    const existingRepoId = registeredByPath.get(canonicalChild) ?? null;
    candidates.push({
      candidateId: workspaceDiscoveryCandidateId({
        configRevision: input.configRevision,
        canonicalRoot,
        canonicalChild
      }),
      name: entry.name,
      suggestedRepoId: suggestedWorkspaceRepoId(entry.name),
      git,
      registration: existingRepoId ? "registered" : "unregistered",
      existingRepoId,
      privatePath: canonicalChild
    });
  }

  return {
    inspectedEntries: inspected.length,
    truncated: entries.length > WORKSPACE_DISCOVERY_MAX_CHILDREN || candidates.length >= WORKSPACE_DISCOVERY_MAX_CANDIDATES,
    candidates
  };
}
