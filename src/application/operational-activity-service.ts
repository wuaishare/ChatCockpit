import type { ActivityProvenanceReader } from "./activity-provenance-port.js";
import {
  projectDeviceRuntimeOperationEvent,
  projectOperationalActivityControlEvent,
  projectOperationalActivityEvent,
  type OperationalActivityEventProjection
} from "./operational-activity-event-projector.js";
import type { ActivityControlEventReader } from "./activity-control-event-port.js";
import type {
  DeviceRuntimeOperationRecord,
  DeviceRuntimeOperationRepository
} from "../governance/device-runtime-operation-repository.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  RuntimeBindingRecord,
  RuntimeRunRecord
} from "../continuity/types.js";
import { getTrackedJobProcess } from "../core/job-processes.js";
import { listJobs } from "../core/jobs.js";
import type {
  JobRecord,
  JobStatus,
  JobType,
  TokenPilotJobPayload,
  TokenPilotPaths
} from "../types.js";

export type OperationalActivityKind = "agent-session" | "job" | "device-operation";
export type OperationalActivityScope = "workspace" | "repo" | "host";
export type OperationalActivityStatus =
  | "queued"
  | "idle"
  | "running"
  | "waiting-approval"
  | "paused"
  | "handoff-ready"
  | "completed"
  | "failed"
  | "interrupted"
  | "terminated"
  | "stale";

export type OperationalActivityRuntimeKind = "codex-app-server" | "async-runner";

export interface OperationalActivityRuntimeProjection {
  bindingId: string;
  runtimeKind: OperationalActivityRuntimeKind;
  bindingStatus: RuntimeBindingRecord["status"];
  externalSessionId: string | null;
  externalRunId: string | null;
  externalThreadId: string | null;
  runId: string | null;
  runRevision: number | null;
  turnId: string | null;
  runStatus: RuntimeRunRecord["status"] | null;
}

