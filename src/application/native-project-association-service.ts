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

function associationFromCandidates(
  sourceId: string,
  groupId: string,
  candidates: readonly ProjectRootDiscoveryCandidate[],
  project: ProjectRegistryProjectProjection
): NativeProjectAssociationProjection | null {
  for (const candidate of candidates) {
    const association = associationFromProject(sourceId, groupId, candidate, project);
    if (association) return association;
  }
  return null;
}

function explicitNativeGitCandidates(
  group: ProjectRootDiscoveryGroup,
  candidates: ReadonlyMap<string, ProjectRootDiscoveryCandidate>
): ProjectRootDiscoveryCandidate[] | null {
  if (group.candidateIds.length === 0) return null;
  const members: ProjectRootDiscoveryCandidate[] = [];
  for (const candidateId of group.candidateIds) {
    const candidate = candidates.get(candidateId);
    if (!candidate || candidate.kind !== "git-repository") return null;
    const source = candidate.sources.find((entry) => entry.sourceId === group.sourceId);
    if (!source?.signalKinds.includes("native-project-root")) return null;
    members.push(candidate);
  }
  return members;
}

function shouldAdoptNativeDisplayName(
  group: ProjectRootDiscoveryGroup,
  candidates: readonly ProjectRootDiscoveryCandidate[],
  project: ProjectRegistryProjectProjection
): boolean {
  const nativeName = group.name.trim();
  if (!nativeName || nativeName === project.project.displayName) return false;

  // Only upgrade a structurally obvious legacy bootstrap identity. A user-authored
  // display name must remain authoritative even when a provider uses another label.
  if (project.project.displayName !== project.project.slug) return false;
  if (project.roots.length !== 1 || project.workspaces.length !== 1) return false;
  if (project.workspaces[0]?.repoId !== project.project.slug) return false;

  const registeredMembers = candidates.filter(
    (candidate) => candidate.existingProjectSlug === project.project.slug
  );
  if (registeredMembers.length !== 1) return false;

  // Provider label + physical directory name agreeing is strong enough evidence to
  // replace the generic bootstrap alias without changing the stable internal slug.
  return registeredMembers[0]!.name === nativeName;
}

/**
 * Materializes explicit provider-native logical Projects backed by exact Git roots.
 *
 * Generic thread cwd observations remain discovery/review evidence and never widen
 * authority here. Multi-root native Projects are reconciled only when every root has
 * explicit native-project-root evidence and any already-registered roots resolve to
 * one unambiguous ChatCockpit Project.
 */
export class NativeProjectAssociationService {
  constructor(
    private readonly discovery: ProjectRootDiscoveryService,
    private readonly projects: ProjectService,
    private readonly trustedSourceIds: readonly string[]
  ) {}

