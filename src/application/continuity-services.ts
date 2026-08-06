import type { TokenPilotPaths } from "../types.js";
import type { ContinuityDatabase } from "../continuity/database.js";
import {
  buildContinuityRepositories,
  type ContinuityRepositories
} from "../continuity/repositories/index.js";
import { AsyncJobService } from "./async-job-service.js";
import { EvidenceService } from "./evidence-service.js";
import { HandoffService } from "./handoff-service.js";
import { LeaseService } from "./lease-service.js";
import { ProjectService } from "./project-service.js";
import { SessionService } from "./session-service.js";
import { TaskCompletionService } from "./task-completion-service.js";
import { TaskService } from "./task-service.js";
import { WorkspaceContinuityService } from "./workspace-continuity-service.js";

export interface ContinuityServices {
  repositories: ContinuityRepositories;
  asyncJobs: AsyncJobService;
  projects: ProjectService;
  workspaces: WorkspaceContinuityService;
  tasks: TaskService;
  taskCompletion: TaskCompletionService;
  sessions: SessionService;
  leases: LeaseService;
  handoffs: HandoffService;
  evidence: EvidenceService;
}

export function buildContinuityServices(
  paths: TokenPilotPaths,
  database: ContinuityDatabase
): ContinuityServices {
  const repositories = buildContinuityRepositories(database);
  return {
    repositories,
    asyncJobs: new AsyncJobService(paths, repositories),
    projects: new ProjectService(paths, database, repositories),
    workspaces: new WorkspaceContinuityService(paths, repositories),
    tasks: new TaskService(repositories),
    taskCompletion: new TaskCompletionService(repositories),
    sessions: new SessionService(repositories),
    leases: new LeaseService(repositories),
    handoffs: new HandoffService(repositories),
    evidence: new EvidenceService(repositories)
  };
}