export interface OperationalActivityProjection {
  id: string;
  kind: OperationalActivityKind;
  scope: OperationalActivityScope;
  status: OperationalActivityStatus;
  title: string;
  targetDeviceId: string;
  projectId: string | null;
  workspaceId: string | null;
  taskId: string | null;
  repoId: string | null;
  agentSessionId: string | null;
  authorizationGrantId: string | null;
  actorType: "local-cli" | "local-ui" | "rest-api" | "gpt-actions" | "remote-mcp" | "runner" | null;
  traceId: string | null;
  workerInstanceId: string | null;
  runtime: OperationalActivityRuntimeProjection | null;
  deviceOperation: {
    operationId: string;
    deviceId: string;
    deviceDisplayName: string;
    platform: string | null;
    architecture: string | null;
    action: DeviceRuntimeOperationRecord["action"];
    state: DeviceRuntimeOperationRecord["state"];
    actorType: DeviceRuntimeOperationRecord["requestedActor"]["actorType"];
    revision: number;
  } | null;
  job: {
    id: string;
    type: JobType;
    status: JobStatus;
    processState: "running" | "paused" | "terminated" | "completed" | "failed" | null;
    processLabel: string | null;
    processRevision: number | null;
  } | null;
  directProcessSummary: {
    total: number;
    active: number;
    running: number;
  };
  latestEvent: OperationalActivityEventProjection | null;
  controls: {
    pause: boolean;
    resume: boolean;
    terminate: boolean;
    interrupt: boolean;
    hold: false;
  };
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface OperationalActivityEventPageResult {
  events: OperationalActivityEventProjection[];
  cursor: number;
  hasMore: boolean;
}

export interface OperationalActivityTimelineResult {
  activityId: string;
  events: OperationalActivityEventProjection[];
}

export interface DeviceOperationalActivityProjectionOptions {
  operations: DeviceRuntimeOperationRepository;
  resolveDevice(deviceId: string): {
    id: string;
    displayName: string;
    platform: string;
    architecture: string;
  } | null;
}

export interface OperationalActivityListResult {
  activities: OperationalActivityProjection[];
  counts: {
    total: number;
    active: number;
    running: number;
    waitingApproval: number;
    paused: number;
  };
}

function continuitySessionId(job: JobRecord<TokenPilotJobPayload>): string | null {
  const value = (job.payload as { continuitySessionId?: unknown }).continuitySessionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function repoId(job: JobRecord<TokenPilotJobPayload>): string | null {
  const value = (job.payload as { repoId?: unknown }).repoId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jobTitle(job: JobRecord<TokenPilotJobPayload>): string {
  const title = (job.payload as { title?: unknown }).title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const repository = repoId(job);
  if (repository) return `${job.type}: ${repository}`;
  return job.type === "taskpack" ? "Task pack" : "ChatCockpit job";
}

function latestTimestamp(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? new Date(0).toISOString();
}

function statusFromJob(
  job: JobRecord<TokenPilotJobPayload>,
  processState: ReturnType<typeof getTrackedJobProcess> extends infer T
    ? T extends { state: infer S } | null ? S | null : never
    : never
): OperationalActivityStatus {
  if (processState === "paused") return "paused";
  if (processState === "terminated") return "terminated";
  if (processState === "failed") return "failed";
  if (processState === "completed") return "completed";
  if (processState === "running") return "running";
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "failed") return "failed";
  return "completed";
}

function runtimeStatus(
  session: DevelopmentSessionRecord,
  run: RuntimeRunRecord | null,
  linkedJob: JobRecord<TokenPilotJobPayload> | null,
  processState: "running" | "paused" | "terminated" | "completed" | "failed" | null
): OperationalActivityStatus {
  if (processState === "paused") return "paused";
  if (processState === "terminated") return "terminated";
  if (processState === "failed") return "failed";
  if (run?.status === "waiting-approval" || session.status === "waiting-approval") return "waiting-approval";
  if (run?.status === "interrupted") return "interrupted";
  if (run?.status === "stale") return "stale";
  if (run?.status === "starting" || run?.status === "running") return "running";
  if (linkedJob?.status === "queued" && session.status === "running") return "queued";
  if (linkedJob?.status === "failed" && session.status === "running") return "failed";
  if (linkedJob?.status === "completed" && session.status === "running") return "completed";
  return session.status;
}

function publicRuntimeKind(binding: RuntimeBindingRecord): OperationalActivityRuntimeKind {
  return binding.runtimeKind === "codex-app-server" ? "codex-app-server" : "async-runner";
}

function isActive(status: OperationalActivityStatus): boolean {
  return !["completed", "failed", "interrupted", "terminated", "stale"].includes(status);
}

function newestActivityEvent(
  first: OperationalActivityEventProjection | null,
  second: OperationalActivityEventProjection | null
): OperationalActivityEventProjection | null {
  if (!first) return second;
  if (!second) return first;
  if (first.createdAt !== second.createdAt) return first.createdAt > second.createdAt ? first : second;
  if (first.source === second.source) return first.sequence >= second.sequence ? first : second;
  return first.source > second.source ? first : second;
}

export class OperationalActivityService {
  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    private readonly activityProvenance?: ActivityProvenanceReader,
    private readonly activityControlEvents?: ActivityControlEventReader,
    private readonly deviceRuntime?: DeviceOperationalActivityProjectionOptions
  ) {}

  timeline(activityId: string, limit = 50): OperationalActivityTimelineResult | null {
    const boundedLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const snapshot = this.list();
    const activity = snapshot.activities.find((item) => item.id === activityId);
    if (!activity) return null;

    if (activity.kind === "device-operation") {
      const operation = this.deviceRuntime?.operations.find(activity.id) ?? null;
      return {
        activityId: activity.id,
        events: operation ? [projectDeviceRuntimeOperationEvent(operation)] : []
      };
    }

    const runtimeEvents = activity.kind === "agent-session"
      ? this.repositories.runtimeEvents
          .listRecentForSession(activity.id, boundedLimit)
          .map(projectOperationalActivityEvent)
      : [];
    const controlEvents = activity.job && this.activityControlEvents
      ? this.activityControlEvents
          .listRecentForJob(activity.job.id, boundedLimit)
          .map((event) => projectOperationalActivityControlEvent(event, activity.id))
      : [];
    const events = [...runtimeEvents, ...controlEvents]
      .sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.source.localeCompare(b.source) ||
        a.sequence - b.sequence
      )
      .slice(-boundedLimit);
    return { activityId: activity.id, events };
  }

