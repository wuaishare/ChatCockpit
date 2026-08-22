import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadUserConfigForPaths } from "../core/config.js";
import type { TokenPilotPaths } from "../types.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import { ServiceError } from "./service-error.js";
import type { OperationContext } from "./operation-context.js";
import type { ProjectProjection, ProjectService } from "./project-service.js";
import {
  scanWorkspaceDiscoveryRoot,
  workspaceDiscoveryRootId,
  type WorkspaceDiscoveryCandidate
} from "../workspaces/workspace-discovery.js";
import {
  WorkspaceConfigStore,
  type WorkspaceConfigSnapshot
} from "../workspaces/workspace-config-store.js";

export interface WorkspaceDiscoveryRootProjection {
  id: string;
  displayName: string;
  path: string;
}

export interface WorkspaceDiscoveryRootsResult {
  configRevision: string;
  roots: WorkspaceDiscoveryRootProjection[];
}

export interface WorkspaceDiscoveryScanResult {
  configRevision: string;
  root: WorkspaceDiscoveryRootProjection;
  inspectedEntries: number;
  truncated: boolean;
  candidates: WorkspaceDiscoveryCandidate[];
}

export interface WorkspaceImportResult {
  configRevision: string;
  project: ProjectProjection["project"];
  workspace: ProjectProjection["workspaces"][number];
  replayed: boolean;
}

