import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveUserConfigPathForPaths } from "../core/config.js";
import { isPathInsideRoot } from "../core/path-guards.js";
import type { TokenPilotPaths, TokenPilotProjectRootKind } from "../types.js";
import { WorkspaceConfigStore } from "../workspaces/workspace-config-store.js";
import {
  inspectWorkspaceGitRoot,
  resolveProjectRootGitRoot,
  suggestedWorkspaceRepoId
} from "../workspaces/workspace-discovery.js";
import type { OperationContext } from "./operation-context.js";
import type {
  ProjectRootDiscoveryObservation,
  ProjectRootDiscoverySource
} from "./project-root-discovery-source.js";
import { ServiceError } from "./service-error.js";

const MAX_PROJECT_ROOT_CANDIDATES = 100;

export type ProjectRootDiscoverySourceStatus = "ready" | "unavailable";

export interface ProjectRootDiscoverySourceSnapshot {
  id: string;
  displayName: string;
  status: ProjectRootDiscoverySourceStatus;
  inspectedContexts: number;
  truncated: boolean;
  errorCode: string | null;
}

export interface ProjectRootDiscoveryCandidateSource {
  sourceId: string;
  sourceDisplayName: string;
  signalCount: number;
  signalKinds: string[];
  latestObservedAt: number | null;
  latestLabel: string | null;
}

export interface ProjectRootDiscoveryCandidate {
  candidateId: string;
  name: string;
  kind: TokenPilotProjectRootKind;
  privatePath: string;
  registration: "registered" | "unregistered";
  existingRootId: string | null;
  existingProjectSlug: string | null;
  executionRepoIds: string[];
  suggestedRepoId: string | null;
  latestObservedAt: number | null;
  sources: ProjectRootDiscoveryCandidateSource[];
  git: {
    repository: true;
    branch: string | null;
    headCommit: string | null;
    dirty: boolean;
  } | null;
}

export interface ProjectRootDiscoveryGroup {
  groupId: string;
  name: string;
  sourceId: string;
  sourceDisplayName: string;
  candidateIds: string[];
  registration: "registered" | "partially-registered" | "unregistered";
  existingProjectSlug: string | null;
  latestObservedAt: number | null;
}

export interface ProjectRootDiscoveryResult {
  configRevision: string;
  sources: ProjectRootDiscoverySourceSnapshot[];
  groups: ProjectRootDiscoveryGroup[];
  candidates: ProjectRootDiscoveryCandidate[];
  truncated: boolean;
}

interface AggregatedSource {
  sourceId: string;
  sourceDisplayName: string;
  signalCount: number;
  signalKinds: Set<string>;
  latestObservedAt: number | null;
  latestLabel: string | null;
}

interface AggregatedCandidate {
  kind: TokenPilotProjectRootKind;
  git: ProjectRootDiscoveryCandidate["git"];
  sources: Map<string, AggregatedSource>;
}

interface AggregatedProjectGroup {
  sourceId: string;
  sourceDisplayName: string;
  nativeProjectId: string;
  name: string;
  latestObservedAt: number | null;
  rootOrderByPath: Map<string, number>;
}

interface ResolvedObservationRoot {
  privatePath: string;
  kind: TokenPilotProjectRootKind;
  git: ProjectRootDiscoveryCandidate["git"];
}

function canonicalExistingDirectory(input: string): string | null {
  const resolved = path.resolve(input);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return null;
  }
}

function candidateId(privatePath: string): string {
  return `project_root_candidate_${createHash("sha256")
    .update(privatePath)
    .digest("hex")
    .slice(0, 32)}`;
}