  list(): OperationalActivityListResult {
    const sessions = this.repositories.sessions.listAll();
    const jobs = listJobs(this.paths);
    const jobsBySession = new Map<string, JobRecord<TokenPilotJobPayload>>();
    for (const job of jobs) {
      const sessionId = continuitySessionId(job);
      if (!sessionId) continue;
      const current = jobsBySession.get(sessionId);
      if (!current || job.updatedAt > current.updatedAt) jobsBySession.set(sessionId, job);
    }

    const sessionIds = new Set(sessions.map((session) => session.id));
    const deviceOperations = this.deviceRuntime?.operations.listRecent(200) ?? [];
    const activities = [
      ...sessions.map((session) => this.projectSession(session, jobsBySession.get(session.id) ?? null)),
      ...jobs
        .filter((job) => {
          const sessionId = continuitySessionId(job);
          return !sessionId || !sessionIds.has(sessionId);
        })
        .map((job) => this.projectJob(job)),
      ...deviceOperations.map((operation) => this.projectDeviceOperation(operation))
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.startedAt.localeCompare(a.startedAt));

    return {
      activities,
      counts: {
        total: activities.length,
        active: activities.filter((activity) => isActive(activity.status)).length,
        running: activities.filter((activity) => activity.status === "running").length,
        waitingApproval: activities.filter((activity) => activity.status === "waiting-approval").length,
        paused: activities.filter((activity) => activity.status === "paused").length
      }
    };
  }

  currentEventCursor(): number {
    return this.repositories.runtimeEvents.latestSequence();
  }

  currentControlEventCursor(): number {
    return this.activityControlEvents?.latestSequence() ?? 0;
  }

  listEventsAfter(afterSequence: number, limit = 200): OperationalActivityEventPageResult {
    const cursor = Number.isFinite(afterSequence) && afterSequence > 0
      ? Math.floor(afterSequence)
      : 0;
    const page = this.repositories.runtimeEvents.list({
      afterSequence: cursor,
      limit
    });
    const events = page.events.map(projectOperationalActivityEvent);
    return {
      events,
      cursor: events.at(-1)?.sequence ?? cursor,
      hasMore: page.nextSequence !== null
    };
  }

  listControlEventsAfter(afterSequence: number, limit = 200): OperationalActivityEventPageResult {
    const cursor = Number.isFinite(afterSequence) && afterSequence > 0
      ? Math.floor(afterSequence)
      : 0;
    if (!this.activityControlEvents) return { events: [], cursor, hasMore: false };
    const page = this.activityControlEvents.list({ afterSequence: cursor, limit });
    const sessions = new Set(this.repositories.sessions.listAll().map((session) => session.id));
    const jobs = new Map(listJobs(this.paths).map((job) => [job.id, job] as const));
    const events = page.events.map((event) => {
      const job = jobs.get(event.jobId);
      const sessionId = job ? continuitySessionId(job) : null;
      const activityId = sessionId && sessions.has(sessionId) ? sessionId : event.jobId;
      return projectOperationalActivityControlEvent(event, activityId);
    });
    return {
      events,
      cursor: events.at(-1)?.sequence ?? cursor,
      hasMore: page.nextSequence !== null
    };
  }

  currentDeviceOperationRevisions(): Record<string, number> {
    const revisions: Record<string, number> = {};
    for (const operation of this.deviceRuntime?.operations.listRecent(500) ?? []) {
      revisions[operation.id] = operation.revision;
    }
    return revisions;
  }

