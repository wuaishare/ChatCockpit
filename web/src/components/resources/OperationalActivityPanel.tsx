import {
  BranchesOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  HistoryOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Button, Empty, Popconfirm, Tag, Tooltip } from "antd";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UiText as Text } from "../UiText";

import { controlJob, fetchOperationalActivities, fetchOperationalActivityTimeline, interruptCodexRuntimeTurn } from "../../api";
import type { LocaleCode } from "../../i18n";
import type { ResourceCenterCopy } from "../../i18n/resources";
import { getOperationalStatusLabel, getOperationalStatusTone, type OperationalStatusTone } from "../../status-language";
import type {
  ContinuityProjectProjection,
  OperationalActivityEventProjection,
  OperationalActivityEventResponse,
  OperationalActivityListResponse,
  OperationalActivityProjection,
  OperationalActivityTimelineResponse,
  OperationalActivityStatus
} from "../../types";

interface OperationalActivityPanelProps {
  locale: LocaleCode;
  token: string | null;
  copy: ResourceCenterCopy;
  projects: ContinuityProjectProjection[];
}

type StreamState = "connecting" | "live" | "reconnecting" | "offline";

const TERMINAL = new Set<OperationalActivityStatus>([
  "completed",
  "failed",
  "interrupted",
  "terminated",
  "stale"
]);

const ACTIVE_ORDER: Record<string, number> = {
  "waiting-approval": 0,
  running: 1,
  paused: 2,
  queued: 3,
  "handoff-ready": 4,
  idle: 5
};

function compactId(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 22) return value;
  return `${value.slice(0, 11)}…${value.slice(-6)}`;
}

function streamLabel(copy: ResourceCenterCopy, state: StreamState): string {
  if (state === "live") return copy.activityLive;
  if (state === "connecting") return copy.activityConnecting;
  if (state === "reconnecting") return copy.activityReconnecting;
  return copy.activityOffline;
}

function streamTone(state: StreamState): OperationalStatusTone {
  if (state === "live") return "success";
  if (state === "connecting" || state === "reconnecting") return "processing";
  return "default";
}

function scopeLabel(copy: ResourceCenterCopy, activity: OperationalActivityProjection): string {
  if (activity.scope === "workspace") return copy.activityScopeWorkspace;
  if (activity.scope === "repo") return copy.activityScopeRepo;
  return copy.activityScopeHost;
}

function kindLabel(copy: ResourceCenterCopy, activity: OperationalActivityProjection): string {
  if (activity.kind === "agent-session") return copy.activityKindAgent;
  if (activity.kind === "device-operation") return copy.activityKindDeviceOperation;
  return copy.activityKindJob;
}

function runtimeLabel(activity: OperationalActivityProjection): string | null {
  if (activity.runtime) return activity.runtime.runtimeKind;
  if (activity.job) return activity.job.type;
  if (activity.deviceOperation) return `${activity.deviceOperation.action} · ${activity.deviceOperation.state}`;
  return null;
}

function activityEventLabel(copy: ResourceCenterCopy, event: OperationalActivityEventProjection): string {
  switch (event.kind) {
    case "run-started": return copy.activityEventRunStarted;
    case "run-completed": return copy.activityEventRunCompleted;
    case "run-failed": return copy.activityEventRunFailed;
    case "run-interrupted": return copy.activityEventRunInterrupted;
    case "job-paused": return copy.activityEventJobPaused;
    case "job-resumed": return copy.activityEventJobResumed;
    case "job-terminated": return copy.activityEventJobTerminated;
    case "step-started": return copy.activityEventStepStarted;
    case "step-completed": return copy.activityEventStepCompleted;
    case "approval-required": return copy.activityEventApprovalRequired;
    case "approval-resolved": return copy.activityEventApprovalResolved;
    case "approval-rejected": return copy.activityEventApprovalRejected;
    case "warning": return copy.activityEventWarning;
    case "error": return copy.activityEventError;
    case "device-operation-updated": return copy.activityEventDeviceOperation;
    default: return copy.activityEventActivity;
  }
}

