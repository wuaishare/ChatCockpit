import fs from "node:fs";

import { summarizeJobsReadOnly } from "../core/jobs.js";
import type { TokenPilotPaths } from "../types.js";
import {
  ContinuityDatabase,
  continuityDatabasePath
} from "../continuity/database.js";
import {
  buildContinuityRepositories,
  type ContinuityRepositories
} from "../continuity/repositories/index.js";

export type DesktopSummaryUnavailableReason =
  | "job-store-unavailable"
  | "continuity-store-unavailable";

export interface DesktopOperationalJobSummary {
  available: boolean;
  running: number | null;
  queued: number | null;
  failed: number | null;
  unavailableReason?: DesktopSummaryUnavailableReason;
}

export interface DesktopOperationalApprovalSummary {
  available: boolean;
  pending: number | null;
  runtime: number | null;
  hostMutation: number | null;
  hostCommand: number | null;
  hostProcess: number | null;
  runtimeResourceMutation: number | null;
  unavailableReason?: DesktopSummaryUnavailableReason;
}

export interface DesktopOperationalSummary {
  schemaVersion: 1;
  generatedAt: string;
  jobs: DesktopOperationalJobSummary;
  approvals: DesktopOperationalApprovalSummary;
}

function availableApprovalSummary(
  repositories: ContinuityRepositories,
  now: string
): DesktopOperationalApprovalSummary {
  const runtime = repositories.runtimeApprovals.countPending();
  const hostMutation = repositories.directMutationApprovals.countPending(now);
  const hostCommand = repositories.directCommandApprovals.countPending(now);
  const hostProcess = repositories.directProcessApprovals.countPending(now);
  const runtimeResourceMutation = repositories.runtimeResourceMutations.countPending(now);

  return {
    available: true,
    pending:
      runtime +
      hostMutation +
      hostCommand +
      hostProcess +
      runtimeResourceMutation,
    runtime,
    hostMutation,
    hostCommand,
    hostProcess,
    runtimeResourceMutation
  };
}

export function buildDesktopOperationalSummary(
  paths: TokenPilotPaths,
  repositories: ContinuityRepositories,
  now = new Date().toISOString()
): DesktopOperationalSummary {
  const jobs = summarizeJobsReadOnly(paths);
  return {
    schemaVersion: 1,
    generatedAt: now,
    jobs: {
      available: true,
      running: jobs.running,
      queued: jobs.queued,
      failed: jobs.failed
    },
    approvals: availableApprovalSummary(repositories, now)
  };
}

export function readDesktopOperationalSummary(
  paths: TokenPilotPaths,
  now = new Date().toISOString()
): DesktopOperationalSummary {
  let jobs: DesktopOperationalJobSummary = {
    available: false,
    running: null,
    queued: null,
    failed: null,
    unavailableReason: "job-store-unavailable"
  };
  if (fs.existsSync(paths.jobsDir)) {
    try {
      const summary = summarizeJobsReadOnly(paths);
      jobs = {
        available: true,
        running: summary.running,
        queued: summary.queued,
        failed: summary.failed
      };
    } catch {
      // The public-safe summary reports unavailability without exposing local file details.
    }
  }

  let approvals: DesktopOperationalApprovalSummary = {
    available: false,
    pending: null,
    runtime: null,
    hostMutation: null,
    hostCommand: null,
    hostProcess: null,
    runtimeResourceMutation: null,
    unavailableReason: "continuity-store-unavailable"
  };

  const databasePath = continuityDatabasePath(paths.runtimeDir);
  if (fs.existsSync(databasePath)) {
    let database: ContinuityDatabase | null = null;
    try {
      database = new ContinuityDatabase({ path: databasePath, readOnly: true });
      approvals = availableApprovalSummary(
        buildContinuityRepositories(database),
        now
      );
    } catch {
      // The public-safe summary reports unavailability without exposing local database details.
    } finally {
      database?.close();
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: now,
    jobs,
    approvals
  };
}
