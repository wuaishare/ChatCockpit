import type { EvidenceRecordInput } from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  EvidenceBundleRecord,
  EvidenceItemRecord,
  TaskRecord
} from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface EvidenceRecordResult {
  bundle: EvidenceBundleRecord;
  item: EvidenceItemRecord;
  task: TaskRecord;
  replayed: boolean;
}

export class EvidenceService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  record(
    _context: OperationContext,
    input: EvidenceRecordInput
  ): EvidenceRecordResult {
    const { idempotencyKey, expectedTaskRevision, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "evidence.record",
      idempotencyKey,
      { ...payload, expectedTaskRevision },
      () => {
        const task = this.repositories.tasks.get(payload.taskId);
        const session = this.repositories.sessions.get(payload.sessionId);
        if (
          session.taskId !== task.id ||
          session.projectId !== task.projectId ||
          session.workspaceId !== task.workspaceId
        ) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "The session does not belong to the requested task and workspace"
          );
        }

        let bundle: EvidenceBundleRecord;
        let updatedTask = task;
        if (payload.bundleId) {
          bundle = this.repositories.evidence.getBundle(payload.bundleId);
          if (bundle.taskId !== task.id || bundle.sessionId !== session.id) {
            throw new ServiceError(
              "CONTINUITY_RELATION_INVALID",
              "The evidence bundle does not belong to the requested task and session"
            );
          }
        } else {
          if (expectedTaskRevision === undefined) {
            throw new ServiceError(
              "EXPECTED_REVISION_REQUIRED",
              "expectedTaskRevision is required when creating a new evidence bundle"
            );
          }
          bundle = this.repositories.evidence.createBundle({
            taskId: task.id,
            sessionId: session.id
          });
          updatedTask = this.repositories.tasks.setLatestEvidenceBundle(
            task.id,
            bundle.id,
            expectedTaskRevision
          );
        }

        const item = this.repositories.evidence.addItem({
          bundleId: bundle.id,
          kind: payload.kind,
          label: payload.label,
          status: payload.status,
          required: payload.required,
          command: payload.command,
          exitCode: payload.exitCode,
          artifactId: payload.artifactId,
          summary: payload.summary,
          startedAt: payload.startedAt,
          completedAt: payload.completedAt
        });
        bundle = this.repositories.evidence.getBundle(bundle.id);
        return {
          bundle,
          item,
          task: updatedTask
        };
      }
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }
}