function canonical(input: string): string {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isInside(root: string, target: string): boolean {
  const normalizedRoot = canonical(root);
  const normalizedTarget = canonical(target);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function assertConfigRevision(snapshot: WorkspaceConfigSnapshot, expectedRevision: string): void {
  if (snapshot.revision !== expectedRevision) {
    throw new ServiceError(
      "WORKSPACE_DISCOVERY_REVISION_CONFLICT",
      "Workspace configuration changed before the discovery operation could continue",
      {
        details: {
          expectedRevision,
          actualRevision: snapshot.revision
        }
      }
    );
  }
}

export class WorkspaceOnboardingService {
  private readonly configStore: WorkspaceConfigStore;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly projects: ProjectService,
    private readonly repositories: ContinuityRepositories
  ) {
    this.configStore = new WorkspaceConfigStore({ configPath: paths.configPath });
  }

  listRoots(_context: OperationContext): WorkspaceDiscoveryRootsResult {
    this.ensureConfig();
    return this.projectRoots(this.configStore.snapshot());
  }

  addRoot(
    _context: OperationContext,
    input: { path: string; expectedConfigRevision: string }
  ): WorkspaceDiscoveryRootsResult {
    this.ensureConfig();
    const root = this.validateNewRoot(input.path);
    const updated = this.configStore.addDiscoveryRoot(root, input.expectedConfigRevision);
    return this.projectRoots(updated);
  }

  removeRoot(
    _context: OperationContext,
    input: { rootId: string; expectedConfigRevision: string }
  ): WorkspaceDiscoveryRootsResult {
    this.ensureConfig();
    const snapshot = this.configStore.snapshot();
    assertConfigRevision(snapshot, input.expectedConfigRevision);
    const root = this.resolveRoot(snapshot, input.rootId);
    const updated = this.configStore.removeDiscoveryRoot(root, snapshot.revision);
    return this.projectRoots(updated);
  }

  scanRoot(
    _context: OperationContext,
    input: { rootId: string; expectedConfigRevision: string }
  ): WorkspaceDiscoveryScanResult {
    this.ensureConfig();
    const snapshot = this.configStore.snapshot();
    assertConfigRevision(snapshot, input.expectedConfigRevision);
    const root = this.resolveRoot(snapshot, input.rootId);
    const scan = scanWorkspaceDiscoveryRoot({
      root,
      configRevision: snapshot.revision,
      repoMappings: snapshot.repoMappings
    });
    return {
      configRevision: snapshot.revision,
      root: this.projectRoot(root),
      inspectedEntries: scan.inspectedEntries,
      truncated: scan.truncated,
      candidates: scan.candidates.map(({ privatePath: _privatePath, ...candidate }) => candidate)
    };
  }

  async importCandidate(
    context: OperationContext,
    input: {
      rootId: string;
      candidateId: string;
      repoId: string;
      expectedConfigRevision: string;
      idempotencyKey: string;
    }
  ): Promise<WorkspaceImportResult> {
    this.ensureConfig();
    const idempotencyInput = {
      rootId: input.rootId,
      candidateId: input.candidateId,
      repoId: input.repoId,
      expectedConfigRevision: input.expectedConfigRevision
    };
    const execution = await this.repositories.idempotency.executeExternalMutation(
      "workspace-onboarding.import",
      input.idempotencyKey,
      idempotencyInput,
      async () => {
        const snapshot = this.configStore.snapshot();
        assertConfigRevision(snapshot, input.expectedConfigRevision);
        const root = this.resolveRoot(snapshot, input.rootId);
        const scan = scanWorkspaceDiscoveryRoot({
          root,
          configRevision: snapshot.revision,
          repoMappings: snapshot.repoMappings
        });
        const candidate = scan.candidates.find((entry) => entry.candidateId === input.candidateId);
        if (!candidate) {
          throw new ServiceError(
            "WORKSPACE_DISCOVERY_CANDIDATE_STALE",
            "Workspace discovery candidate is stale or no longer available"
          );
        }
        if (candidate.registration === "registered") {
          throw new ServiceError(
            "WORKSPACE_ALREADY_REGISTERED",
            "Workspace checkout is already registered",
            { details: { repoId: candidate.existingRepoId } }
          );
        }
        return this.configStore.importRepo({
          root,
          repoPath: candidate.privatePath,
          repoId: input.repoId,
          expectedRevision: snapshot.revision
        });
      },
      (updated) => {
        const projections = this.projects.list(context);
        for (const projection of projections) {
          const workspace = projection.workspaces.find((entry) => entry.repoId === input.repoId);
          if (workspace) {
            return {
              configRevision: updated.revision,
              project: projection.project,
              workspace
            };
          }
        }
        throw new ServiceError(
          "WORKSPACE_IMPORT_SYNC_FAILED",
          "Imported workspace could not be materialized in Continuity"
        );
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  private ensureConfig(): void {
    loadUserConfigForPaths(this.paths);
  }

  private validateNewRoot(input: string): string {
    const root = canonical(input);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch (error) {
      throw new ServiceError(
        "WORKSPACE_DISCOVERY_ROOT_NOT_FOUND",
        "Workspace discovery root must be an existing directory",
        { cause: error }
      );
    }
    if (!stat.isDirectory()) {
      throw new ServiceError(
        "WORKSPACE_DISCOVERY_ROOT_INVALID",
        "Workspace discovery root must be a directory"
      );
    }

    const filesystemRoot = path.parse(root).root;
    const homeRoot = canonical(os.homedir());
    const stateRoot = canonical(this.paths.stateRoot);
    if (root === filesystemRoot || root === homeRoot || isInside(stateRoot, root)) {
      throw new ServiceError(
        "WORKSPACE_DISCOVERY_ROOT_FORBIDDEN",
        "Workspace discovery root is too broad or overlaps protected ChatCockpit state"
      );
    }
    return root;
  }

  private resolveRoot(snapshot: WorkspaceConfigSnapshot, rootId: string): string {
    const root = snapshot.discoveryRoots.find((entry) => workspaceDiscoveryRootId(entry) === rootId);
    if (!root) {
      throw new ServiceError(
        "WORKSPACE_DISCOVERY_ROOT_NOT_FOUND",
        "Workspace discovery root is not configured"
      );
    }
    return root;
  }

  private projectRoots(snapshot: WorkspaceConfigSnapshot): WorkspaceDiscoveryRootsResult {
    return {
      configRevision: snapshot.revision,
      roots: snapshot.discoveryRoots.map((root) => this.projectRoot(root))
    };
  }

  private projectRoot(root: string): WorkspaceDiscoveryRootProjection {
    return {
      id: workspaceDiscoveryRootId(root),
      displayName: path.basename(root) || root,
      path: root
    };
  }
}