  async reconcile(context: OperationContext): Promise<NativeProjectAssociationResult> {
    const discovery = await this.discovery.listCandidates(context, {
      sourceIds: [...this.trustedSourceIds],
      includeSessionHistory: false
    });
    const candidates = new Map(discovery.candidates.map((candidate) => [candidate.candidateId, candidate]));
    const created: NativeProjectAssociationProjection[] = [];
    const reused: NativeProjectAssociationProjection[] = [];
    const skipped: NativeProjectAssociationSkipProjection[] = [];
    const associationByCandidateId = new Map<string, NativeProjectAssociationProjection>();
    let configRevision = discovery.configRevision;
    let projectBySlug: Map<string, ProjectRegistryProjectProjection> | null = null;
    const findProjectBySlug = (slug: string): ProjectRegistryProjectProjection | null => {
      projectBySlug ??= new Map(
        this.projects.registry(context).projects.map((entry) => [entry.project.slug, entry])
      );
      return projectBySlug.get(slug) ?? null;
    };
    const rememberProject = (project: ProjectRegistryProjectProjection): void => {
      projectBySlug?.set(project.project.slug, project);
    };

    for (const group of discovery.groups) {
      if (!this.trustedSourceIds.includes(group.sourceId)) continue;

      const members = explicitNativeGitCandidates(group, candidates);
      if (!members) {
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

      const mappedAssociations = members
        .map((candidate) => associationByCandidateId.get(candidate.candidateId) ?? null)
        .filter((association): association is NativeProjectAssociationProjection => Boolean(association));
      const projectSlugs = new Set<string>();
      for (const candidate of members) {
        if (candidate.existingProjectSlug) projectSlugs.add(candidate.existingProjectSlug);
      }
      for (const association of mappedAssociations) projectSlugs.add(association.projectSlug);

      const hasOrphanRegisteredRoot = members.some(
        (candidate) =>
          candidate.registration === "registered" &&
          !candidate.existingProjectSlug &&
          !associationByCandidateId.has(candidate.candidateId)
      );
      const hasTransientPartialOverlap =
        members.every((candidate) => !candidate.existingProjectSlug) &&
        mappedAssociations.length > 0 &&
        members.some((candidate) => !associationByCandidateId.has(candidate.candidateId));
      if (projectSlugs.size > 1 || hasOrphanRegisteredRoot || hasTransientPartialOverlap) {
        skipped.push({
          sourceId: group.sourceId,
          groupId: group.groupId,
          reason: "partial-registration"
        });
        continue;
      }

      const targetSlug = [...projectSlugs][0] ?? null;
      let project = targetSlug ? findProjectBySlug(targetSlug) : null;
      if (targetSlug && !project) {
        skipped.push({
          sourceId: group.sourceId,
          groupId: group.groupId,
          reason: "partial-registration"
        });
        continue;
      }

      let association = mappedAssociations.find(
        (entry) => !targetSlug || entry.projectSlug === targetSlug
      ) ?? null;
      let materializedHere = false;
      const adoptNativeDisplayName = project
        ? shouldAdoptNativeDisplayName(group, members, project)
        : false;
      const pendingRootAttachment = project
        ? members.some((candidate) => {
            if (candidate.existingProjectSlug === project!.project.slug) return false;
            const mapped = associationByCandidateId.get(candidate.candidateId);
            return !mapped || mapped.projectSlug !== project!.project.slug;
          })
        : false;
      if (
        project &&
        pendingRootAttachment &&
        project.project.displayName !== group.name.trim() &&
        !adoptNativeDisplayName
      ) {
        skipped.push({
          sourceId: group.sourceId,
          groupId: group.groupId,
          reason: "partial-registration"
        });
        continue;
      }

      if (!project) {
        const primary = members[0]!;
        const result = this.projects.createProject(context, {
          displayName: group.name,
          rootPath: primary.privatePath,
          kind: "git-repository",
          role: "primary-source",
          access: "read-write",
          expectedConfigRevision: configRevision
        });
        configRevision = result.configRevision;
        project = result;
        rememberProject(project);
        association = associationFromProject(group.sourceId, group.groupId, primary, result);
        materializedHere = true;
      } else if (shouldAdoptNativeDisplayName(group, members, project)) {
        const renamed = this.projects.rename(context, {
          projectId: project.project.id,
          displayName: group.name,
          expectedConfigRevision: configRevision
        });
        configRevision = renamed.configRevision;
        project = renamed;
        rememberProject(project);
      }

      for (let index = 0; index < members.length; index += 1) {
        const candidate = members[index]!;
        if (candidate.existingProjectSlug === project.project.slug) continue;

        const mapped = associationByCandidateId.get(candidate.candidateId);
        if (mapped) {
          if (mapped.projectSlug !== project.project.slug) {
            throw new Error("Native Project association drifted across Projects during reconciliation");
          }
          continue;
        }

        // The first member of a newly-created Project was materialized by createProject.
        if (materializedHere && index === 0) continue;

        const attached = this.projects.attachRoot(context, {
          projectId: project.project.id,
          rootPath: candidate.privatePath,
          kind: "git-repository",
          role: "supporting-source",
          access: "read-write",
          expectedConfigRevision: configRevision
        });
        configRevision = attached.configRevision;
        project = attached;
        rememberProject(project);
      }

      association ??= associationFromCandidates(
        group.sourceId,
        group.groupId,
        members,
        project
      );
      if (!association) {
        throw new Error("Native Project reconciliation could not resolve a public association");
      }

      const groupAssociation = {
        ...association,
        sourceId: group.sourceId,
        groupId: group.groupId,
        projectId: project.project.id,
        projectSlug: project.project.slug
      };
      for (const candidate of members) {
        associationByCandidateId.set(candidate.candidateId, groupAssociation);
      }

      if (materializedHere) created.push(groupAssociation);
      else reused.push(groupAssociation);
    }

    return { configRevision, created, reused, skipped };
  }
}
