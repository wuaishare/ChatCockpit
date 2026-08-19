import {
  BranchesOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Button, Empty, Tag, Tooltip } from "antd";
import { Text } from "@lobehub/ui";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { fetchOperationalActivities } from "../../api";
import type { LocaleCode } from "../../i18n";
import type { ResourceCenterCopy } from "../../i18n/resources";
import { getOperationalStatusLabel, getOperationalStatusTone } from "../../status-language";
import type {
  ContinuityProjectProjection,
  OperationalActivityListResponse,
  OperationalActivityProjection,
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

function streamTone(state: StreamState): string {
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
  return activity.kind === "agent-session" ? copy.activityKindAgent : copy.activityKindJob;
}

function runtimeLabel(activity: OperationalActivityProjection): string | null {
  if (activity.runtime) return activity.runtime.runtimeKind;
  if (activity.job) return activity.job.type;
  return null;
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
  workspaceLabel
}: {
  activity: OperationalActivityProjection;
  locale: LocaleCode;
  copy: ResourceCenterCopy;
  projectName: string | null;
  workspaceLabel: string | null;
}) {
  const runtime = runtimeLabel(activity);
  const context =
    activity.scope === "workspace"
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
        <Tag color={getOperationalStatusTone(activity.status)}>
          {getOperationalStatusLabel(locale, activity.status)}
        </Tag>
      </div>

      <div className="resource-center__activity-facts">
        <div><span>{copy.activityRuntime}</span><strong>{runtime ?? "—"}</strong></div>
        <div><span>{copy.activityProcesses}</span><strong>{activity.directProcessSummary.active}/{activity.directProcessSummary.total}</strong></div>
        <ActivityIdentity label={copy.activityGrant} value={activity.authorizationGrantId} fallback={copy.activityUnknownAuthority} />
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
            <span><ClockCircleOutlined /> {copy.activityLastEvent}: <code>{activity.latestEvent.method}</code></span>
          ) : null}
          {activity.job?.processLabel ? <span>{copy.activityJob}: {activity.job.processLabel}</span> : null}
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
    source.addEventListener("activity.snapshot", onSnapshot as EventListener);
    source.onopen = () => setStreamState("live");
    source.onerror = () => setStreamState(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    return () => {
      source.removeEventListener("activity.snapshot", onSnapshot as EventListener);
      source.close();
    };
  }, [load]);

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