function groupId(sourceId: string, nativeProjectId: string): string {
  return `project_root_group_${createHash("sha256")
    .update(`${sourceId}\0${nativeProjectId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function sourceErrorCode(error: unknown): string {
  if (error instanceof ServiceError) return error.code;
  return "PROJECT_ROOT_DISCOVERY_SOURCE_UNAVAILABLE";
}

function latestObservedAt(sources: ProjectRootDiscoveryCandidateSource[]): number | null {
  let latest: number | null = null;
  for (const source of sources) {
    if (source.latestObservedAt === null) continue;
    latest = latest === null ? source.latestObservedAt : Math.max(latest, source.latestObservedAt);
  }
  return latest;
}

function resolveObservationRoot(
  observation: ProjectRootDiscoveryObservation
): ResolvedObservationRoot | null {
  if (observation.resolution === "git-top-level") {
    const resolved = resolveProjectRootGitRoot(observation.privatePath);
    if (!resolved) return null;
    return {
      privatePath: resolved.privatePath,
      kind: "git-repository",
      git: resolved.git
    };
  }

  const privatePath = canonicalExistingDirectory(observation.privatePath);
  if (!privatePath) return null;
  const git = inspectWorkspaceGitRoot(privatePath);
  return {
    privatePath,
    kind: git ? "git-repository" : "directory",
    git
  };
}

function projectSlugByRootId(
  projects: ReturnType<WorkspaceConfigStore["snapshot"]>["projects"]
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [projectSlug, project] of Object.entries(projects)) {
    for (const rootId of project.rootIds) result.set(rootId, projectSlug);
  }
  return result;
}

/**
 * Provider-neutral machine-local coordinator for reviewable ProjectRoot candidates.
 *
 * Sources contribute evidence only. This service canonicalizes and merges physical roots,
 * isolates source failures, and annotates registry state. It never mutates Project Registry,
 * authorization roots, execution workspaces, or provider-native history.
 */
export class ProjectRootDiscoveryService {
  private readonly configStore: WorkspaceConfigStore;
  private readonly sources: ProjectRootDiscoverySource[];

  constructor(
    private readonly paths: TokenPilotPaths,
    sources: ProjectRootDiscoverySource[]
  ) {
    this.configStore = new WorkspaceConfigStore({
      configPath: resolveUserConfigPathForPaths(paths)
    });
    const sourceIds = new Set<string>();
    for (const source of sources) {
      if (!source.id.trim() || sourceIds.has(source.id)) {
        throw new ServiceError(
          "PROJECT_ROOT_DISCOVERY_SOURCE_CONFLICT",
          "ProjectRoot discovery source ids must be unique and non-empty"
        );
      }
      sourceIds.add(source.id);
    }
    this.sources = [...sources];
  }

  async listCandidates(
    context: OperationContext,
    input: { sourceIds?: string[]; includeSessionHistory?: boolean } = {}
  ): Promise<ProjectRootDiscoveryResult> {
    const snapshot = this.configStore.snapshot();
    const registeredRootByPath = new Map(
      Object.entries(snapshot.projectRoots).map(([rootId, root]) => [
        path.resolve(root.path),
        rootId
      ])
    );
    const projectByRootId = projectSlugByRootId(snapshot.projects);
    const repoIdsByRootId = new Map<string, string[]>();
    for (const [repoId, workspace] of Object.entries(snapshot.executionWorkspaces)) {
      const repoIds = repoIdsByRootId.get(workspace.projectRootId) ?? [];
      repoIds.push(repoId);
      repoIdsByRootId.set(workspace.projectRootId, repoIds);
    }
    for (const repoIds of repoIdsByRootId.values()) repoIds.sort();

    let selectedSources = this.sources;
    if (input.sourceIds?.length) {
      const requested = new Set(input.sourceIds);
      const known = new Set(this.sources.map((source) => source.id));
      const unknown = [...requested].filter((sourceId) => !known.has(sourceId));
      if (unknown.length) {
        throw new ServiceError(
          "PROJECT_ROOT_DISCOVERY_SOURCE_NOT_FOUND",
          "Requested ProjectRoot discovery source is not registered",
          { details: { sourceIds: unknown.sort() } }
        );
      }
      selectedSources = this.sources.filter((source) => requested.has(source.id));
    }

    const sourceResults = await Promise.all(
      selectedSources.map(async (source) => {
        try {
          const result = await source.discover(context, {
            includeSessionHistory: input.includeSessionHistory
          });
          return {
            source,
            result,
            snapshot: {
              id: source.id,
              displayName: source.displayName,
              status: "ready" as const,
              inspectedContexts: result.inspectedContexts,
              truncated: result.truncated,
              errorCode: null
            }
          };
        } catch (error) {
          return {
            source,
            result: null,
            snapshot: {
              id: source.id,
              displayName: source.displayName,
              status: "unavailable" as const,
              inspectedContexts: 0,
              truncated: false,
              errorCode: sourceErrorCode(error)
            }
          };
        }
      })
    );

    const grouped = new Map<string, AggregatedCandidate>();
    const groupedProjects = new Map<string, AggregatedProjectGroup>();
    let candidateLimitReached = false;

    for (const sourceResult of sourceResults) {
      if (!sourceResult.result) continue;
      for (const observation of sourceResult.result.observations) {
        if (isPathInsideRoot(this.paths.stateRoot, observation.privatePath)) continue;
        const resolved = resolveObservationRoot(observation);
        if (!resolved) continue;
        if (isPathInsideRoot(this.paths.stateRoot, resolved.privatePath)) continue;

        let candidate = grouped.get(resolved.privatePath);
        if (!candidate) {
          if (grouped.size >= MAX_PROJECT_ROOT_CANDIDATES) {
            candidateLimitReached = true;
            continue;
          }
          candidate = {
            kind: resolved.kind,
            git: resolved.git,
            sources: new Map()
          };
          grouped.set(resolved.privatePath, candidate);
        } else if (candidate.kind !== resolved.kind) {
          // A canonical physical Git root is stronger than an exact-directory hint.
          if (resolved.kind === "git-repository") {
            candidate.kind = "git-repository";
            candidate.git = resolved.git;
          }
        }

        if (observation.logicalProject) {
          const groupKey = `${sourceResult.source.id}\0${observation.logicalProject.id}`;
          let projectGroup = groupedProjects.get(groupKey);
          if (!projectGroup) {
            projectGroup = {
              sourceId: sourceResult.source.id,
              sourceDisplayName: sourceResult.source.displayName,
              nativeProjectId: observation.logicalProject.id,
              name: observation.logicalProject.label?.trim() || path.basename(resolved.privatePath) || resolved.privatePath,
              latestObservedAt: observation.observedAt,
              rootOrderByPath: new Map()
            };
            groupedProjects.set(groupKey, projectGroup);
          }
          const existingOrder = projectGroup.rootOrderByPath.get(resolved.privatePath);
          if (existingOrder === undefined || observation.logicalProject.rootIndex < existingOrder) {
            projectGroup.rootOrderByPath.set(resolved.privatePath, observation.logicalProject.rootIndex);
          }
          if (
            observation.observedAt !== null &&
            (projectGroup.latestObservedAt === null || observation.observedAt > projectGroup.latestObservedAt)
          ) {
            projectGroup.latestObservedAt = observation.observedAt;
          }
        }

        const existingSource = candidate.sources.get(sourceResult.source.id);
        if (!existingSource) {
          candidate.sources.set(sourceResult.source.id, {
            sourceId: sourceResult.source.id,
            sourceDisplayName: sourceResult.source.displayName,
            signalCount: 1,
            signalKinds: new Set([observation.signalKind]),
            latestObservedAt: observation.observedAt,
            latestLabel: observation.label
          });
          continue;
        }

        existingSource.signalCount += 1;
        existingSource.signalKinds.add(observation.signalKind);
        const isNewer =
          observation.observedAt !== null &&
          (existingSource.latestObservedAt === null ||
            observation.observedAt > existingSource.latestObservedAt);
        if (isNewer) {
          existingSource.latestObservedAt = observation.observedAt;
          existingSource.latestLabel = observation.label;
        }
      }
    }

    const candidates = Array.from(grouped.entries())
      .map(([privatePath, candidate]): ProjectRootDiscoveryCandidate => {
        const existingRootId = registeredRootByPath.get(path.resolve(privatePath)) ?? null;
        const sources = [...candidate.sources.values()]
          .map((source) => ({
            sourceId: source.sourceId,
            sourceDisplayName: source.sourceDisplayName,
            signalCount: source.signalCount,
            signalKinds: [...source.signalKinds].sort(),
            latestObservedAt: source.latestObservedAt,
            latestLabel: source.latestLabel
          }))
          .sort((left, right) =>
            left.sourceDisplayName.localeCompare(right.sourceDisplayName) ||
            left.sourceId.localeCompare(right.sourceId)
          );
        return {
          candidateId: candidateId(privatePath),
          name: path.basename(privatePath) || privatePath,
          kind: candidate.kind,
          privatePath,
          registration: existingRootId ? "registered" : "unregistered",
          existingRootId,
          existingProjectSlug: existingRootId
            ? (projectByRootId.get(existingRootId) ?? null)
            : null,
          executionRepoIds: existingRootId
            ? [...(repoIdsByRootId.get(existingRootId) ?? [])]
            : [],
          suggestedRepoId:
            candidate.kind === "git-repository"
              ? suggestedWorkspaceRepoId(path.basename(privatePath))
              : null,
          latestObservedAt: latestObservedAt(sources),
          sources,
          git: candidate.git
        };
      })
      .sort((left, right) =>
        (right.latestObservedAt ?? 0) - (left.latestObservedAt ?? 0) ||
        left.name.localeCompare(right.name)
      );

    const candidateByPath = new Map(candidates.map((candidate) => [candidate.privatePath, candidate]));
    const groups = [...groupedProjects.values()]
      .map((projectGroup): ProjectRootDiscoveryGroup | null => {
        const members = [...projectGroup.rootOrderByPath.entries()]
          .sort(([leftPath, leftOrder], [rightPath, rightOrder]) =>
            leftOrder - rightOrder || leftPath.localeCompare(rightPath)
          )
          .map(([privatePath]) => candidateByPath.get(privatePath) ?? null)
          .filter((candidate): candidate is ProjectRootDiscoveryCandidate => Boolean(candidate));
        if (members.length === 0) return null;
        const registeredCount = members.filter((candidate) => candidate.registration === "registered").length;
        const registeredSlugs = new Set(
          members
            .map((candidate) => candidate.existingProjectSlug)
            .filter((slug): slug is string => Boolean(slug))
        );
        const registration: ProjectRootDiscoveryGroup["registration"] =
          registeredCount === 0
            ? "unregistered"
            : registeredCount === members.length && registeredSlugs.size === 1
              ? "registered"
              : "partially-registered";
        return {
          groupId: groupId(projectGroup.sourceId, projectGroup.nativeProjectId),
          name: projectGroup.name,
          sourceId: projectGroup.sourceId,
          sourceDisplayName: projectGroup.sourceDisplayName,
          candidateIds: members.map((candidate) => candidate.candidateId),
          registration,
          existingProjectSlug:
            registration === "registered" ? [...registeredSlugs][0] ?? null : null,
          latestObservedAt: projectGroup.latestObservedAt
        };
      })
      .filter((group): group is ProjectRootDiscoveryGroup => Boolean(group))
      .sort((left, right) =>
        (right.latestObservedAt ?? 0) - (left.latestObservedAt ?? 0) ||
        left.name.localeCompare(right.name)
      );

    return {
      configRevision: snapshot.revision,
      sources: sourceResults.map((result) => result.snapshot),
      groups,
      candidates,
      truncated:
        candidateLimitReached ||
        sourceResults.some((result) => result.snapshot.truncated)
    };
  }
}
