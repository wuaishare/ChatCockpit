import {
  ApiOutlined,
  CodeOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Button, Descriptions, Empty, List, Popconfirm, Space, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchRuntimeExecutionObservability, terminateRuntimeManagedProcess } from "../api";
import type { LocaleCode } from "../i18n";
import { getProjectsCopy } from "../i18n/projects";
import { getRuntimeCopy } from "../i18n/runtime";
import { getOperationalStatusLabel, getOperationalStatusTone } from "../status-language";
import type {
  OperationalActivityProjection,
  RuntimeExecutionConnectionProjection,
  RuntimeExecutionObservabilityResponse,
  RuntimeExecutionProcessProjection
} from "../types";
import { SectionCard } from "./SectionCard";
import "./runtime-live-execution.css";

type StreamState = "connecting" | "live" | "reconnecting" | "offline";

const TERMINAL_ACTIVITY = new Set(["completed", "failed", "interrupted", "terminated", "stale"]);
const TERMINAL_TASK = new Set(["completed", "cancelled"]);
function compactId(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 22) return value;
  return `${value.slice(0, 11)}…${value.slice(-6)}`;
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

function processLabel(locale: LocaleCode, process: RuntimeExecutionProcessProjection): string {
  const copy = getProjectsCopy(locale);
  if (process.status === "starting") return copy.processStarting;
  if (process.status === "running") return copy.processRunning;
  if (process.status === "exited") return copy.processExited;
  if (process.status === "terminated") return copy.processTerminated;
  if (process.status === "failed") return copy.processFailed;
  return copy.processStale;
}

