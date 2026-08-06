import type {
  DevelopmentDocumentAppendVersionInput,
  DevelopmentDocumentCreateInput,
  DevelopmentDocumentGetInput,
  DevelopmentDocumentListInput,
  DevelopmentDocumentStatusInput,
  DevelopmentDocumentVersionGetInput,
  TaskDocumentBindInput
} from "../contracts/development-documents.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentDocumentKind,
  DevelopmentDocumentRecord,
  DevelopmentDocumentVersionRecord,
  TaskRecord
} from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface DevelopmentDocumentVersionSummary {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  changeSummary: string;
  createdAt: string;
}

export interface DevelopmentDocumentSummary {
  document: DevelopmentDocumentRecord;
  currentVersion: DevelopmentDocumentVersionSummary;
}

export interface DevelopmentDocumentDetail extends DevelopmentDocumentSummary {
  currentContent: DevelopmentDocumentVersionRecord;
  versions: DevelopmentDocumentVersionSummary[];
}

export interface DevelopmentDocumentMutationResult
  extends DevelopmentDocumentDetail {
  replayed: boolean;
}

export interface TaskDocumentBindResult {
  task: TaskRecord;
  spec: DevelopmentDocumentSummary | null;
  plan: DevelopmentDocumentSummary | null;
  replayed: boolean;
}

