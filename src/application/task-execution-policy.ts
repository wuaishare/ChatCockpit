import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentDocumentKind,
  DevelopmentDocumentStatus,
  TaskExecutionPolicy,
  TaskRecord
} from "../continuity/types.js";
import { ServiceError } from "./service-error.js";

export type TaskPlanningRequirementState =
  | "not-bound"
  | "relation-invalid"
  | "unapproved"
  | "stale"
  | "approved-current";

export interface TaskPlanningRequirementAssessment {
  kind: DevelopmentDocumentKind;
  state: TaskPlanningRequirementState;
  documentId: string | null;
  pinnedVersion: number | null;
  currentVersion: number | null;
  status: DevelopmentDocumentStatus | null;
}

export interface TaskExecutionPolicyAssessment {
  taskId: string;
  policy: TaskExecutionPolicy;
  allowed: boolean;
  blockers: string[];
  spec: TaskPlanningRequirementAssessment;
  plan: TaskPlanningRequirementAssessment;
}

export class TaskExecutionPolicyService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  assess(task: TaskRecord): TaskExecutionPolicyAssessment {
    const spec = this.assessDocument(task, "spec", task.specId, task.specVersion);
    const plan = this.assessDocument(task, "plan", task.planId, task.planVersion);
    const blockers: string[] = [];

    if (task.executionPolicy === "planning-required") {
      if (spec.state !== "approved-current") blockers.push(this.blockerCode(spec));
      if (plan.state !== "approved-current") blockers.push(this.blockerCode(plan));
    }

    return {
      taskId: task.id,
      policy: task.executionPolicy,
      allowed: blockers.length === 0,
      blockers,
      spec,
      plan
    };
  }

  requireAllowed(task: TaskRecord): TaskExecutionPolicyAssessment {
    const assessment = this.assess(task);
    if (!assessment.allowed) {
      throw new ServiceError(
        "TASK_EXECUTION_POLICY_BLOCKED",
        "Task execution is blocked until the required Spec and Plan are approved and current.",
        {
          details: assessment
        }
      );
    }
    return assessment;
  }

  private assessDocument(
    task: TaskRecord,
    kind: DevelopmentDocumentKind,
    documentId: string | null,
    pinnedVersion: number | null
  ): TaskPlanningRequirementAssessment {
    if (!documentId || pinnedVersion === null) {
      return {
        kind,
        state: "not-bound",
        documentId,
        pinnedVersion,
        currentVersion: null,
        status: null
      };
    }

    let document;
    try {
      document = this.repositories.developmentDocuments.get(documentId);
      this.repositories.developmentDocuments.getVersion(documentId, pinnedVersion);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "CONTINUITY_RECORD_NOT_FOUND") {
        throw error;
      }
      return {
        kind,
        state: "relation-invalid",
        documentId,
        pinnedVersion,
        currentVersion: null,
        status: null
      };
    }

    if (
      document.kind !== kind ||
      document.projectId !== task.projectId ||
      document.workspaceId !== task.workspaceId
    ) {
      return {
        kind,
        state: "relation-invalid",
        documentId,
        pinnedVersion,
        currentVersion: document.currentVersion,
        status: document.status
      };
    }

    if (document.currentVersion !== pinnedVersion) {
      return {
        kind,
        state: "stale",
        documentId,
        pinnedVersion,
        currentVersion: document.currentVersion,
        status: document.status
      };
    }

    if (document.status !== "approved") {
      return {
        kind,
        state: "unapproved",
        documentId,
        pinnedVersion,
        currentVersion: document.currentVersion,
        status: document.status
      };
    }

    return {
      kind,
      state: "approved-current",
      documentId,
      pinnedVersion,
      currentVersion: document.currentVersion,
      status: document.status
    };
  }

  private blockerCode(
    requirement: TaskPlanningRequirementAssessment
  ): string {
    const prefix = requirement.kind.toUpperCase();
    switch (requirement.state) {
      case "not-bound":
        return `${prefix}_MISSING`;
      case "relation-invalid":
        return `${prefix}_RELATION_INVALID`;
      case "unapproved":
        return `${prefix}_UNAPPROVED`;
      case "stale":
        return `${prefix}_STALE`;
      case "approved-current":
        return `${prefix}_READY`;
    }
  }
}