function activityEventDetail(event: OperationalActivityEventProjection): string | null {
  if (event.source === "job-control") return null;
  if (event.source === "device-operation") {
    return [event.deviceAction, event.deviceOperationState].filter(Boolean).join(" · ") || event.code;
  }
  return event.approvalKind ?? event.itemType ?? event.code;
}

function currentStepLabel(copy: ResourceCenterCopy, activity: OperationalActivityProjection): string {
  if (activity.latestEvent) return activityEventLabel(copy, activity.latestEvent);
  if (activity.job?.processLabel) return activity.job.processLabel;
  return copy.activityEventActivity;
}

function ActivityIdentity({
  label,
  value,
  fallback
}: {
  label: string;
  value: string | null;
  fallback: string;
}) {
  const visible = value ? compactId(value) : fallback;
  return (
    <div className="resource-center__activity-identity">
      <span>{label}</span>
      {value ? (
        <Tooltip title={value} mouseEnterDelay={0.35}>
          <code>{visible}</code>
        </Tooltip>
      ) : (
        <strong>{visible}</strong>
      )}
    </div>
  );
}

const ActivityCard = memo(function ActivityCard({
  activity,
  locale,
  copy,
  projectName,
  workspaceLabel,
  interrupting,
  controllingAction,
  timeline,
  timelineExpanded,
  timelineLoading,
  timelineError,
  onInterrupt,
  onJobControl,
  onToggleTimeline
}: {
  activity: OperationalActivityProjection;
  locale: LocaleCode;
  copy: ResourceCenterCopy;
  projectName: string | null;
  workspaceLabel: string | null;
  interrupting: boolean;
  controllingAction: "pause" | "resume" | "terminate" | null;
  timeline: OperationalActivityEventProjection[];
  timelineExpanded: boolean;
  timelineLoading: boolean;
  timelineError: boolean;
  onInterrupt: (activity: OperationalActivityProjection) => void;
  onJobControl: (activity: OperationalActivityProjection, action: "pause" | "resume" | "terminate") => void;
  onToggleTimeline: (activity: OperationalActivityProjection) => void;
}) {
  const runtime = runtimeLabel(activity);
  const context = activity.deviceOperation
    ? activity.deviceOperation.deviceDisplayName
    : activity.scope === "workspace"
      ? [projectName, workspaceLabel].filter(Boolean).join(" · ")
      : activity.repoId ?? copy.activityScopeHost;
  return (
    <article className={`resource-center__activity-card resource-center__activity-card--${activity.status}`}>
      <div className="resource-center__activity-card-head">
        <div className="resource-center__activity-title-wrap">
          <div className="resource-center__activity-icon" aria-hidden="true">
            {activity.scope === "host" ? <DesktopOutlined /> : activity.scope === "repo" ? <BranchesOutlined /> : <CloudServerOutlined />}
          </div>
          <div className="resource-center__activity-title-copy">
            <Text as="div" strong className="resource-center__activity-name">{activity.title}</Text>
            <div className="resource-center__activity-context">
              <span>{kindLabel(copy, activity)}</span>
              <span aria-hidden="true">·</span>
              <span>{scopeLabel(copy, activity)}</span>
              {context ? <><span aria-hidden="true">·</span><span>{context}</span></> : null}
            </div>
          </div>
        </div>
        <div className="resource-center__activity-card-actions">
          {activity.controls.pause && activity.job?.processRevision ? (
            <Button
              size="small"
              loading={controllingAction === "pause"}
              disabled={Boolean(controllingAction)}
              onClick={() => onJobControl(activity, "pause")}
            >
              {copy.activityPause}
            </Button>
          ) : null}
          {activity.controls.resume && activity.job?.processRevision ? (
            <Button
              size="small"
              loading={controllingAction === "resume"}
              disabled={Boolean(controllingAction)}
              onClick={() => onJobControl(activity, "resume")}
            >
              {copy.activityResume}
            </Button>
          ) : null}
          {activity.controls.terminate && activity.job?.processRevision ? (
            <Popconfirm
              title={copy.activityTerminateConfirmTitle}
              description={copy.activityTerminateConfirmDescription}
              okText={copy.activityTerminateConfirm}
              cancelText={copy.activityTerminateCancel}
              okButtonProps={{ danger: true }}
              onConfirm={() => onJobControl(activity, "terminate")}
            >
              <Button
                size="small"
                danger
                loading={controllingAction === "terminate"}
                disabled={Boolean(controllingAction)}
              >
                {copy.activityTerminate}
              </Button>
            </Popconfirm>
          ) : null}
          {activity.controls.interrupt && activity.runtime?.runId && activity.runtime.runRevision ? (
            <Popconfirm
              title={copy.activityInterruptConfirmTitle}
              description={copy.activityInterruptConfirmDescription}
              okText={copy.activityInterruptConfirm}
              cancelText={copy.activityInterruptCancel}
              okButtonProps={{ danger: true }}
              onConfirm={() => onInterrupt(activity)}
            >
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                loading={interrupting}
                disabled={interrupting}
              >
                {copy.activityInterrupt}
              </Button>
            </Popconfirm>
          ) : null}
          <Button
            size="small"
            type="text"
            icon={<HistoryOutlined />}
            loading={timelineLoading}
            onClick={() => onToggleTimeline(activity)}
          >
            {timelineExpanded ? copy.activityTimelineHide : copy.activityTimelineShow}
          </Button>
          <Tag color={getOperationalStatusTone(activity.status)}>
            {getOperationalStatusLabel(locale, activity.status)}
          </Tag>
        </div>
      </div>

      <div className="resource-center__activity-current-step">
        <span>{copy.activityLastEvent}</span>
        <strong>{currentStepLabel(copy, activity)}</strong>
      </div>

      <div className="resource-center__activity-facts">
        <div><span>{copy.activityRuntime}</span><strong>{runtime ?? "—"}</strong></div>
        <div><span>{copy.activityProcesses}</span><strong>{activity.directProcessSummary.active}/{activity.directProcessSummary.total}</strong></div>
        <ActivityIdentity label={copy.activityGrant} value={activity.authorizationGrantId} fallback={copy.activityUnknownAuthority} />
        {activity.deviceOperation ? (
          <div><span>{copy.activityActor}</span><strong>{activity.deviceOperation.actorType ?? "—"}</strong></div>
        ) : null}
        <ActivityIdentity label={copy.activityTrace} value={activity.traceId} fallback="—" />
        <ActivityIdentity label={copy.activityWorker} value={activity.workerInstanceId} fallback="—" />
        <div>
          <span>{copy.activityUpdated}</span>
          <strong>{new Date(activity.updatedAt).toLocaleString(locale)}</strong>
        </div>
      </div>

      {activity.latestEvent || activity.job?.processLabel ? (
        <div className="resource-center__activity-foot">
          {activity.latestEvent ? (
            <span>
              <ClockCircleOutlined /> {copy.activityLastEvent}: {activityEventLabel(copy, activity.latestEvent)}
              {activityEventDetail(activity.latestEvent) ? <code>{activityEventDetail(activity.latestEvent)}</code> : null}
            </span>
          ) : null}
          {activity.job?.processLabel ? <span>{copy.activityJob}: {activity.job.processLabel}</span> : null}
        </div>
      ) : null}

      {timelineExpanded ? (
        <div className="resource-center__activity-timeline">
          <div className="resource-center__activity-timeline-head">
            <Text as="span" strong>{copy.activityTimelineTitle}</Text>
            <code>{compactId(activity.id)}</code>
          </div>
          {timelineError ? (
            <div className="resource-center__activity-timeline-empty">{copy.activityTimelineLoadFailed}</div>
          ) : timeline.length === 0 && !timelineLoading ? (
            <div className="resource-center__activity-timeline-empty">{copy.activityTimelineEmpty}</div>
          ) : (
            <div className="resource-center__activity-timeline-list" role="log" aria-live="polite">
              {timeline.map((event) => (
                <div key={`${event.source}:${event.id}`} className="resource-center__activity-timeline-item">
                  <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString(locale)}</time>
                  <span className="resource-center__activity-timeline-dot" aria-hidden="true" />
                  <span className="resource-center__activity-timeline-event">
                    {activityEventLabel(copy, event)}
                    {activityEventDetail(event) ? <code>{activityEventDetail(event)}</code> : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
});

export function OperationalActivityPanel({
  locale,
  token,
  copy,
  projects
}: OperationalActivityPanelProps) {
  const [snapshot, setSnapshot] = useState<OperationalActivityListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [interruptingActivityId, setInterruptingActivityId] = useState<string | null>(null);
  const [interruptError, setInterruptError] = useState<string | null>(null);
  const [controllingJob, setControllingJob] = useState<{ activityId: string; action: "pause" | "resume" | "terminate" } | null>(null);
  const [jobControlError, setJobControlError] = useState<string | null>(null);
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | null>(null);
  const [timelineByActivity, setTimelineByActivity] = useState<Record<string, OperationalActivityEventProjection[]>>({});
  const [timelineLoadingId, setTimelineLoadingId] = useState<string | null>(null);
  const [timelineErrorId, setTimelineErrorId] = useState<string | null>(null);
  const interruptKeys = useRef(new Map<string, string>());
  const jobControlKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await fetchOperationalActivities(token));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const source = new EventSource("/api/activities/stream", { withCredentials: true });
    setStreamState("connecting");
    const onSnapshot = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as OperationalActivityListResponse;
        if (next?.ok === true && Array.isArray(next.activities)) {
          setSnapshot(next);
          setLoadError(false);
          setStreamState("live");
        }
      } catch {
        setStreamState("reconnecting");
      }
    };
    const onActivityEvent = (message: MessageEvent<string>) => {
      try {
        const next = JSON.parse(message.data) as OperationalActivityEventResponse;
        if (next?.ok !== true || !next.event) return;
        setSnapshot((current) => {
          if (!current) return current;
          let changed = false;
          const activities = current.activities.map((activity) => {
            if (activity.id !== next.event.activityId) return activity;
            if ((activity.latestEvent?.sequence ?? 0) >= next.event.sequence) return activity;
            changed = true;
            return {
              ...activity,
              latestEvent: next.event,
              updatedAt: activity.updatedAt > next.event.createdAt ? activity.updatedAt : next.event.createdAt
            };
          });
          return changed ? { ...current, activities } : current;
        });
        setTimelineByActivity((current) => {
          const existing = current[next.event.activityId];
          if (!existing) return current;
          if (existing.some((event) => event.source === next.event.source && event.id === next.event.id)) return current;
          return {
            ...current,
            [next.event.activityId]: [...existing, next.event]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.source.localeCompare(b.source) || a.sequence - b.sequence)
              .slice(-50)
          };
        });
        setStreamState("live");
      } catch {
        setStreamState("reconnecting");
      }
    };
    source.addEventListener("activity.snapshot", onSnapshot as EventListener);
    source.addEventListener("activity.event", onActivityEvent as EventListener);
    source.onopen = () => setStreamState("live");
    source.onerror = () => setStreamState(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    return () => {
      source.removeEventListener("activity.snapshot", onSnapshot as EventListener);
      source.removeEventListener("activity.event", onActivityEvent as EventListener);
      source.close();
    };
  }, [load]);

  const interruptActivity = useCallback(async (activity: OperationalActivityProjection) => {
    const runtime = activity.runtime;
    if (!activity.controls.interrupt || !runtime?.runId || !runtime.runRevision) return;

    let idempotencyKey = interruptKeys.current.get(runtime.runId);
    if (!idempotencyKey) {
      idempotencyKey = `activity.interrupt.web:${crypto.randomUUID()}`;
      interruptKeys.current.set(runtime.runId, idempotencyKey);
    }

    setInterruptingActivityId(activity.id);
    setInterruptError(null);
    try {
      await interruptCodexRuntimeTurn(
        {
          runId: runtime.runId,
          expectedRunRevision: runtime.runRevision,
          idempotencyKey
        },
        token
      );
      interruptKeys.current.delete(runtime.runId);
      void load();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : null;
      if (code) interruptKeys.current.delete(runtime.runId);
      setInterruptError(code ? `${copy.activityInterruptFailed} (${code})` : copy.activityInterruptFailed);
    } finally {
      setInterruptingActivityId((current) => current === activity.id ? null : current);
    }
  }, [copy.activityInterruptFailed, load, token]);

  const controlActivityJob = useCallback(async (
    activity: OperationalActivityProjection,
    action: "pause" | "resume" | "terminate"
  ) => {
    const job = activity.job;
    if (!job?.processRevision || !activity.controls[action]) return;
    const fingerprint = `${job.id}:${action}:${job.processRevision}`;
    let idempotencyKey = jobControlKeys.current.get(fingerprint);
    if (!idempotencyKey) {
      idempotencyKey = `activity.job-control.web:${crypto.randomUUID()}`;
      jobControlKeys.current.set(fingerprint, idempotencyKey);
    }
    setControllingJob({ activityId: activity.id, action });
    setJobControlError(null);
    try {
      await controlJob(job.id, {
        action,
        expectedRevision: job.processRevision,
        idempotencyKey
      }, token);
      jobControlKeys.current.delete(fingerprint);
      void load();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : null;
      if (code) jobControlKeys.current.delete(fingerprint);
      setJobControlError(code ? `${copy.activityJobControlFailed} (${code})` : copy.activityJobControlFailed);
    } finally {
      setControllingJob((current) => current?.activityId === activity.id && current.action === action ? null : current);
    }
  }, [copy.activityJobControlFailed, load, token]);

  const toggleTimeline = useCallback(async (activity: OperationalActivityProjection) => {
    if (expandedTimelineId === activity.id) {
      setExpandedTimelineId(null);
      return;
    }
    setExpandedTimelineId(activity.id);
    if (timelineByActivity[activity.id]) return;
    setTimelineLoadingId(activity.id);
    setTimelineErrorId(null);
    try {
      const response: OperationalActivityTimelineResponse = await fetchOperationalActivityTimeline(activity.id, token);
      setTimelineByActivity((current) => ({ ...current, [activity.id]: response.events }));
    } catch {
      setTimelineErrorId(activity.id);
    } finally {
      setTimelineLoadingId((current) => current === activity.id ? null : current);
    }
  }, [expandedTimelineId, timelineByActivity, token]);

  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of projects) map.set(entry.project.id, entry.project.displayName);
    return map;
  }, [projects]);
  const workspaceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of projects) {
      for (const workspace of entry.workspaces) {
        map.set(workspace.id, workspace.branch ?? workspace.repoId);
      }
    }
    return map;
  }, [projects]);

  const activeActivities = useMemo(
    () =>
      (snapshot?.activities ?? [])
        .filter((activity) => !TERMINAL.has(activity.status))
        .sort((a, b) =>
          (ACTIVE_ORDER[a.status] ?? 9) - (ACTIVE_ORDER[b.status] ?? 9) ||
          b.updatedAt.localeCompare(a.updatedAt)
        ),
    [snapshot]
  );
  const recentActivities = useMemo(
    () => (snapshot?.activities ?? []).filter((activity) => TERMINAL.has(activity.status)).slice(0, 6),
    [snapshot]
  );

  return (
    <section className="resource-center__activities panel" aria-labelledby="operational-activity-title">
      <div className="resource-center__section-header resource-center__activity-header">
        <div>
          <div className="resource-center__activity-heading-row">
            <Text as="h2" id="operational-activity-title" className="resource-center__section-title">
              {copy.activityTitle}
            </Text>
            <Tag color={streamTone(streamState)} className="resource-center__activity-live-tag">
              <span className="resource-center__activity-live-dot" aria-hidden="true" />
              {streamLabel(copy, streamState)}
            </Tag>
          </div>
          <Text as="p" type="secondary" className="resource-center__section-description">
            {copy.activityDescription}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          {copy.activityRefresh}
        </Button>
      </div>

      <div className="resource-center__activity-metrics" role="list" aria-label={copy.activityTitle}>
        <div role="listitem"><span>{copy.activityActive}</span><strong>{snapshot?.counts.active ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.activityRunning}</span><strong>{snapshot?.counts.running ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.activityWaitingApproval}</span><strong>{snapshot?.counts.waitingApproval ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.activityPaused}</span><strong>{snapshot?.counts.paused ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.activityTotal}</span><strong>{snapshot?.counts.total ?? "—"}</strong></div>
      </div>

      {interruptError ? (
        <div className="resource-center__activity-inline-error">
          <ThunderboltOutlined />
          <span>{interruptError}</span>
        </div>
      ) : null}

      {loadError && !snapshot ? (
        <div className="resource-center__activity-inline-error">
          <ThunderboltOutlined />
          <span>{copy.activityLoadFailed}</span>
        </div>
      ) : activeActivities.length === 0 ? (
        <div className="resource-center__activity-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <Text as="div" strong>{copy.activityNoActiveTitle}</Text>
                <Text as="div" type="secondary">{copy.activityNoActiveDescription}</Text>
              </div>
            }
          />
        </div>
      ) : (
        <div className="resource-center__activity-grid">
          {activeActivities.map((activity) => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              locale={locale}
              copy={copy}
              projectName={activity.projectId ? projectNames.get(activity.projectId) ?? null : null}
              workspaceLabel={activity.workspaceId ? workspaceNames.get(activity.workspaceId) ?? null : null}
              interrupting={interruptingActivityId === activity.id}
              controllingAction={controllingJob?.activityId === activity.id ? controllingJob.action : null}
              timeline={timelineByActivity[activity.id] ?? []}
              timelineExpanded={expandedTimelineId === activity.id}
              timelineLoading={timelineLoadingId === activity.id}
              timelineError={timelineErrorId === activity.id}
              onInterrupt={interruptActivity}
              onJobControl={controlActivityJob}
              onToggleTimeline={toggleTimeline}
            />
          ))}
        </div>
      )}

      {recentActivities.length > 0 ? (
        <div className="resource-center__activity-recent">
          <div className="resource-center__activity-recent-heading">
            <div>
              <Text as="div" strong>{copy.activityRecentTitle}</Text>
              <Text as="div" type="secondary">{copy.activityRecentDescription}</Text>
            </div>
          </div>
          <div className="resource-center__activity-recent-list">
            {recentActivities.map((activity) => (
              <div key={activity.id} className="resource-center__activity-recent-item">
                <div className="resource-center__activity-recent-main">
                  <Text as="span" strong>{activity.title}</Text>
                  <span>{kindLabel(copy, activity)} · {scopeLabel(copy, activity)}</span>
                </div>
                <div className="resource-center__activity-recent-meta">
                  <Tag color={getOperationalStatusTone(activity.status)}>{getOperationalStatusLabel(locale, activity.status)}</Tag>
                  <time dateTime={activity.updatedAt}>{new Date(activity.updatedAt).toLocaleString(locale)}</time>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
