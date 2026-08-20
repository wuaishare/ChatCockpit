import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import {
  commitPreparedJobProcessControl,
  prepareJobProcessControl,
  signalPreparedJobProcessControl,
  type JobProcessControlResult,
  type JobProcessSignalAdapter
} from "../core/job-processes.js";
import type { TokenPilotPaths } from "../types.js";
import type { JobProcessControlInput } from "../contracts/job-process.js";
import { OperationalActivityControlEventRepository } from "../governance/operational-activity-control-event-repository.js";

const OPERATION_NAME = "job.process.control.v1";

export interface GovernedJobProcessControlResult extends JobProcessControlResult {
  replayed: boolean;
}

export class JobProcessControlService {
  private readonly inFlightJobs = new Set<string>();

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    private readonly controlEvents: OperationalActivityControlEventRepository,
    private readonly signalAdapter?: JobProcessSignalAdapter
  ) {}

  async control(
    context: OperationContext,
    input: JobProcessControlInput
  ): Promise<GovernedJobProcessControlResult> {
    const replay = this.repositories.idempotency.replay<JobProcessControlResult>(
      OPERATION_NAME, input.idempotencyKey, input
    );
    if (replay) return { ...replay.value, replayed: true };

    if (this.inFlightJobs.has(input.jobId)) {
      throw new ServiceError(
        "JOB_PROCESS_CONTROL_IN_PROGRESS",
        `Another control operation is already in progress for job ${input.jobId}`
      );
    }
    this.inFlightJobs.add(input.jobId);
    try {
      const execution = await this.repositories.idempotency.executePreparedExternalMutation(
        OPERATION_NAME,
        input.idempotencyKey,
        input,
        () => prepareJobProcessControl(this.paths, input),
        async (prepared) => {
          signalPreparedJobProcessControl(prepared, this.signalAdapter);
          return true;
        },
        (prepared) => {
          const result = commitPreparedJobProcessControl(this.paths, prepared);
          this.controlEvents.append(context, {
            jobId: result.jobId,
            action: result.action,
            resultingState: result.state,
            processRevision: result.revision
          });
          return result;
        },
        undefined,
        context.now
      );
      return { ...execution.value, replayed: execution.replayed };
    } finally {
      this.inFlightJobs.delete(input.jobId);
    }
  }
}
