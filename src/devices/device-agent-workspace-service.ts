import { z } from "zod";

import { FilesService } from "../application/files-service.js";
import { GitService } from "../application/git-service.js";
import { buildOperationContext } from "../application/operation-context.js";
import { SearchService } from "../application/search-service.js";
import { ServiceError } from "../application/service-error.js";
import {
  isWithinWorkspaceAllowlist,
  loadUserConfigForPaths,
  resolveRepoMapping
} from "../core/config.js";
import type { TokenPilotPaths } from "../types.js";

const repoIdSchema = z.string().min(1).max(160);
const relativePathSchema = z.string().min(1).max(2048);
const DEVICE_WORKSPACE_SINGLE_READ_MAX_BYTES = 64 * 1024;
const DEVICE_WORKSPACE_BATCH_READ_MAX_BYTES = 16 * 1024;

const listSchema = z.object({}).strict();
const filesListSchema = z.object({
  repoId: repoIdSchema,
  path: relativePathSchema.default(".")
}).strict();
const filesReadSchema = z.object({
  repoId: repoIdSchema,
  path: relativePathSchema,
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().positive().max(DEVICE_WORKSPACE_SINGLE_READ_MAX_BYTES)
    .default(DEVICE_WORKSPACE_SINGLE_READ_MAX_BYTES)
}).strict();
const filesReadBatchSchema = z.object({
  repoId: repoIdSchema,
  paths: z.array(relativePathSchema).min(1).max(10),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().positive().max(DEVICE_WORKSPACE_BATCH_READ_MAX_BYTES)
    .default(DEVICE_WORKSPACE_BATCH_READ_MAX_BYTES)
}).strict();
const searchSchema = z.object({
  repoId: repoIdSchema,
  pattern: z.string().min(1).max(1000),
  path: relativePathSchema.optional(),
  maxResults: z.number().int().positive().max(40).optional(),
  contextLines: z.number().int().min(0).max(3).optional(),
  caseSensitive: z.boolean().optional()
}).strict();
const gitStatusSchema = z.object({ repoId: repoIdSchema }).strict();
const gitDiffSchema = z.object({
  repoId: repoIdSchema,
  staged: z.boolean().optional()
}).strict();

export const DEVICE_WORKSPACE_READ_ACTIONS = [
  "workspaces.list",
  "files.list",
  "files.read",
  "files.readBatch",
  "search.code",
  "git.status",
  "git.diff"
] as const;

export type DeviceWorkspaceReadAction = (typeof DEVICE_WORKSPACE_READ_ACTIONS)[number];

export interface DeviceWorkspaceReadRequest {
  action: DeviceWorkspaceReadAction;
  params: unknown;
}

export class DeviceAgentWorkspaceService {
  private readonly files: FilesService;
  private readonly search: SearchService;
  private readonly git: GitService;

  constructor(private readonly paths: TokenPilotPaths) {
    this.files = new FilesService(paths);
    this.search = new SearchService(paths);
    this.git = new GitService(paths);
  }

  execute(requestId: string, request: DeviceWorkspaceReadRequest): unknown {
    const context = buildOperationContext({
      requestId,
      actorType: "rest-api",
      actorId: "device-agent-workspace-rpc",
      publicProjection: true
    });
    switch (request.action) {
      case "workspaces.list": {
        listSchema.parse(request.params);
        const config = loadUserConfigForPaths(this.paths);
        const workspaces = Object.entries(config.executionWorkspaces)
          .filter(([repoId, workspace]) => {
            try {
              const mapping = resolveRepoMapping(config, repoId);
              return (
                mapping.repoRoot === workspace.path &&
                isWithinWorkspaceAllowlist(mapping.repoRoot, config.workspaceAllowlist)
              );
            } catch {
              return false;
            }
          })
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([repoId, workspace]) => {
            const project = config.projects[repoId];
            const root = config.projectRoots[workspace.projectRootId];
            return {
              repoId,
              displayName: project?.displayName ?? repoId,
              defaultRepo: repoId === config.defaultRepoId,
              kind: workspace.kind,
              provenance: workspace.provenance,
              access: root?.access ?? "read-only",
              pathVisibility: "hidden" as const
            };
          });
        return {
          ok: true as const,
          pathVisibility: "hidden" as const,
          workspaces
        };
      }
      case "files.list": {
        const input = filesListSchema.parse(request.params);
        return this.files.list(context, input);
      }
      case "files.read": {
        const input = filesReadSchema.parse(request.params);
        return this.files.read(context, input);
      }
      case "files.readBatch": {
        const input = filesReadBatchSchema.parse(request.params);
        return this.files.readBatch(context, input);
      }
      case "search.code": {
        const input = searchSchema.parse(request.params);
        return this.search.search(context, input);
      }
      case "git.status": {
        const input = gitStatusSchema.parse(request.params);
        return this.git.status(context, input.repoId);
      }
      case "git.diff": {
        const input = gitDiffSchema.parse(request.params);
        return this.git.diff(context, input.repoId, input.staged ?? false);
      }
    }
  }
}

export function isDeviceWorkspaceReadAction(value: string): value is DeviceWorkspaceReadAction {
  return (DEVICE_WORKSPACE_READ_ACTIONS as readonly string[]).includes(value);
}

export function projectDeviceWorkspaceError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof z.ZodError) {
    return {
      code: "DEVICE_WORKSPACE_ARGUMENTS_INVALID",
      message: "Remote workspace request arguments are invalid"
    };
  }
  if (error instanceof ServiceError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "DEVICE_WORKSPACE_EXECUTION_FAILED",
    message: "Remote workspace request could not be completed"
  };
}
