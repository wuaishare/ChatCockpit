import type { TokenPilotPaths } from "../types.js";
import type { ContinuityDatabase } from "../continuity/database.js";
import {
  buildContinuityRepositories,
  type ContinuityRepositories
} from "../continuity/repositories/index.js";
import { AsyncJobService } from "./async-job-service.js";
import { DevelopmentDocumentService } from "./development-document-service.js";
import { EvidenceService } from "./evidence-service.js";
import { HandoffService } from "./handoff-service.js";
import { LeaseService } from "./lease-service.js";
import { ProjectService } from "./project-service.js";
import { SessionService } from "./session-service.js";
import { TaskCompletionService } from "./task-completion-service.js";
import { TaskService } from "./task-service.js";
import { TaskExecutionPolicyService } from "./task-execution-policy.js";
import { WorkspaceContinuityService } from "./workspace-continuity-service.js";
import { productIdentityForKey } from "../core/product-identity.js";

export interface ContinuityServices {
  repositories: ContinuityRepositories;
  asyncJobs: AsyncJobService;
  developmentDocuments: DevelopmentDocumentService;
  projects: ProjectService;
  workspaces: WorkspaceContinuityService;
  tasks: TaskService;
  taskCompletion: TaskCompletionService;
  taskExecutionPolicy: TaskExecutionPolicyService;
  sessions: SessionService;
  leases: LeaseService;
  handoffs: HandoffService;
  evidence: EvidenceService;
}

export function buildContinuityServices(
  paths: TokenPilotPaths,
  database: ContinuityDatabase
): ContinuityServices {
  const identity = productIdentityForKey(paths.productIdentity);
  const repositories = buildContinuityRepositories(database, {
    asyncRunnerRuntimeKind: identity.asyncRunnerRuntimeKind
  });
  const taskExecutionPolicy = new TaskExecutionPolicyService(repositories);
  return {
    repositories,
    asyncJobs: new AsyncJobService(paths, repositories, taskExecutionPolicy),
    developmentDocuments: new DevelopmentDocumentService(repositories),
    projects: new ProjectService(paths, database, repositories),
    workspaces: new WorkspaceContinuityService(
      paths,
      repositories,
      taskExecutionPolicy
    ),
    tasks: new TaskService(repositories),
    taskCompletion: new TaskCompletionService(repositories),
    taskExecutionPolicy,
    sessions: new SessionService(repositories, taskExecutionPolicy),
    leases: new LeaseService(repositories),
    handoffs: new HandoffService(repositories),
    evidence: new EvidenceService(repositories)
  };
}
