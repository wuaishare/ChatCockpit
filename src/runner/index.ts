import { AsyncJobReconciliationService } from "../application/async-job-reconciliation-service.js";
import {
  ContinuityDatabase,
  continuityDatabasePath
} from "../continuity/database.js";
import { buildContinuityRepositories } from "../continuity/repositories/index.js";
import { completeJob, claimNextQueuedJob, failJob, listJobs } from "../core/jobs.js";
import { runCodexRunJob } from "../core/codex-run.js";
import { getTrackedJobProcess } from "../core/job-processes.js";
import { productIdentityForKey } from "../core/product-identity.js";
import { OperationalActivityProvenanceRepository } from "../governance/operational-activity-provenance-repository.js";
import { LEGACY_DEFAULT_REPO_ID } from "../core/user-config-schema.js";
import { runPackForRepo } from "../core/pack.js";
import { createTaskPack } from "../core/taskpack.js";
import { buildRunnerOperationContext } from "./identity.js";
import {
  markRunnerClaimed,
  markRunnerCompleted,
  markRunnerFailed,
  markRunnerHeartbeat,
  markRunnerRecovered,
  markRunnerStarted,
  markRunnerStopped
} from "./status.js";
import type {
  PackJobPayload,
  CodexRunJobPayload,
  TaskPackJobPayload,
  TokenPilotJobPayload,
  TokenPilotPaths
} from "../types.js";

function isTaskPackPayload(payload: TokenPilotJobPayload): payload is TaskPackJobPayload {
  return (
    typeof (payload as TaskPackJobPayload).title === "string" &&
    typeof (payload as CodexRunJobPayload).instructions !== "string"
  );
}

function isCodexRunPayload(payload: TokenPilotJobPayload): payload is CodexRunJobPayload {
  return (
    typeof (payload as CodexRunJobPayload).repoId === "string" &&
    typeof (payload as CodexRunJobPayload).title === "string" &&
    typeof (payload as CodexRunJobPayload).instructions === "string"
  );
}

function isPackPayload(payload: TokenPilotJobPayload): payload is PackJobPayload {
  return (
    typeof (payload as PackJobPayload).repoId === "string" ||
    typeof (payload as { repoRoot?: string }).repoRoot === "string"
  );
}

function resolvePackRepoId(payload: TokenPilotJobPayload): string {
  if (typeof (payload as PackJobPayload).repoId === "string") {
    return (payload as PackJobPayload).repoId;
  }

  if (typeof (payload as { repoRoot?: string }).repoRoot === "string") {
    return LEGACY_DEFAULT_REPO_ID;
  }

  return "";
}

export interface RunnerOptions {
  intervalSeconds?: number;
  watch?: boolean;
}

interface RunnerReconciliationSummary {
  reconciled: number;
  errors: number;
}

