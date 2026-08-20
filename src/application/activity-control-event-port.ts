import type { JobControlAction, JobProcessState } from "../core/job-processes.js";

export interface ActivityControlEventRecord {
  sequence: number;
  id: string;
  jobId: string;
  action: JobControlAction;
  resultingState: JobProcessState;
  processRevision: number;
  createdAt: string;
}

export interface ActivityControlEventPage {
  events: ActivityControlEventRecord[];
  nextSequence: number | null;
}

export interface ActivityControlEventReader {
  latestSequence(): number;
  latestForJob(jobId: string): ActivityControlEventRecord | null;
  list(input?: { afterSequence?: number; limit?: number }): ActivityControlEventPage;
}
