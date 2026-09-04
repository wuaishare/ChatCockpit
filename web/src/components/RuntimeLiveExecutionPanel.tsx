import {
  ApiOutlined,
  CodeOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Button, Descriptions, Empty, List, Popconfirm, Space, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchRuntimeExecutionObservability,
  inputRuntimeManagedProcess,
  resizeRuntimeManagedProcess,
  terminateRuntimeManagedProcess
} from "../api";
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
import { PersistentSessionTerminalCard } from "./PersistentSessionTerminalCard";
import { SectionCard } from "./SectionCard";
import "./runtime-live-execution.css";

type StreamState = "connecting" | "live" | "reconnecting" | "offline";

type ProcessOutputChunk = {
  sequence: number;
  stream: "stdout" | "stderr";
  content: string;
  capReached: boolean;
};

type ProcessOutputEvent = {
  ok: true;
  deviceId: string;
  consoleSessionId: string;
  command: string;
  processId: string;
  sessionId: string | null;
  state: "running" | "completed" | "terminated" | "failed";
  exitCode: number | null;
  errorCode: string | null;
  chunks: ProcessOutputChunk[];
  nextCursor: number;
  retained: true;
};

type ProcessControlAction = "input" | "resize";
type ProcessControlBusyMap = Record<string, boolean>;

function processControlBusyKey(processId: string, action: ProcessControlAction): string {
  return `${processId}:${action}`;
}

type SessionConsoleGroup = {
  id: string;
  deviceId: string;
  sessionId: string | null;
  projectDisplayName: string | null;
  repoId: string | null;
  processes: RuntimeExecutionProcessProjection[];
  lastStartedAt: string;
  active: boolean;
};

const TERMINAL_ACTIVITY = new Set(["completed", "failed", "interrupted", "terminated", "stale"]);
const TERMINAL_TASK = new Set(["completed", "cancelled"]);

function processKeepsSessionConsoleLive(process: RuntimeExecutionProcessProjection): boolean {
  if (process.sessionId && process.sessionStatus) {
    return process.sessionStatus !== "completed" && process.sessionStatus !== "failed";
  }
  return process.status === "starting" || process.status === "running";
}

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