function redactPublicMarkdown(content: string): string {
  return content
    .replace(/\/(?:Users|home)\/[^\s`"')\]}]+/g, "<private-path>")
    .replace(/[A-Za-z]:\\[^\r\n`"')\]}]+/g, "<private-path>")
    .replace(
      /\b(API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*[^\s`]+/gi,
      (_match, label: string) => `${label}=<redacted>`
    );
}

function versionSummary(
  version: DevelopmentDocumentVersionRecord
): DevelopmentDocumentVersionSummary {
  return {
    id: version.id,
    documentId: version.documentId,
    version: version.version,
    contentHash: version.contentHash,
    changeSummary: version.changeSummary,
    createdAt: version.createdAt
  };
}

export class DevelopmentDocumentService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  create(
    context: OperationContext,
    input: DevelopmentDocumentCreateInput
  ): DevelopmentDocumentMutationResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "development-document.create",
      idempotencyKey,
      payload,
      () => {
        const project = this.repositories.projects.get(payload.projectId);
        const workspace = this.repositories.workspaces.get(payload.workspaceId);
        if (workspace.projectId !== project.id) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "The document workspace does not belong to the requested project."
          );
        }
        const created = this.repositories.developmentDocuments.create({
          projectId: project.id,
          workspaceId: workspace.id,
          kind: payload.kind,
          title: payload.title,
          contentMarkdown: payload.contentMarkdown,
          changeSummary: payload.changeSummary,
          now: context.now
        });
        return this.detail(context, created.document.id);
      },
      context.now
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  get(
    context: OperationContext,
    input: DevelopmentDocumentGetInput
  ): DevelopmentDocumentDetail {
    return this.detail(context, input.documentId);
  }

  getVersion(
    context: OperationContext,
    input: DevelopmentDocumentVersionGetInput
  ): DevelopmentDocumentVersionRecord {
    this.repositories.developmentDocuments.get(input.documentId);
    return this.projectVersion(
      context,
      this.repositories.developmentDocuments.getVersion(
        input.documentId,
        input.version
      )
    );
  }

  list(
    _context: OperationContext,
    input: DevelopmentDocumentListInput
  ): DevelopmentDocumentSummary[] {
    this.repositories.workspaces.get(input.workspaceId);
    return this.repositories.developmentDocuments
      .listByWorkspace(input.workspaceId, {
        kind: input.kind,
        status: input.status
      })
      .map((document) => this.summary(document));
  }

  appendVersion(
    context: OperationContext,
    input: DevelopmentDocumentAppendVersionInput
  ): DevelopmentDocumentMutationResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "development-document.append-version",
      idempotencyKey,
      payload,
      () => {
        this.repositories.developmentDocuments.appendVersion(
          payload.documentId,
          {
            contentMarkdown: payload.contentMarkdown,
            changeSummary: payload.changeSummary,
            expectedRevision: payload.expectedRevision,
            now: context.now
          }
        );
        return this.detail(context, payload.documentId);
      },
      context.now
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  updateStatus(
    context: OperationContext,
    input: DevelopmentDocumentStatusInput
  ): DevelopmentDocumentMutationResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "development-document.update-status",
      idempotencyKey,
      payload,
      () => {
        this.repositories.developmentDocuments.updateStatus(
          payload.documentId,
          payload.status,
          payload.expectedRevision,
          context.now
        );
        return this.detail(context, payload.documentId);
      },
      context.now
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  bindTaskDocuments(
    context: OperationContext,
    input: TaskDocumentBindInput
  ): TaskDocumentBindResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "task.bind-documents",
      idempotencyKey,
      payload,
      () => {
        const task = this.repositories.tasks.get(payload.taskId);
        if (task.revision !== payload.expectedTaskRevision) {
          throw new ServiceError(
            "REVISION_CONFLICT",
            `Task ${task.id} revision does not match.`,
            {
              details: {
                expectedRevision: payload.expectedTaskRevision,
                actualRevision: task.revision
              }
            }
          );
        }
        if (["completed", "cancelled"].includes(task.status)) {
          throw new ServiceError(
            "TASK_DOCUMENT_BINDING_BLOCKED",
            `Cannot replace documents on a ${task.status} task.`
          );
        }
        const spec = this.assignableDocument(
          payload.specId,
          "spec",
          task.projectId,
          task.workspaceId
        );
        const plan = this.assignableDocument(
          payload.planId,
          "plan",
          task.projectId,
          task.workspaceId
        );
        const updatedTask = this.repositories.tasks.bindDocuments(task.id, {
          specId: spec?.document.id ?? null,
          specVersion: spec?.document.currentVersion ?? null,
          planId: plan?.document.id ?? null,
          planVersion: plan?.document.currentVersion ?? null,
          expectedRevision: task.revision,
          now: context.now
        });
        return {
          task: updatedTask,
          spec,
          plan
        };
      },
      context.now
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  private assignableDocument(
    id: string | null,
    kind: DevelopmentDocumentKind,
    projectId: string,
    workspaceId: string
  ): DevelopmentDocumentSummary | null {
    if (!id) return null;
    const document = this.repositories.developmentDocuments.get(id);
    if (
      document.kind !== kind ||
      document.projectId !== projectId ||
      document.workspaceId !== workspaceId
    ) {
      throw new ServiceError(
        "CONTINUITY_DOCUMENT_RELATION_INVALID",
        `The selected ${kind} does not belong to the Task project workspace.`,
        {
          details: {
            documentId: id,
            expectedKind: kind,
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
        `A ${document.status} ${kind} cannot be bound to a Task.`,
        {
          details: { documentId: id, status: document.status }
        }
      );
    }
    return this.summary(document);
  }

  private summary(document: DevelopmentDocumentRecord): DevelopmentDocumentSummary {
    return {
      document,
      currentVersion: versionSummary(
        this.repositories.developmentDocuments.getCurrentVersion(document.id)
      )
    };
  }

  private detail(
    context: OperationContext,
    documentId: string
  ): DevelopmentDocumentDetail {
    const document = this.repositories.developmentDocuments.get(documentId);
    const versions = this.repositories.developmentDocuments.listVersions(document.id);
    const currentVersion = versions.find(
      (version) => version.version === document.currentVersion
    );
    if (!currentVersion) {
      throw new ServiceError(
        "DEVELOPMENT_DOCUMENT_VERSION_INVALID",
        `Document ${document.id} has no current version.`
      );
    }
    return {
      document,
      currentVersion: versionSummary(currentVersion),
      currentContent: this.projectVersion(context, currentVersion),
      versions: versions.map(versionSummary)
    };
  }

  private projectVersion(
    context: OperationContext,
    version: DevelopmentDocumentVersionRecord
  ): DevelopmentDocumentVersionRecord {
    if (!context.publicProjection) return version;
    return {
      ...version,
      contentMarkdown: redactPublicMarkdown(version.contentMarkdown)
    };
  }
}
