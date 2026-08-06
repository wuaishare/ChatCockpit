import type { TaskCreateInput } from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { TaskRecord } from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface TaskCreateResult {
  task: TaskRecord;
  replayed: boolean;
}

export class TaskService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  create(_context: OperationContext, input: TaskCreateInput): TaskCreateResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "task.create",
      idempotencyKey,
      payload,
      () => {
        const project = this.repositories.projects.get(payload.projectId);
        const workspace = this.repositories.workspaces.get(payload.workspaceId);
        if (workspace.projectId !== project.id) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "The workspace does not belong to the requested project"
          );
        }
        if (payload.parentTaskId) {
          const parent = this.repositories.tasks.get(payload.parentTaskId);
          if (
            parent.projectId !== project.id ||
            parent.workspaceId !== workspace.id
          ) {
            throw new ServiceError(
              "CONTINUITY_RELATION_INVALID",
              "The parent task does not belong to the requested project workspace"
            );
          }
        }
        const specVersion = this.assertDocumentBinding(
          payload.specId ?? null,
          "spec",
          project.id,
          workspace.id
        );
        const planVersion = this.assertDocumentBinding(
          payload.planId ?? null,
          "plan",
          project.id,
          workspace.id
        );
        return this.repositories.tasks.create({
          projectId: project.id,
          workspaceId: workspace.id,
          specId: payload.specId,
          specVersion,
          planId: payload.planId,
          planVersion,
          parentTaskId: payload.parentTaskId,
          title: payload.title,
          goal: payload.goal,
          status: "backlog",
          priority: payload.priority,
          executionPolicy: payload.executionPolicy
        });
      }
    );
    return {
      task: execution.value,
      replayed: execution.replayed
    };
  }

  get(_context: OperationContext, taskId: string): TaskRecord {
    return this.repositories.tasks.get(taskId);
  }

  private assertDocumentBinding(
    documentId: string | null,
    expectedKind: "spec" | "plan",
    projectId: string,
    workspaceId: string
  ): number | null {
    if (!documentId) return null;
    const document = this.repositories.developmentDocuments.get(documentId);
    if (
      document.kind !== expectedKind ||
      document.projectId !== projectId ||
      document.workspaceId !== workspaceId
    ) {
      throw new ServiceError(
        "CONTINUITY_DOCUMENT_RELATION_INVALID",
        `Task ${expectedKind} reference does not belong to the requested project workspace.`,
        {
          details: {
            documentId,
            expectedKind,
            actualKind: document.kind,
            documentProjectId: document.projectId,
            documentWorkspaceId: document.workspaceId
          }
        }
      );
    }
    if (["superseded", "archived"].includes(document.status)) {
      throw new ServiceError(
        "CONTINUITY_DOCUMENT_STATUS_INVALID",
        `Task cannot bind a ${document.status} ${expectedKind}.`,
        {
          details: {
            documentId,
            documentStatus: document.status
          }
        }
      );
    }
    return document.currentVersion;
  }
}