function connectionLabel(locale: LocaleCode, connection: RuntimeExecutionConnectionProjection): string {
  const copy = getProjectsCopy(locale);
  if (connection.state === "active") return copy.connectionActive;
  if (connection.state === "idle") return copy.connectionIdle;
  return copy.connectionStale;
}
export function RuntimeLiveExecutionPanel({
  locale,
  processTerminateAvailable
}: {
  locale: LocaleCode;
  processTerminateAvailable: boolean;
}) {
  const runtimeCopy = getRuntimeCopy(locale);
  const projectCopy = getProjectsCopy(locale);
  const [snapshot, setSnapshot] = useState<RuntimeExecutionObservabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [terminatingProcessId, setTerminatingProcessId] = useState<string | null>(null);
  const [processControlError, setProcessControlError] = useState<string | null>(null);
  const terminateKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await fetchRuntimeExecutionObservability());
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const terminateProcess = useCallback(async (process: RuntimeExecutionProcessProjection) => {
    if (!processTerminateAvailable || !process.controls.terminate) return;
    let idempotencyKey = terminateKeys.current.get(process.id);
    if (!idempotencyKey) {
      idempotencyKey = `runtime.process.terminate.web:${crypto.randomUUID()}`;
      terminateKeys.current.set(process.id, idempotencyKey);
    }
    setTerminatingProcessId(process.id);
    setProcessControlError(null);
    try {
      await terminateRuntimeManagedProcess({
        processId: process.id,
        expectedRevision: process.revision,
        idempotencyKey
      });
      terminateKeys.current.delete(process.id);
      void load();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : null;
      if (code) terminateKeys.current.delete(process.id);
      setProcessControlError(
        code
          ? `${runtimeCopy.processTerminateFailed} (${code})`
          : runtimeCopy.processTerminateFailed
      );
      setTerminatingProcessId((current) => current === process.id ? null : current);
    }
  }, [load, processTerminateAvailable, runtimeCopy.processTerminateFailed]);

  useEffect(() => {
    void load();
    const source = new EventSource("/api/runtime/executions/stream", { withCredentials: true });
    const onSnapshot = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as RuntimeExecutionObservabilityResponse;
        if (next?.ok !== true) return;
        setSnapshot(next);
        setLoadError(false);
        setStreamState("live");
      } catch {
        setStreamState("reconnecting");
      }
    };
    source.addEventListener("runtime.execution.snapshot", onSnapshot as EventListener);
    source.onopen = () => setStreamState("live");
    source.onerror = () =>
      setStreamState(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    return () => {
      source.removeEventListener("runtime.execution.snapshot", onSnapshot as EventListener);
      source.close();
    };
  }, [load]);

  const activities = useMemo(
    () => (snapshot?.activities ?? []).filter((activity) => !TERMINAL_ACTIVITY.has(activity.status)).slice(0, 12),
    [snapshot]
  );
  const tasks = useMemo(
    () => (snapshot?.tasks ?? []).filter((task) => !TERMINAL_TASK.has(task.status)).slice(0, 8),
    [snapshot]
  );
  const processes = useMemo(
    () => (snapshot?.processes ?? []).filter((process) => process.status === "starting" || process.status === "running").slice(0, 12),
    [snapshot]
  );
  useEffect(() => {
    if (
      terminatingProcessId &&
      !processes.some((process) => process.id === terminatingProcessId)
    ) {
      setTerminatingProcessId(null);
    }
  }, [processes, terminatingProcessId]);
  const connections = useMemo(() => (snapshot?.connections ?? []).slice(0, 12), [snapshot]);
  const hasExecution = activities.length > 0 || tasks.length > 0 || processes.length > 0 || connections.length > 0;

  const streamLabel = streamState === "live"
    ? projectCopy.live
    : streamState === "offline"
      ? projectCopy.offline
      : projectCopy.reconnecting;
  return (
    <SectionCard
      title={runtimeCopy.liveExecutionTitle}
      description={runtimeCopy.liveExecutionDescription}
      extra={
        <Space>
          <Tag color={streamState === "live" ? "success" : streamState === "offline" ? "default" : "processing"}>
            {streamLabel}
          </Tag>
          <Tooltip title={projectCopy.refresh}>
            <Button
              aria-label={projectCopy.refresh}
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void load()}
            />
          </Tooltip>
        </Space>
      }
    >
      <Descriptions size="small" column={{ xs: 2, sm: 3, lg: 5 }} className="runtime-live-execution__metrics">
        <Descriptions.Item label={projectCopy.activeActivities}>{snapshot?.counts.activeActivities ?? "—"}</Descriptions.Item>
        <Descriptions.Item label={projectCopy.runningProcesses}>{snapshot?.counts.runningProcesses ?? "—"}</Descriptions.Item>
        <Descriptions.Item label={projectCopy.mcpConnections}>{snapshot?.counts.activeConnections ?? "—"}</Descriptions.Item>
        <Descriptions.Item label={projectCopy.waitingApproval}>{snapshot?.counts.waitingApproval ?? "—"}</Descriptions.Item>
        <Descriptions.Item label={projectCopy.activeTasks}>{snapshot?.counts.activeTasks ?? "—"}</Descriptions.Item>
      </Descriptions>

      {processControlError ? (
        <div className="runtime-live-execution__notice">
          <StopOutlined /> {processControlError}
        </div>
      ) : null}

      {loadError && !snapshot ? (
        <div className="runtime-live-execution__notice">
          <ThunderboltOutlined /> {projectCopy.liveExecutionUnavailable}
        </div>
      ) : !hasExecution ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`${runtimeCopy.noLiveExecution} · ${runtimeCopy.noLiveExecutionDescription}`}
        />
      ) : null}
      {hasExecution ? (
        <div className="runtime-live-execution__grid">
          <section>
            <div className="runtime-live-execution__section-title">
              <ThunderboltOutlined /> {projectCopy.liveActivities}
            </div>
            <List
              size="small"
              dataSource={activities}
              locale={{ emptyText: "—" }}
              renderItem={(activity) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space wrap size={8}>
                        <strong>{activity.title}</strong>
                        <Tag color={getOperationalStatusTone(activity.status)}>
                          {getOperationalStatusLabel(locale, activity.status)}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space wrap size={8}>
                        <span>{activity.projectDisplayName ?? runtimeCopy.unknownProject}</span>
                        <span>{actorLabel(locale, activity.actorType)}</span>
                        {activity.repoId ? <code>{activity.repoId}</code> : null}
                        {activity.agentSessionId ? <code>session {compactId(activity.agentSessionId)}</code> : null}
                        {activity.runtime?.externalThreadId ? <code>thread {compactId(activity.runtime.externalThreadId)}</code> : null}
                        <code>{activity.targetDeviceId}</code>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
            {tasks.length > 0 ? (
              <div className="runtime-live-execution__task-strip">
                {tasks.map((task) => (
                  <span key={task.id}>
                    <Tag>{task.status}</Tag>
                    {task.projectDisplayName ?? runtimeCopy.unknownProject} · {task.title}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <div className="runtime-live-execution__section-title">
              <CodeOutlined /> {projectCopy.liveProcesses}
            </div>
            <List
              size="small"
              dataSource={processes}
              locale={{ emptyText: "—" }}
              renderItem={(process) => (
                <List.Item
                  actions={
                    process.controls.terminate
                      ? [
                          <Popconfirm
                            key="terminate"
                            title={runtimeCopy.processTerminateTitle}
                            description={runtimeCopy.processTerminateDescription}
                            okText={runtimeCopy.processTerminate}
                            cancelText={runtimeCopy.cancel}
                            okButtonProps={{ danger: true }}
                            disabled={!processTerminateAvailable || terminatingProcessId === process.id}
                            onConfirm={() => void terminateProcess(process)}
                          >
                            <Button
                              size="small"
                              danger
                              icon={<StopOutlined />}
                              loading={terminatingProcessId === process.id}
                              disabled={!processTerminateAvailable || terminatingProcessId === process.id}
                              title={
                                processTerminateAvailable
                                  ? runtimeCopy.processTerminate
                                  : runtimeCopy.processControlUnavailable
                              }
                            >
                              {runtimeCopy.processTerminate}
                            </Button>
                          </Popconfirm>
                        ]
                      : undefined
                  }
                >
                  <List.Item.Meta
                    title={
                      <Space wrap size={8}>
                        <code className="runtime-live-execution__command">{process.command}</code>
                        <Tag color={process.status === "running" ? "processing" : "default"}>
                          {processLabel(locale, process)}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space wrap size={8}>
                        <span>{process.projectDisplayName ?? runtimeCopy.unknownProject}</span>
                        <span>{projectCopy.executor}: {process.executorId}</span>
                        {process.repoId ? <code>{process.repoId}</code> : null}
                        {process.sessionId ? <code>session {compactId(process.sessionId)}</code> : null}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </section>
          <section>
            <div className="runtime-live-execution__section-title">
              <ApiOutlined /> {projectCopy.liveConnections}
            </div>
            <List
              size="small"
              dataSource={connections}
              locale={{ emptyText: "—" }}
              renderItem={(connection) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space wrap size={8}>
                        <strong>{connection.surface}</strong>
                        <Tag color={connection.state === "active" ? "success" : connection.state === "idle" ? "default" : "warning"}>
                          {connectionLabel(locale, connection)}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space wrap size={8}>
                        <span>{connection.transportMode === "stateless-http" ? projectCopy.transportStateless : projectCopy.transportSession}</span>
                        <span>{projectCopy.lastTool}: {connection.lastToolName ?? connection.lastMethod ?? "—"}</span>
                        <span>{projectCopy.requests}: {connection.totalRequests}</span>
                        {connection.transportSessionId ? <code>mcp {compactId(connection.transportSessionId)}</code> : null}
                        <time dateTime={connection.lastSeenAt}>{new Date(connection.lastSeenAt).toLocaleTimeString(locale)}</time>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </section>
        </div>
      ) : null}
    </SectionCard>
  );
}
