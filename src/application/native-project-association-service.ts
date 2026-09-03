import type { ProjectRegistryProjectProjection, ProjectService } from "./project-service.js";
import type {
  ProjectRootDiscoveryCandidate,
  ProjectRootDiscoveryGroup,
  ProjectRootDiscoveryService
} from "./project-root-discovery-service.js";
import type { OperationContext } from "./operation-context.js";

export type NativeProjectAssociationSkipReason =
  | "partial-registration"
  | "unsupported-root-shape"
  | "missing-native-project-evidence";

export interface NativeProjectAssociationProjection {
  sourceId: string;
  groupId: string;
  projectId: string;
  projectSlug: string;
  projectRootId: string;
  workspaceId: string;
  repoId: string;
}

export interface NativeProjectAssociationSkipProjection {
  sourceId: string;
  groupId: string;
  reason: NativeProjectAssociationSkipReason;
}

export interface NativeProjectAssociationResult {
  configRevision: string;
  created: NativeProjectAssociationProjection[];
  reused: NativeProjectAssociationProjection[];
  skipped: NativeProjectAssociationSkipProjection[];
}

function associationFromProject(
  sourceId: string,
  groupId: string,
  candidate: ProjectRootDiscoveryCandidate,
  project: ProjectRegistryProjectProjection
): NativeProjectAssociationProjection | null {
  const root = candidate.existingRootId
    ? project.roots.find((entry) => entry.id === candidate.existingRootId) ?? null
    : project.roots.find((entry) => entry.primary) ?? project.roots[0] ?? null;
  const workspace = candidate.executionRepoIds.length === 1
    ? project.workspaces.find((entry) => entry.repoId === candidate.executionRepoIds[0]) ?? null
    : project.workspaces.length === 1
      ? project.workspaces[0]!
      : null;
  if (!root || !workspace) return null;
  return {
    sourceId,
    groupId,
    projectId: project.project.id,
    projectSlug: project.project.slug,
    projectRootId: root.id,
    workspaceId: workspace.id,
    repoId: workspace.repoId
  };
}

function explicitNativeGitCandidate(
  group: ProjectRootDiscoveryGroup,
  candidates: ReadonlyMap<string, ProjectRootDiscoveryCandidate>
): ProjectRootDiscoveryCandidate | null {
  if (group.candidateIds.length !== 1) return null;
  const candidate = candidates.get(group.candidateIds[0]!);
  if (!candidate || candidate.kind !== "git-repository") return null;
  const source = candidate.sources.find((entry) => entry.sourceId === group.sourceId);
  if (!source?.signalKinds.includes("native-project-root")) return null;
  return candidate;
}

/**
 * Materializes only explicit provider-native logical Projects backed by one exact Git root.
 * Generic thread cwd observations remain discovery/review evidence and never widen authority here.
 */
export class NativeProjectAssociationService {
  constructor(
    private readonly discovery: ProjectRootDiscoveryService,
    private readonly projects: ProjectService,
    private readonly trustedSourceIds: readonly string[]
  ) {}

  async reconcile(context: OperationContext): Promise<NativeProjectAssociationResult> {
    const discovery = await this.discovery.listCandidates(context, {
      sourceIds: [...this.trustedSourceIds]
    });
    const candidates = new Map(discovery.candidates.map((candidate) => [candidate.candidateId, candidate]));
    const created: NativeProjectAssociationProjection[] = [];
    const reused: NativeProjectAssociationProjection[] = [];
    const skipped: NativeProjectAssociationSkipProjection[] = [];
    const associationByCandidateId = new Map<string, NativeProjectAssociationProjection>();
    let configRevision = discovery.configRevision;

    for (const group of discovery.groups) {
      if (!this.trustedSourceIds.includes(group.sourceId)) continue;
      if (group.registration === "partially-registered") {
        skipped.push({ sourceId: group.sourceId, groupId: group.groupId, reason: "partial-registration" });
        continue;
      }
      const candidate = explicitNativeGitCandidate(group, candidates);
      if (!candidate) {
        const member = group.candidateIds.length === 1 ? candidates.get(group.candidateIds[0]!) : null;
        skipped.push({
          sourceId: group.sourceId,
          groupId: group.groupId,
          reason: member?.kind === "git-repository"
            ? "missing-native-project-evidence"
            : "unsupported-root-shape"
        });
        continue;
      }

      const alreadyAssociated = associationByCandidateId.get(candidate.candidateId);
      if (alreadyAssociated) {
        reused.push({
          ...alreadyAssociated,
          sourceId: group.sourceId,
          groupId: group.groupId
        });
        continue;
      }

      if (group.registration === "registered" && group.existingProjectSlug) {
        const existing = this.projects.registry(context).projects.find(
          (entry) => entry.project.slug === group.existingProjectSlug
        );
        if (existing) {
          const association = associationFromProject(group.sourceId, group.groupId, candidate, existing);
          if (association) {
            reused.push(association);
            associationByCandidateId.set(candidate.candidateId, association);
          }
        }
        configRevision = this.projects.configRevision();
        continue;
      }

      const result = this.projects.createProject(context, {
        displayName: group.name,
        rootPath: candidate.privatePath,
        kind: "git-repository",
        role: "primary-source",
        access: "read-write",
        expectedConfigRevision: configRevision
      });
      configRevision = result.configRevision;
      const association = associationFromProject(group.sourceId, group.groupId, candidate, result);
      if (association) {
        created.push(association);
        associationByCandidateId.set(candidate.candidateId, association);
      }
    }

    return { configRevision, created, reused, skipped };
  }
}