function ManagedProcessConsoleCard({
  locale,
  group,
  outputByProcess,
  processTerminateAvailable,
  terminatingProcessId,
  processControlBusy,
  onInput,
  onResize,
  onTerminate
}: {
  locale: LocaleCode;
  group: SessionConsoleGroup;
  outputByProcess: Record<string, ProcessOutputChunk[]>;
  processTerminateAvailable: boolean;
  terminatingProcessId: string | null;
  processControlBusy: ProcessControlBusyMap;
  onInput: (
    process: RuntimeExecutionProcessProjection,
    input: string,
    closeStdin: boolean
  ) => Promise<boolean>;
  onResize: (
    process: RuntimeExecutionProcessProjection,
    rows: number,
    cols: number
  ) => Promise<void>;
  onTerminate: (process: RuntimeExecutionProcessProjection) => void;
}) {
  const runtimeCopy = getRuntimeCopy(locale);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const autoResizeSignatureRef = useRef<string | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const outputRevision = group.processes.reduce(
    (total, process) => total + (outputByProcess[process.id]?.length ?? 0),
    0
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom < 96 || outputRevision <= 1) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [outputRevision]);

  const autoResizeTarget = [...group.processes]
    .reverse()
    .find((process) =>
      (process.status === "starting" || process.status === "running") && process.controls.resize
    );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !autoResizeTarget || typeof ResizeObserver === "undefined") return;
    let timer: number | null = null;
    const syncSize = (width: number, height: number) => {
      const cols = Math.max(40, Math.min(240, Math.floor((width - 24) / 7.4)));
      const rows = Math.max(12, Math.min(80, Math.floor((height - 20) / 18)));
      const signature = `${autoResizeTarget.id}:${rows}x${cols}`;
      if (autoResizeSignatureRef.current === signature) return;
      autoResizeSignatureRef.current = signature;
      void onResize(autoResizeTarget, rows, cols);
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        syncSize(entry.contentRect.width, entry.contentRect.height);
      }, 120);
    });
    observer.observe(viewport);
    const rect = viewport.getBoundingClientRect();
    syncSize(rect.width, rect.height);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [autoResizeTarget?.id, onResize]);

  return (
    <article className={`runtime-session-terminal${group.active ? " is-live" : ""}`}>
      <header className="runtime-session-terminal__header">
        <div className="runtime-session-terminal__identity">
          <span className={`runtime-session-terminal__pulse${group.active ? " is-live" : ""}`} aria-hidden="true" />
          <div>
            <div className="runtime-session-terminal__title">
              {group.projectDisplayName ?? runtimeCopy.unknownProject}
            </div>
            <div className="runtime-session-terminal__meta">
              <span>{runtimeCopy.sessionConsoleDevice}: <code>{group.deviceId === "local-device" ? runtimeCopy.local : compactId(group.deviceId)}</code></span>
              <span>{runtimeCopy.sessionConsoleSession}: <code>{group.sessionId ? compactId(group.sessionId) : runtimeCopy.sessionConsoleAdHoc}</code></span>
              {group.repoId ? <span><code>{group.repoId}</code></span> : null}
            </div>
          </div>
        </div>
        <Tag color={group.active ? "processing" : "default"}>
          {group.active ? runtimeCopy.sessionConsoleLive : runtimeCopy.sessionConsoleRecent}
        </Tag>
      </header>

      <div ref={viewportRef} className="runtime-session-terminal__viewport">
        {group.processes.map((process) => {
          const chunks = outputByProcess[process.id] ?? [];
          const active = process.status === "starting" || process.status === "running";
          const canInput = active && process.controls.input;
          const canTerminate = active && process.controls.terminate;
          const inputBusy = processControlBusy[processControlBusyKey(process.id, "input")] === true;
          const draft = inputDrafts[process.id] ?? "";
          const terminalSize = process.terminal.rows && process.terminal.cols
            ? `${process.terminal.cols}×${process.terminal.rows}`
            : null;
          return (
            <section key={process.id} className="runtime-session-terminal__process">
              <div className="runtime-session-terminal__command-row">
                <span className="runtime-session-terminal__prompt" aria-hidden="true">$</span>
                <code className="runtime-session-terminal__command">{process.command}</code>
                <Tag color={process.status === "running" ? "processing" : "default"}>
                  {processLabel(locale, process)}
                </Tag>
                <Tag color={process.terminal.tty ? "blue" : "default"}>
                  {process.terminal.tty ? runtimeCopy.processPty : runtimeCopy.processStream}
                  {terminalSize ? ` ${terminalSize}` : ""}
                </Tag>
                <span className="runtime-session-terminal__executor">
                  {runtimeCopy.sessionConsoleExecutor}: {process.executorId}
                </span>
                {canTerminate ? (
                  <Popconfirm
                    title={runtimeCopy.processTerminateTitle}
                    description={runtimeCopy.processTerminateDescription}
                    okText={runtimeCopy.processTerminate}
                    cancelText={runtimeCopy.cancel}
                    okButtonProps={{ danger: true }}
                    disabled={!processTerminateAvailable || terminatingProcessId === process.id}
                    onConfirm={() => onTerminate(process)}
                  >
                    <Button
                      size="small"
                      danger
                      type="text"
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
                ) : null}
              </div>
              <div className="runtime-session-terminal__output">
                {chunks.length > 0 ? chunks.map((chunk) => (
                  <span
                    key={`${process.id}:${chunk.sequence}`}
                    className={`runtime-session-terminal__chunk is-${chunk.stream}`}
                  >
                    {chunk.content}
                  </span>
                )) : (
                  <span className="runtime-session-terminal__empty">
                    {active
                      ? runtimeCopy.sessionConsoleWaitingOutput
                      : runtimeCopy.sessionConsoleOutputUnavailable}
                  </span>
                )}
              </div>
              {canInput ? (
                <div className="runtime-session-terminal__controls">
                  {canInput ? (
                    <form
                      className="runtime-session-terminal__input-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = draft;
                        if (!value || inputBusy) return;
                        void onInput(process, `${value}\n`, false).then((accepted) => {
                          if (!accepted) return;
                          setInputDrafts((current) => ({ ...current, [process.id]: "" }));
                        });
                      }}
                    >
                      <span className="runtime-session-terminal__input-prompt" aria-hidden="true">›</span>
                      <input
                        aria-label={runtimeCopy.processInputPlaceholder}
                        value={draft}
                        disabled={inputBusy}
                        placeholder={runtimeCopy.processInputPlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => {
                          const value = event.target.value;
                          setInputDrafts((current) => ({ ...current, [process.id]: value }));
                        }}
                      />
                      <button type="submit" disabled={!draft || inputBusy}>
                        {runtimeCopy.processInputSend}
                      </button>
                    </form>
                  ) : null}
                  <div className="runtime-session-terminal__control-actions">
                    {canInput ? (
                      <Popconfirm
                        title={runtimeCopy.processInputCloseTitle}
                        description={runtimeCopy.processInputCloseDescription}
                        okText={runtimeCopy.processInputClose}
                        cancelText={runtimeCopy.cancel}
                        onConfirm={() => void onInput(process, "", true)}
                      >
                        <button type="button" disabled={inputBusy}>
                          {runtimeCopy.processInputClose}
                        </button>
                      </Popconfirm>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </article>
  );
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
  const [processControlBusy, setProcessControlBusy] = useState<ProcessControlBusyMap>({});
  const [processControlError, setProcessControlError] = useState<string | null>(null);
  const [processOutputs, setProcessOutputs] = useState<Record<string, ProcessOutputChunk[]>>({});
  const seenOutputSequences = useRef(new Map<string, Set<number>>());
  const terminateKeys = useRef(new Map<string, string>());
  const inputKeys = useRef(new Map<string, { signature: string; key: string }>());
  const resizeKeys = useRef(new Map<string, { signature: string; key: string }>());

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

  const sendProcessInput = useCallback(async (
    process: RuntimeExecutionProcessProjection,
    value: string,
    closeStdin: boolean
  ): Promise<boolean> => {
    if (!process.controls.input) return false;
    const signature = JSON.stringify([value, closeStdin]);
    let pending = inputKeys.current.get(process.id);
    if (!pending || pending.signature !== signature) {
      pending = {
        signature,
        key: `runtime.process.input.web:${crypto.randomUUID()}`
      };
      inputKeys.current.set(process.id, pending);
    }
    const busyKey = processControlBusyKey(process.id, "input");
    setProcessControlBusy((current) => ({ ...current, [busyKey]: true }));
    setProcessControlError(null);
    try {
      await inputRuntimeManagedProcess({
        processId: process.id,
        expectedRevision: process.revision,
        value,
        closeStdin,
        idempotencyKey: pending.key
      });
      inputKeys.current.delete(process.id);
      void load();
      return true;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : null;
      if (code) inputKeys.current.delete(process.id);
      setProcessControlError(
        code ? `${runtimeCopy.processInputFailed} (${code})` : runtimeCopy.processInputFailed
      );
      return false;
    } finally {
      setProcessControlBusy((current) => {
        if (!current[busyKey]) return current;
        const next = { ...current };
        delete next[busyKey];
        return next;
      });
    }
  }, [load, runtimeCopy.processInputFailed]);

  const resizeProcess = useCallback(async (
    process: RuntimeExecutionProcessProjection,
    rows: number,
    cols: number
  ): Promise<void> => {
    if (!process.controls.resize) return;
    const signature = `${rows}x${cols}`;
    let pending = resizeKeys.current.get(process.id);
    if (!pending || pending.signature !== signature) {
      pending = {
        signature,
        key: `runtime.process.resize.web:${crypto.randomUUID()}`
      };
      resizeKeys.current.set(process.id, pending);
    }
    const busyKey = processControlBusyKey(process.id, "resize");
    setProcessControlBusy((current) => ({ ...current, [busyKey]: true }));
    setProcessControlError(null);
    try {
      await resizeRuntimeManagedProcess({
        processId: process.id,
        expectedRevision: process.revision,
        rows,
        cols,
        idempotencyKey: pending.key
      });
      resizeKeys.current.delete(process.id);
      void load();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : null;
      if (code) resizeKeys.current.delete(process.id);
      setProcessControlError(
        code ? `${runtimeCopy.processResizeFailed} (${code})` : runtimeCopy.processResizeFailed
      );
    } finally {
      setProcessControlBusy((current) => {
        if (!current[busyKey]) return current;
        const next = { ...current };
        delete next[busyKey];
        return next;
      });
    }
  }, [load, runtimeCopy.processResizeFailed]);

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
    const onProcessOutput = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as ProcessOutputEvent;
        if (next?.ok !== true || !next.processId || !Array.isArray(next.chunks)) return;
        let seen = seenOutputSequences.current.get(next.processId);
        if (!seen) {
          seen = new Set<number>();
          seenOutputSequences.current.set(next.processId, seen);
        }
        const fresh = next.chunks.filter((chunk) => {
          if (seen!.has(chunk.sequence)) return false;
          seen!.add(chunk.sequence);
          return true;
        });
        if (fresh.length === 0) return;
        setProcessOutputs((current) => ({
          ...current,
          [next.processId]: [...(current[next.processId] ?? []), ...fresh].slice(-1200)
        }));
      } catch {
        // A malformed output event must not tear down the authoritative snapshot stream.
      }
    };
    source.addEventListener("runtime.execution.snapshot", onSnapshot as EventListener);
    source.addEventListener("runtime.process.output", onProcessOutput as EventListener);
    source.onopen = () => setStreamState("live");
    source.onerror = () =>
      setStreamState(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    return () => {
      source.removeEventListener("runtime.execution.snapshot", onSnapshot as EventListener);
      source.removeEventListener("runtime.process.output", onProcessOutput as EventListener);
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
  const terminalTargets = useMemo(() => {
    const bySession = new Map<string, RuntimeExecutionObservabilityResponse["tasks"][number]>();
    for (const task of tasks) {
      if (!task.activeSessionId || bySession.has(task.activeSessionId)) continue;
      bySession.set(task.activeSessionId, task);
    }
    return [...bySession.values()].slice(0, 6);
  }, [tasks]);
  const processConsoles = useMemo(() => {
    const groups = new Map<string, SessionConsoleGroup>();
    for (const process of snapshot?.processes ?? []) {
      const current = groups.get(process.consoleSessionId);
      if (current) {
        current.processes.push(process);
        if (process.startedAt > current.lastStartedAt) current.lastStartedAt = process.startedAt;
        if (processKeepsSessionConsoleLive(process)) current.active = true;
        if (!current.projectDisplayName && process.projectDisplayName) {
          current.projectDisplayName = process.projectDisplayName;
        }
        if (!current.repoId && process.repoId) current.repoId = process.repoId;
      } else {
        groups.set(process.consoleSessionId, {
          id: process.consoleSessionId,
          deviceId: process.deviceId,
          sessionId: process.sessionId,
          projectDisplayName: process.projectDisplayName,
          repoId: process.repoId,
          processes: [process],
          lastStartedAt: process.startedAt,
          active: processKeepsSessionConsoleLive(process)
        });
      }
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        processes: group.processes.sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      }))
      .sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1;
        return right.lastStartedAt.localeCompare(left.lastStartedAt);
      })
      .slice(0, 10);
  }, [snapshot]);
  useEffect(() => {
    if (
      terminatingProcessId &&
      !(snapshot?.processes ?? []).some(
        (process) => process.id === terminatingProcessId &&
          (process.status === "starting" || process.status === "running")
      )
    ) {
      setTerminatingProcessId(null);
    }
  }, [snapshot, terminatingProcessId]);
  const connections = useMemo(() => (snapshot?.connections ?? []).slice(0, 12), [snapshot]);
  const hasExecution = activities.length > 0 || tasks.length > 0 || terminalTargets.length > 0 || processConsoles.length > 0 || connections.length > 0;

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

      {terminalTargets.length > 0 ? (
        <section className="runtime-live-execution__sessions">
          <div className="runtime-live-execution__sessions-heading">
            <div>
              <div className="runtime-live-execution__section-title">
                <CodeOutlined /> {runtimeCopy.sessionConsoleTitle}
              </div>
              <p>{runtimeCopy.sessionConsoleDescription}</p>
            </div>
          </div>
          <div className="runtime-live-execution__terminal-stack">
            {terminalTargets.map((task) => (
              <PersistentSessionTerminalCard
                key={task.activeSessionId ?? task.id}
                locale={locale}
                task={task}
              />
            ))}
          </div>
        </section>
      ) : null}

      {processConsoles.length > 0 ? (
        <section className="runtime-live-execution__sessions">
          <div className="runtime-live-execution__sessions-heading">
            <div>
              <div className="runtime-live-execution__section-title">
                <CodeOutlined /> {runtimeCopy.processConsoleTitle}
              </div>
              <p>{runtimeCopy.processConsoleDescription}</p>
            </div>
          </div>
          <div className="runtime-live-execution__session-grid">
            {processConsoles.map((group) => (
              <ManagedProcessConsoleCard
                key={group.id}
                locale={locale}
                group={group}
                outputByProcess={processOutputs}
                processTerminateAvailable={processTerminateAvailable}
                terminatingProcessId={terminatingProcessId}
                processControlBusy={processControlBusy}
                onInput={sendProcessInput}
                onResize={resizeProcess}
                onTerminate={(process) => void terminateProcess(process)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {activities.length > 0 || connections.length > 0 ? (
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
