import {
  ApiOutlined,
  CodeOutlined,
  LinkOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Button, Empty, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchProjectExecutionObservability } from "../../api";
import type { LocaleCode } from "../../i18n";
import { getProjectsCopy } from "../../i18n/projects";
import { getOperationalStatusLabel, getOperationalStatusTone } from "../../status-language";
import type {
  OperationalActivityProjection,
  ProjectExecutionConnectionProjection,
  ProjectExecutionObservabilityResponse,
  ProjectExecutionProcessProjection
} from "../../types";
import { UiText as Text } from "../UiText";

type StreamState = "connecting" | "live" | "reconnecting" | "offline";

const TERMINAL_ACTIVITY = new Set([
  "completed",
  "failed",
  "interrupted",
  "terminated",
  "stale"
]);

function compactId(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 22) return value;
  return `${value.slice(0, 11)}…${value.slice(-6)}`;
}

function streamTone(state: StreamState): "success" | "processing" | "default" {
  if (state === "live") return "success";
  if (state === "connecting" || state === "reconnecting") return "processing";
  return "default";
}

function actorLabel(locale: LocaleCode, actor: OperationalActivityProjection["actorType"]): string {
  const copy = getProjectsCopy(locale);
  if (actor === "remote-mcp") return copy.actorRemoteMcp;
  if (actor === "local-ui") return copy.actorLocalUi;
  if (actor === "local-cli") return copy.actorLocalCli;
  if (actor === "rest-api") return copy.actorRestApi;
  if (actor === "gpt-actions") return copy.actorGptActions;
  if (actor === "runner") return copy.actorRunner;
  return copy.actorUnknown;
}

function processLabel(locale: LocaleCode, process: ProjectExecutionProcessProjection): string {
  const copy = getProjectsCopy(locale);
  if (process.status === "starting") return copy.processStarting;
  if (process.status === "running") return copy.processRunning;
  if (process.status === "exited") return copy.processExited;
  if (process.status === "terminated") return copy.processTerminated;
  if (process.status === "failed") return copy.processFailed;
  return copy.processStale;
}

function connectionLabel(locale: LocaleCode, connection: ProjectExecutionConnectionProjection): string {
  const copy = getProjectsCopy(locale);
  if (connection.state === "active") return copy.connectionActive;
  if (connection.state === "idle") return copy.connectionIdle;
  return copy.connectionStale;
}

