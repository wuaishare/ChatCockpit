import type { ContinuityDatabase } from "../database.js";
import { DevelopmentDocumentRepository } from "./development-document-repository.js";
import { EvidenceRepository } from "./evidence-repository.js";
import { HandoffRepository } from "./handoff-repository.js";
import { IdempotencyRepository } from "./idempotency-repository.js";
import { LeaseRepository } from "./lease-repository.js";
import { ProjectRepository } from "./project-repository.js";
import { RuntimeApprovalRepository } from "./runtime-approval-repository.js";
import { RuntimeBindingRepository } from "./runtime-binding-repository.js";
import { RuntimeEventRepository } from "./runtime-event-repository.js";
import { RuntimeRunRepository } from "./runtime-run-repository.js";
import { SessionRepository } from "./session-repository.js";
import { TaskRepository } from "./task-repository.js";
import { WorkspaceRepository } from "./workspace-repository.js";

export interface ContinuityRepositories {
  projects: ProjectRepository;
  developmentDocuments: DevelopmentDocumentRepository;
  runtimeApprovals: RuntimeApprovalRepository;
  runtimeBindings: RuntimeBindingRepository;
  runtimeEvents: RuntimeEventRepository;
  runtimeRuns: RuntimeRunRepository;
  workspaces: WorkspaceRepository;
  tasks: TaskRepository;
  sessions: SessionRepository;
  leases: LeaseRepository;
  handoffs: HandoffRepository;
  evidence: EvidenceRepository;
  idempotency: IdempotencyRepository;
}

export function buildContinuityRepositories(
  database: ContinuityDatabase
): ContinuityRepositories {
  return {
    projects: new ProjectRepository(database),
    developmentDocuments: new DevelopmentDocumentRepository(database),
    runtimeApprovals: new RuntimeApprovalRepository(database),
    runtimeBindings: new RuntimeBindingRepository(database),
    runtimeEvents: new RuntimeEventRepository(database),
    runtimeRuns: new RuntimeRunRepository(database),
    workspaces: new WorkspaceRepository(database),
    tasks: new TaskRepository(database),
    sessions: new SessionRepository(database),
    leases: new LeaseRepository(database),
    handoffs: new HandoffRepository(database),
    evidence: new EvidenceRepository(database),
    idempotency: new IdempotencyRepository(database)
  };
}

export { DevelopmentDocumentRepository } from "./development-document-repository.js";
export { EvidenceRepository } from "./evidence-repository.js";
export { HandoffRepository } from "./handoff-repository.js";
export { IdempotencyRepository } from "./idempotency-repository.js";
export { LeaseRepository } from "./lease-repository.js";
export { ProjectRepository } from "./project-repository.js";
export { RuntimeApprovalRepository } from "./runtime-approval-repository.js";
export { RuntimeBindingRepository } from "./runtime-binding-repository.js";
export { RuntimeEventRepository } from "./runtime-event-repository.js";
export { RuntimeRunRepository } from "./runtime-run-repository.js";
export { SessionRepository } from "./session-repository.js";
export { TaskRepository } from "./task-repository.js";
export { WorkspaceRepository } from "./workspace-repository.js";