  listDeviceOperationEventsAfter(
    revisions: Readonly<Record<string, number>>
  ): OperationalActivityEventProjection[] {
    return (this.deviceRuntime?.operations.listRecent(500) ?? [])
      .filter((operation) => operation.revision > (revisions[operation.id] ?? 0))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
      .map(projectDeviceRuntimeOperationEvent);
  }

  private projectDeviceOperation(
    operation: DeviceRuntimeOperationRecord
  ): OperationalActivityProjection {
    const device = this.deviceRuntime?.resolveDevice(operation.deviceId) ?? null;
    const displayName = device?.displayName ?? operation.deviceId;
    const status: OperationalActivityStatus =
      operation.state === "succeeded" ? "completed" :
      operation.state === "failed" ? "failed" :
      operation.state === "stale" ? "stale" :
      operation.state === "ambiguous" ? "interrupted" :
      operation.state === "awaiting-approval" ? "waiting-approval" :
      operation.state === "executing" ? "running" : "queued";
    const latestEvent = projectDeviceRuntimeOperationEvent(operation);
    return {
      id: operation.id,
      kind: "device-operation",
      scope: "host",
      status,
      title: `${displayName} · ${operation.action} Runtime`,
      targetDeviceId: operation.deviceId,
      projectId: null,
      workspaceId: null,
      taskId: null,
      repoId: null,
      agentSessionId: null,
      authorizationGrantId: operation.authorizationGrantId,
      actorType: operation.executedActor.actorType ?? operation.requestedActor.actorType,
      traceId: null,
      workerInstanceId: null,
      runtime: null,
      deviceOperation: {
        operationId: operation.id,
        deviceId: operation.deviceId,
        deviceDisplayName: displayName,
        platform: device?.platform ?? null,
        architecture: device?.architecture ?? null,
        action: operation.action,
        state: operation.state,
        actorType: operation.executedActor.actorType ?? operation.requestedActor.actorType,
        revision: operation.revision
      },
      job: null,
      directProcessSummary: { total: 0, active: 0, running: 0 },
      latestEvent,
      controls: { pause: false, resume: false, terminate: false, interrupt: false, hold: false },
      startedAt: operation.startedAt ?? operation.createdAt,
      updatedAt: operation.updatedAt,
      endedAt: operation.completedAt
    };
  }