async function sleep(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function reconcileTerminalRunningJobs(
  paths: TokenPilotPaths,
  reconciliation: AsyncJobReconciliationService
): RunnerReconciliationSummary {
  const identity = productIdentityForKey(paths.productIdentity);
  let reconciled = 0;
  let errors = 0;

  for (const job of listJobs(paths)) {
    if (job.status !== "running") {
      continue;
    }

    const processRecord = getTrackedJobProcess(paths, job.id);
    if (!processRecord || processRecord.state === "running" || processRecord.state === "paused") {
      continue;
    }

    const message = [
      `Tracked process is ${processRecord.state}, but job was still marked running.`,
      "Runner reconciled the stale running job; rerun the task if a persisted result is required."
    ].join(" ");
    const failed = failJob(paths, job.id, message);
    try {
      reconciliation.reconcileTerminal(
        buildRunnerOperationContext(paths, job.id),
        failed
      );
    } catch (error) {
      const reconciliationError =
        error instanceof Error ? error.message : String(error);
      markRunnerFailed(paths, reconciliationError);
      errors += 1;
    }
    markRunnerFailed(paths, message);
    errors += 1;
    reconciled += 1;

    process.stdout.write(
      [
        `[${identity.displayName} runner]`,
        "mode=reconcile",
        `job=${job.id}`,
        `processState=${processRecord.state}`
      ].join(" ") + "\n"
    );
  }

  return { reconciled, errors };
}

function reconcilePersistedTerminalJobs(
  paths: TokenPilotPaths,
  reconciliation: AsyncJobReconciliationService
): RunnerReconciliationSummary {
  let reconciled = 0;
  let errors = 0;
  for (const job of listJobs(paths)) {
    if (job.status !== "completed" && job.status !== "failed") continue;
    try {
      const result = reconciliation.reconcileTerminal(
        buildRunnerOperationContext(paths, job.id, job.updatedAt),
        job
      );
      if (result && !result.replayed) reconciled += 1;
    } catch (error) {
      markRunnerFailed(
        paths,
        error instanceof Error ? error.message : String(error)
      );
      errors += 1;
    }
  }
  return { reconciled, errors };
}

async function runNextJob(
  paths: TokenPilotPaths,
  reconciliation: AsyncJobReconciliationService,
  activityProvenance: OperationalActivityProvenanceRepository,
  workerInstanceId: string
): Promise<boolean> {
  const identity = productIdentityForKey(paths.productIdentity);
  const startedAt = new Date().toISOString();
  const runningReconciliation = reconcileTerminalRunningJobs(paths, reconciliation);
  const persistedReconciliation = reconcilePersistedTerminalJobs(paths, reconciliation);
  const reconciledCount =
    runningReconciliation.reconciled + persistedReconciliation.reconciled;
  const reconciliationErrorCount =
    runningReconciliation.errors + persistedReconciliation.errors;
  const job = claimNextQueuedJob(paths);

  if (!job) {
    if (reconciliationErrorCount === 0) {
      markRunnerRecovered(paths);
    }
    return reconciledCount > 0;
  }

  markRunnerClaimed(paths, job.id, job.type);
  if (activityProvenance.get(job.id)) {
    activityProvenance.assignWorker(
      job.id,
      workerInstanceId,
      new Date().toISOString()
    );
  }
  try {
    reconciliation.claim(
      buildRunnerOperationContext(paths, job.id, job.updatedAt),
      job
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = failJob(paths, job.id, message);
    try {
      reconciliation.reconcileTerminal(
        buildRunnerOperationContext(paths, job.id),
        failed
      );
    } catch {
      // The original identity failure is the authoritative Runner error.
    }
    markRunnerFailed(paths, message);
    return true;
  }

  process.stdout.write(
    [
      `[${identity.displayName} runner]`,
      `mode=phase2-dual-mode`,
      `job=${job.id}`,
      `type=${job.type}`,
      `startedAt=${startedAt}`
    ].join(" ") + "\n"
  );

  try {
    if (job.type === "pack" && isPackPayload(job.payload)) {
      const repoId = resolvePackRepoId(job.payload);
      const manifest = runPackForRepo(paths, repoId);
      completeJob(paths, job.id, manifest);
      markRunnerCompleted(paths);
      return true;
    }

    if (job.type === "taskpack" && isTaskPackPayload(job.payload)) {
      const artifact = createTaskPack(paths, job.payload);
      completeJob(paths, job.id, artifact);
      markRunnerCompleted(paths);
      return true;
    }

    if (job.type === "codex-run" && isCodexRunPayload(job.payload)) {
      const result = await runCodexRunJob(paths, job.id, job.payload);
      const completed = completeJob(paths, job.id, result);
      try {
        reconciliation.reconcileTerminal(
          buildRunnerOperationContext(paths, job.id, completed.updatedAt),
          completed
        );
        markRunnerCompleted(paths);
      } catch (error) {
        markRunnerFailed(
          paths,
          error instanceof Error ? error.message : String(error)
        );
      }
      return true;
    }

    const unsupported = `Unsupported job payload for type: ${job.type}`;
    const failed = failJob(paths, job.id, unsupported);
    reconciliation.reconcileTerminal(
      buildRunnerOperationContext(paths, job.id),
      failed
    );
    markRunnerFailed(paths, unsupported);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    const failed = failJob(paths, job.id, message);
    try {
      reconciliation.reconcileTerminal(
        buildRunnerOperationContext(paths, job.id),
        failed
      );
    } catch (reconciliationError) {
      markRunnerFailed(
        paths,
        reconciliationError instanceof Error
          ? reconciliationError.message
          : String(reconciliationError)
      );
    }
    markRunnerFailed(paths, message);
  }

  return true;
}

export async function runRunner(
  paths: TokenPilotPaths,
  options: RunnerOptions = {}
): Promise<void> {
  const identity = productIdentityForKey(paths.productIdentity);
  const intervalSeconds = options.intervalSeconds ?? 3;
  const runnerStatus = markRunnerStarted(paths, options.watch ? "watch" : "once");
  const continuityDatabase = new ContinuityDatabase({
    path: continuityDatabasePath(paths.runtimeDir)
  });
  const reconciliation = new AsyncJobReconciliationService(
    buildContinuityRepositories(continuityDatabase, {
      asyncRunnerRuntimeKind: productIdentityForKey(paths.productIdentity).asyncRunnerRuntimeKind
    })
  );
  const activityProvenance = new OperationalActivityProvenanceRepository(continuityDatabase);

  if (!options.watch) {
    try {
      const didProcessJob = await runNextJob(
        paths,
        reconciliation,
        activityProvenance,
        runnerStatus.workerInstanceId
      );
      markRunnerHeartbeat(paths);
      if (!didProcessJob) {
        process.stdout.write(
          [
            `[${identity.displayName} runner]`,
            "mode=once",
            `repoId=${identity.defaultRepoId}`,
            `startedAt=${new Date().toISOString()}`,
            "No queued jobs found."
          ].join(" ") + "\n"
        );
      }
    } finally {
      continuityDatabase.close();
      markRunnerStopped(paths);
    }
    return;
  }

  let stopRequested = false;
  let isIdle = false;
  const handleStop = (signal: string) => {
    if (stopRequested) return;
    stopRequested = true;
    process.stdout.write(
      `[${identity.displayName} runner] mode=watch signal=${signal} Stopping after current cycle.\n`
    );
  };

  process.once("SIGINT", () => handleStop("SIGINT"));
  process.once("SIGTERM", () => handleStop("SIGTERM"));

  process.stdout.write(
    [
      `[${identity.displayName} runner]`,
      "mode=watch",
      `repoId=${identity.defaultRepoId}`,
      `interval=${intervalSeconds}s`,
      `startedAt=${new Date().toISOString()}`
    ].join(" ") + "\n"
  );

  try {
    while (!stopRequested) {
      markRunnerHeartbeat(paths);
      const didProcessJob = await runNextJob(
        paths,
        reconciliation,
        activityProvenance,
        runnerStatus.workerInstanceId
      );

      if (didProcessJob) {
        isIdle = false;
        continue;
      }

      if (!isIdle) {
        isIdle = true;
        process.stdout.write(
          `[${identity.displayName} runner] mode=watch repoId=${identity.defaultRepoId} No queued jobs found. Waiting ${intervalSeconds}s.\n`
        );
      }

      await sleep(intervalSeconds);
    }
  } finally {
    continuityDatabase.close();
    markRunnerStopped(paths);
    process.stdout.write(
      `[${identity.displayName} runner] mode=watch Graceful shutdown complete.\n`
    );
  }
}
