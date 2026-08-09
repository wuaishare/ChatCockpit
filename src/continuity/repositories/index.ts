import type { ContinuityDatabase } from "../database.js";
import { DevelopmentDocumentRepository } from "./development-document-repository.js";
import { DirectCommandApprovalRepository } from "./direct-command-approval-repository.js";
import { DirectCommandAuditRepository } from "./direct-command-audit-repository.js";
import { DirectMutationApprovalRepository } from "./direct-mutation-approval-repository.js";
import { DirectMutationAuditRepository } from "./direct-mutation-audit-repository.js";
import { DirectProcessApprovalRepository } from "./direct-process-approval-repository.js";
import { DirectProcessAuditRepository } from "./direct-process-audit-repository.js";
import { DirectProcessSessionRepository } from "./direct-process-session-repository.js";
import { DirectProcessRuntimeOwnershipRepository } from "./direct-process-runtime-ownership-repository.js";
import { EvidenceRepository } from "./evidence-repository.js";
import { HandoffRepository } from "./handoff-repository.js";
import { IdempotencyRepository } from "./idempotency-repository.js";
import { LeaseRepository } from "./lease-repository.js";
import { ProjectRepository } from "./project-repository.js";
import { RuntimeApprovalRepository } from "./runtime-approval-repository.js";
import { RuntimeBindingRepository } from "./runtime-binding-repository.js";
import { RuntimeEventRepository } from "./runtime-event-repository.js";
import { RuntimeRunRepository } from "./runtime-run-repository.js";
import { RuntimeRecoveryAttemptRepository } from "./runtime-recovery-attempt-repository.js";
import { RuntimeResourceSnapshotRepository } from "./runtime-resource-snapshot-repository.js";
import { SessionRepository } from "./session-repository.js";
import { TaskRepository } from "./task-repository.js";
import { WorkspaceRepository } from "./workspace-repository.js";

export interface ContinuityRepositories {
  projects: ProjectRepository;
  developmentDocuments: DevelopmentDocumentRepository;
  directCommandApprovals: DirectCommandApprovalRepository;
  directCommandAudit: DirectCommandAuditRepository;
  directMutationApprovals: DirectMutationApprovalRepository;
  directMutationAudit: DirectMutationAuditRepository;
  directProcessApprovals: DirectProcessApprovalRepository;
  directProcessAudit: DirectProcessAuditRepository;
  directProcessSessions: DirectProcessSessionRepository;
  directProcessRuntimeOwnership: DirectProcessRuntimeOwnershipRepository;
  runtimeApprovals: RuntimeApprovalRepository;
  runtimeBindings: RuntimeBindingRepository;
  runtimeEvents: RuntimeEventRepository;
  runtimeRuns: RuntimeRunRepository;
  runtimeRecoveryAttempts: RuntimeRecoveryAttemptRepository;
  runtimeResourceSnapshots: RuntimeResourceSnapshotRepository;
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
    directCommandApprovals: new DirectCommandApprovalRepository(database),
    directCommandAudit: new DirectCommandAuditRepository(database),
    directMutationApprovals: new DirectMutationApprovalRepository(database),
    directMutationAudit: new DirectMutationAuditRepository(database),
    directProcessApprovals: new DirectProcessApprovalRepository(database),
    directProcessAudit: new DirectProcessAuditRepository(database),
    directProcessSessions: new DirectProcessSessionRepository(database),
    directProcessRuntimeOwnership: new DirectProcessRuntimeOwnershipRepository(database),
    runtimeApprovals: new RuntimeApprovalRepository(database),
    runtimeBindings: new RuntimeBindingRepository(database),
    runtimeEvents: new RuntimeEventRepository(database),
    runtimeRuns: new RuntimeRunRepository(database),
    runtimeRecoveryAttempts: new RuntimeRecoveryAttemptRepository(database),
    runtimeResourceSnapshots: new RuntimeResourceSnapshotRepository(database),
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
export { DirectCommandApprovalRepository } from "./direct-command-approval-repository.js";
export { DirectCommandAuditRepository } from "./direct-command-audit-repository.js";
export { DirectMutationApprovalRepository } from "./direct-mutation-approval-repository.js";
export { DirectMutationAuditRepository } from "./direct-mutation-audit-repository.js";
export { DirectProcessApprovalRepository } from "./direct-process-approval-repository.js";
export { DirectProcessAuditRepository } from "./direct-process-audit-repository.js";
export { DirectProcessSessionRepository } from "./direct-process-session-repository.js";
export { DirectProcessRuntimeOwnershipRepository } from "./direct-process-runtime-ownership-repository.js";
export { EvidenceRepository } from "./evidence-repository.js";
export { HandoffRepository } from "./handoff-repository.js";
export { IdempotencyRepository } from "./idempotency-repository.js";
export { LeaseRepository } from "./lease-repository.js";
export { ProjectRepository } from "./project-repository.js";
export { RuntimeApprovalRepository } from "./runtime-approval-repository.js";
export { RuntimeBindingRepository } from "./runtime-binding-repository.js";
export { RuntimeEventRepository } from "./runtime-event-repository.js";
export { RuntimeRunRepository } from "./runtime-run-repository.js";
export { RuntimeRecoveryAttemptRepository } from "./runtime-recovery-attempt-repository.js";
export { RuntimeResourceSnapshotRepository } from "./runtime-resource-snapshot-repository.js";
export { SessionRepository } from "./session-repository.js";
export { TaskRepository } from "./task-repository.js";
export { WorkspaceRepository } from "./workspace-repository.js";
