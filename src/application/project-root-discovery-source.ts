import type { OperationContext } from "./operation-context.js";

export type ProjectRootDiscoveryResolution = "git-top-level" | "exact-directory";

export interface ProjectRootDiscoveryObservation {
  sourceContextId: string;
  privatePath: string;
  label: string | null;
  observedAt: number | null;
  signalKind: string;
  resolution: ProjectRootDiscoveryResolution;
}

export interface ProjectRootDiscoveryObservationSet {
  observations: ProjectRootDiscoveryObservation[];
  inspectedContexts: number;
  truncated: boolean;
}

/**
 * Machine-local discovery evidence source for reviewable ProjectRoot candidates.
 *
 * A source contributes observations only. It must not create Projects, attach roots,
 * expand authorization boundaries, grant mutation authority, or copy provider-native history.
 */
export interface ProjectRootDiscoverySource {
  readonly id: string;
  readonly displayName: string;
  discover(context: OperationContext): Promise<ProjectRootDiscoveryObservationSet>;
}
