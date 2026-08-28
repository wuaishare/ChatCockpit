import fs from "node:fs";
import path from "node:path";

import { resolveUserConfigPathForPaths } from "../core/config.js";
import { isPathInsideRoot } from "../core/path-guards.js";
import type { TokenPilotPaths } from "../types.js";
import { WorkspaceConfigStore } from "../workspaces/workspace-config-store.js";

export type ProviderSessionClassification =
  | "project-scoped"
  | "standalone"
  | "review-required";

export interface ProviderSessionObservation {
  providerId: string;
  nativeSessionId: string;
  privatePath: string;
  label?: string | null;
  observedAt?: number | null;
}

export interface ProviderSessionClassificationResult {
  providerId: string;
  nativeSessionId: string;
  classification: ProviderSessionClassification;
  projectSlug: string | null;
  projectRootId: string | null;
  executionRepoId: string | null;
  matchedProjectSlugs: string[];
  matchedProjectRootIds: string[];
  matchedExecutionRepoIds: string[];
  label: string | null;
  observedAt: number | null;
}

interface RootMatch {
  rootId: string;
  projectSlug: string;
  executionRepoIds: Set<string>;
}

function canonicalPath(input: string): string {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Classifies provider-native session locations against reviewed ProjectRoot Registry truth.
 *
 * The classifier never registers roots, changes authorization, starts provider turns, or copies
 * native message/event history. A unique reviewed ProjectRoot match is Project-scoped; no match
 * remains Standalone; multiple root matches require Owner review.
 */
export class ProviderSessionClassificationService {
  private readonly configStore: WorkspaceConfigStore;

  constructor(paths: TokenPilotPaths) {
    this.configStore = new WorkspaceConfigStore({
      configPath: resolveUserConfigPathForPaths(paths)
    });
  }

  classify(observations: ProviderSessionObservation[]): ProviderSessionClassificationResult[] {
    const snapshot = this.configStore.snapshot();
    const projectByRootId = new Map<string, string>();
    for (const [projectSlug, project] of Object.entries(snapshot.projects)) {
      for (const rootId of project.rootIds) projectByRootId.set(rootId, projectSlug);
    }

    return observations.map((observation) => {
      const sessionPath = canonicalPath(observation.privatePath);
      const matches = new Map<string, RootMatch>();

      const ensureMatch = (rootId: string): RootMatch | null => {
        const projectSlug = projectByRootId.get(rootId);
        if (!projectSlug) return null;
        let match = matches.get(rootId);
        if (!match) {
          match = { rootId, projectSlug, executionRepoIds: new Set() };
          matches.set(rootId, match);
        }
        return match;
      };

      for (const [repoId, workspace] of Object.entries(snapshot.executionWorkspaces)) {
        if (!isPathInsideRoot(canonicalPath(workspace.path), sessionPath)) continue;
        ensureMatch(workspace.projectRootId)?.executionRepoIds.add(repoId);
      }

      for (const [rootId, root] of Object.entries(snapshot.projectRoots)) {
        if (!isPathInsideRoot(canonicalPath(root.path), sessionPath)) continue;
        ensureMatch(rootId);
      }

      const rootMatches = [...matches.values()].sort((left, right) =>
        left.rootId.localeCompare(right.rootId)
      );
      const matchedProjectRootIds = rootMatches.map((match) => match.rootId);
      const matchedProjectSlugs = [...new Set(rootMatches.map((match) => match.projectSlug))].sort();
      const matchedExecutionRepoIds = [...new Set(
        rootMatches.flatMap((match) => [...match.executionRepoIds])
      )].sort();

      if (rootMatches.length === 0) {
        return {
          providerId: observation.providerId,
          nativeSessionId: observation.nativeSessionId,
          classification: "standalone" as const,
          projectSlug: null,
          projectRootId: null,
          executionRepoId: null,
          matchedProjectSlugs,
          matchedProjectRootIds,
          matchedExecutionRepoIds,
          label: observation.label ?? null,
          observedAt: observation.observedAt ?? null
        };
      }

      if (rootMatches.length > 1) {
        return {
          providerId: observation.providerId,
          nativeSessionId: observation.nativeSessionId,
          classification: "review-required" as const,
          projectSlug: null,
          projectRootId: null,
          executionRepoId: null,
          matchedProjectSlugs,
          matchedProjectRootIds,
          matchedExecutionRepoIds,
          label: observation.label ?? null,
          observedAt: observation.observedAt ?? null
        };
      }

      const match = rootMatches[0]!;
      const executionRepoIds = [...match.executionRepoIds].sort();
      return {
        providerId: observation.providerId,
        nativeSessionId: observation.nativeSessionId,
        classification: "project-scoped" as const,
        projectSlug: match.projectSlug,
        projectRootId: match.rootId,
        executionRepoId: executionRepoIds.length === 1 ? executionRepoIds[0]! : null,
        matchedProjectSlugs,
        matchedProjectRootIds,
        matchedExecutionRepoIds,
        label: observation.label ?? null,
        observedAt: observation.observedAt ?? null
      };
    });
  }
}