  private projectSession(
    session: DevelopmentSessionRecord,
    linkedJob: JobRecord<TokenPilotJobPayload> | null
  ): OperationalActivityProjection {
    const binding = this.repositories.runtimeBindings.latestForSession(session.id);
    const run = this.repositories.runtimeRuns.getActiveBySession(session.id);
    const runtimeEvent = this.repositories.runtimeEvents.latestForSession(session.id);
    const controlEvent = linkedJob ? this.activityControlEvents?.latestForJob(linkedJob.id) ?? null : null;
    const directProcesses = this.repositories.directProcessSessions.list({ sessionId: session.id });
    const tracked = linkedJob ? getTrackedJobProcess(this.paths, linkedJob.id) : null;
    const provenance = linkedJob
      ? this.activityProvenance?.get(linkedJob.id) ?? this.activityProvenance?.get(session.id) ?? null
      : this.activityProvenance?.get(session.id) ?? null;
    const status = runtimeStatus(session, run, linkedJob, tracked?.state ?? null);
    const latestEvent = newestActivityEvent(
      runtimeEvent ? projectOperationalActivityEvent(runtimeEvent) : null,
      controlEvent ? projectOperationalActivityControlEvent(controlEvent, session.id) : null
    );
    return {
      id: session.id,
      kind: "agent-session",
      scope: "workspace",
      status,
      title: session.title,
      targetDeviceId: "local-device",
      projectId: session.projectId,
      workspaceId: session.workspaceId,
      taskId: session.taskId,
      repoId: linkedJob ? repoId(linkedJob) : null,
      agentSessionId: session.id,
      authorizationGrantId: provenance?.authorizationGrantId ?? null,
      actorType: provenance?.actorType ?? null,
      traceId: provenance?.traceId ?? null,
      workerInstanceId: provenance?.workerInstanceId ?? null,
      runtime: binding ? {
        bindingId: binding.id,
        runtimeKind: publicRuntimeKind(binding),
        bindingStatus: binding.status,
        externalSessionId: binding.externalSessionId,
        externalRunId: binding.externalRunId,
        externalThreadId: binding.externalThreadId,
        runId: run?.id ?? null,
        runRevision: run?.revision ?? null,
        turnId: run?.externalTurnId ?? null,
        runStatus: run?.status ?? null
      } : null,
      deviceOperation: null,
      job: linkedJob ? {
        id: linkedJob.id,
        type: linkedJob.type,
        status: linkedJob.status,
        processState: tracked?.state ?? null,
        processLabel: tracked?.label ?? null,
        processRevision: tracked?.revision ?? null
      } : null,
      directProcessSummary: {
        total: directProcesses.length,
        active: directProcesses.filter((item) => item.status === "starting" || item.status === "running").length,
        running: directProcesses.filter((item) => item.status === "running").length
      },
      latestEvent,
      controls: {
        pause: tracked?.state === "running",
        resume: tracked?.state === "paused",
        terminate: tracked?.state === "running" || tracked?.state === "paused",
        interrupt: binding?.runtimeKind === "codex-app-server" && Boolean(run?.externalTurnId) && Boolean(run && ["running", "waiting-approval"].includes(run.status)),
        hold: false
      },
      startedAt: session.startedAt,
      updatedAt: latestTimestamp([
        session.updatedAt,
        binding?.updatedAt,
        run?.updatedAt,
        linkedJob?.updatedAt,
        tracked?.updatedAt,
        runtimeEvent?.createdAt,
        controlEvent?.createdAt,
        ...directProcesses.map((item) => item.completedAt ?? item.startedAt)
      ]),
      endedAt: session.endedAt
    };
  }

  private projectJob(job: JobRecord<TokenPilotJobPayload>): OperationalActivityProjection {
    const tracked = getTrackedJobProcess(this.paths, job.id);
    const repository = repoId(job);
    const provenance = this.activityProvenance?.get(job.id) ?? null;
    const controlEvent = this.activityControlEvents?.latestForJob(job.id) ?? null;
    const status = statusFromJob(job, tracked?.state ?? null);
    const latestEvent = controlEvent ? projectOperationalActivityControlEvent(controlEvent, job.id) : null;
    return {
      id: job.id,
      kind: "job",
      scope: repository ? "repo" : "host",
      status,
      title: jobTitle(job),
      targetDeviceId: "local-device",
      projectId: null,
      workspaceId: null,
      taskId: null,
      repoId: repository,
      agentSessionId: null,
      authorizationGrantId: provenance?.authorizationGrantId ?? null,
      actorType: provenance?.actorType ?? null,
      traceId: provenance?.traceId ?? null,
      workerInstanceId: provenance?.workerInstanceId ?? null,
      runtime: null,
      deviceOperation: null,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        processState: tracked?.state ?? null,
        processLabel: tracked?.label ?? null,
        processRevision: tracked?.revision ?? null
      },
      directProcessSummary: { total: 0, active: 0, running: 0 },
      latestEvent,
      controls: {
        pause: tracked?.state === "running",
        resume: tracked?.state === "paused",
        terminate: tracked?.state === "running" || tracked?.state === "paused",
        interrupt: false,
        hold: false
      },
      startedAt: job.createdAt,
      updatedAt: latestTimestamp([job.updatedAt, tracked?.updatedAt, controlEvent?.createdAt]),
      endedAt: ["completed", "failed", "terminated"].includes(status) ? job.updatedAt : null
    };
  }
}