export function ProjectLiveExecutionPanel({
  locale,
  projectId
}: {
  locale: LocaleCode;
  projectId: string;
}) {
  const copy = getProjectsCopy(locale);
  const [snapshot, setSnapshot] = useState<ProjectExecutionObservabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("connecting");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await fetchProjectExecutionObservability(projectId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const source = new EventSource(
      `/api/projects/${encodeURIComponent(projectId)}/executions/stream`,
      { withCredentials: true }
    );
    const onSnapshot = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as ProjectExecutionObservabilityResponse;
        if (next?.ok !== true || next.projectId !== projectId) return;
        setSnapshot(next);
        setLoadError(false);
        setStreamState("live");
      } catch {
        setStreamState("reconnecting");
      }
    };
    source.addEventListener("project.execution.snapshot", onSnapshot as EventListener);
    source.onopen = () => setStreamState("live");
    source.onerror = () =>
      setStreamState(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    return () => {
      source.removeEventListener("project.execution.snapshot", onSnapshot as EventListener);
      source.close();
    };
  }, [load, projectId]);

  const activities = useMemo(
    () => (snapshot?.activities ?? []).slice(0, 8),
    [snapshot]
  );
  const activeProcesses = useMemo(
    () => (snapshot?.processes ?? []).filter((process) =>
      process.status === "starting" || process.status === "running"
    ).slice(0, 8),
    [snapshot]
  );
  const connections = useMemo(
    () => (snapshot?.connections ?? []).slice(0, 8),
    [snapshot]
  );
  const hasExecution = activities.length > 0 || activeProcesses.length > 0 || connections.length > 0;

  return (
    <section className="project-section project-live-execution panel" aria-labelledby="project-live-execution-title">
      <header className="project-section__heading project-live-execution__heading">
        <div>
          <div className="project-live-execution__title-row">
            <Text as="h2" id="project-live-execution-title">{copy.liveExecution}</Text>
            <Tag color={streamTone(streamState)} className="project-live-execution__live-tag">
              <span className="project-live-execution__live-dot" aria-hidden="true" />
              {streamState === "live"
                ? copy.live
                : streamState === "offline"
                  ? copy.offline
                  : copy.reconnecting}
            </Tag>
          </div>
          <Text as="p" type="secondary">{copy.liveExecutionDescription}</Text>
        </div>
        <Tooltip title={copy.refresh}>
          <Button
            aria-label={copy.refresh}
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
          />
        </Tooltip>
      </header>

      <div className="project-live-execution__metrics" role="list">
        <div role="listitem"><span>{copy.activeActivities}</span><strong>{snapshot?.counts.activeActivities ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.runningProcesses}</span><strong>{snapshot?.counts.runningProcesses ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.mcpConnections}</span><strong>{snapshot?.counts.activeConnections ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.waitingApproval}</span><strong>{snapshot?.counts.waitingApproval ?? "—"}</strong></div>
        <div role="listitem"><span>{copy.activeTasks}</span><strong>{snapshot?.counts.activeTasks ?? "—"}</strong></div>
      </div>

      {loadError && !snapshot ? (
        <div className="project-live-execution__error">
          <ThunderboltOutlined />
          <span>{copy.liveExecutionUnavailable}</span>
        </div>
      ) : !hasExecution ? (
        <div className="project-live-execution__empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <Text as="div" strong>{copy.noLiveExecution}</Text>
                <Text as="div" type="secondary">{copy.noLiveExecutionDescription}</Text>
              </div>
            }
          />
        </div>
      ) : (
        <div className="project-live-execution__columns">
          <div className="project-live-execution__column">
            <div className="project-live-execution__column-title"><ThunderboltOutlined /> {copy.liveActivities}</div>
            {activities.length === 0 ? <span className="project-live-execution__muted">—</span> : activities.map((activity) => (
              <article key={activity.id} className="project-live-execution__activity-card">
                <div className="project-live-execution__row-main">
                  <div>
                    <strong>{activity.taskTitle ?? activity.title}</strong>
                    <span>{actorLabel(locale, activity.actorType)} · {activity.repoId ?? compactId(activity.workspaceId)}</span>
                  </div>
                  <Tag color={getOperationalStatusTone(activity.status)}>
                    {getOperationalStatusLabel(locale, activity.status)}
                  </Tag>
                </div>
                <div className="project-live-execution__meta-row">
                  {activity.runtime?.externalThreadId ? <code>thread {compactId(activity.runtime.externalThreadId)}</code> : null}
                  {activity.runtime?.turnId ? <code>turn {compactId(activity.runtime.turnId)}</code> : null}
                  {activity.traceId ? <code>trace {compactId(activity.traceId)}</code> : null}
                  {activity.directProcessSummary.active > 0 ? <span>{copy.runningProcesses} {activity.directProcessSummary.active}</span> : null}
                  {activity.latestEvent ? <span>{activity.latestEvent.kind}</span> : null}
                </div>
              </article>
            ))}
          </div>

          <div className="project-live-execution__column">
            <div className="project-live-execution__column-title"><CodeOutlined /> {copy.liveProcesses}</div>
            {activeProcesses.length === 0 ? <span className="project-live-execution__muted">—</span> : activeProcesses.map((process) => (
              <article key={process.id} className="project-live-execution__process-card">
                <div className="project-live-execution__row-main">
                  <code className="project-live-execution__command">{process.command}</code>
                  <Tag color={process.status === "running" ? "processing" : "default"}>{processLabel(locale, process)}</Tag>
                </div>
                <div className="project-live-execution__meta-row">
                  <span>{copy.executor}: {process.executorId}</span>
                  {process.repoId ? <code>{process.repoId}</code> : null}
                  {process.sessionId ? <code>session {compactId(process.sessionId)}</code> : null}
                  <time dateTime={process.startedAt}>{new Date(process.startedAt).toLocaleTimeString(locale)}</time>
                </div>
              </article>
            ))}
          </div>

          <div className="project-live-execution__column">
            <div className="project-live-execution__column-title"><ApiOutlined /> {copy.liveConnections}</div>
            {connections.length === 0 ? <span className="project-live-execution__muted">—</span> : connections.map((connection) => (
              <article key={connection.id} className="project-live-execution__connection-card">
                <div className="project-live-execution__row-main">
                  <div>
                    <strong>{connection.surface}</strong>
                    <span>{connection.transportMode === "stateless-http" ? copy.transportStateless : copy.transportSession}</span>
                  </div>
                  <Tag color={connection.state === "active" ? "success" : connection.state === "idle" ? "default" : "warning"}>
                    {connectionLabel(locale, connection)}
                  </Tag>
                </div>
                <div className="project-live-execution__meta-row">
                  <LinkOutlined />
                  <span>{copy.lastTool}: {connection.lastToolName ?? connection.lastMethod ?? "—"}</span>
                  <span>{copy.requests}: {connection.totalRequests}</span>
                  {connection.activeRequests > 0 ? <Tag color="processing">+{connection.activeRequests}</Tag> : null}
                  <time dateTime={connection.lastSeenAt}>{new Date(connection.lastSeenAt).toLocaleTimeString(locale)}</time>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
