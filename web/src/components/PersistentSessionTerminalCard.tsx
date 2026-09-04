import {
  DisconnectOutlined,
  PlayCircleOutlined,
  StopOutlined
} from "@ant-design/icons";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Button, Popconfirm, Space, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchRuntimeSessionTerminals,
  inputRuntimeSessionTerminal,
  readRuntimeSessionTerminal,
  resizeRuntimeSessionTerminal,
  startRuntimeSessionTerminal,
  terminateRuntimeSessionTerminal
} from "../api";
import type { LocaleCode } from "../i18n";
import { getRuntimeCopy } from "../i18n/runtime";
import type {
  RuntimeExecutionTaskProjection,
  RuntimeSessionTerminalProjection
} from "../types";
import "@xterm/xterm/css/xterm.css";

function compactId(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}…${value.slice(-7)}`;
}

function statusLabel(locale: LocaleCode, terminal: RuntimeSessionTerminalProjection | null): string {
  if (!terminal) return locale === "zh-CN" ? "未启动" : "Not started";
  if (terminal.state === "running") return locale === "zh-CN" ? "已附着" : "Attached";
  if (terminal.state === "terminated") return locale === "zh-CN" ? "已终止" : "Terminated";
  if (terminal.state === "failed") return locale === "zh-CN" ? "失败" : "Failed";
  return locale === "zh-CN" ? "已退出" : "Exited";
}

function statusColor(terminal: RuntimeSessionTerminalProjection | null): string {
  if (!terminal) return "default";
  if (terminal.state === "running") return "processing";
  if (terminal.state === "failed") return "error";
  return "default";
}

function errorMessage(locale: LocaleCode, code: string | null, fallback: string): string {
  return code ? `${fallback} (${code})` : fallback;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

export function PersistentSessionTerminalCard({
  locale,
  task
}: {
  locale: LocaleCode;
  task: RuntimeExecutionTaskProjection;
}) {
  const runtimeCopy = getRuntimeCopy(locale);
  const sessionId = task.activeSessionId;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalProjectionRef = useRef<RuntimeSessionTerminalProjection | null>(null);
  const cursorRef = useRef(0);
  const inputBufferRef = useRef("");
  const inputRetryRef = useRef<{
    terminalId: string;
    value: string;
    idempotencyKey: string;
  } | null>(null);
  const inputSendingRef = useRef(false);
  const inputFlushTimerRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastResizeRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const startKeyRef = useRef<string | null>(null);
  const stopKeyRef = useRef<string | null>(null);
  const focusAfterStartRef = useRef(false);
  const mountedRef = useRef(true);

  const [terminalProjection, setTerminalProjection] = useState<RuntimeSessionTerminalProjection | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollbackTruncated, setScrollbackTruncated] = useState(false);

  const terminalIsRunning = terminalProjection?.state === "running";
  const canStart = Boolean(sessionId) && !terminalIsRunning && !starting;

  const updateProjection = useCallback((next: RuntimeSessionTerminalProjection) => {
    terminalProjectionRef.current = next;
    setTerminalProjection(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (inputFlushTimerRef.current !== null) window.clearTimeout(inputFlushTimerRef.current);
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  const loadExisting = useCallback(async () => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchRuntimeSessionTerminals(sessionId);
      const running = response.terminals.find((terminal) => terminal.state === "running");
      const selected = running ?? response.terminals[0] ?? null;
      terminalProjectionRef.current = selected;
      setTerminalProjection(selected);
    } catch (caught) {
      setError(
        errorMessage(
          locale,
          errorCode(caught),
          locale === "zh-CN" ? "会话终端状态加载失败" : "Failed to load session terminal state"
        )
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [locale, sessionId]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  useEffect(() => {
    inputBufferRef.current = "";
    inputRetryRef.current = null;
    if (inputFlushTimerRef.current !== null) {
      window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
  }, [terminalProjection?.terminalId]);

  const flushInput = useCallback(async () => {
    if (inputSendingRef.current) return;
    const terminal = terminalProjectionRef.current;
    if (!terminal || terminal.state !== "running") return;

    let batch = inputRetryRef.current;
    if (batch && batch.terminalId !== terminal.terminalId) {
      inputRetryRef.current = null;
      batch = null;
    }
    if (!batch) {
      const value = inputBufferRef.current;
      if (!value) return;
      inputBufferRef.current = "";
      batch = {
        terminalId: terminal.terminalId,
        value,
        idempotencyKey: `runtime.terminal.input.web:${crypto.randomUUID()}`
      };
      inputRetryRef.current = batch;
    }

    inputSendingRef.current = true;
    try {
      const response = await inputRuntimeSessionTerminal({
        terminalId: batch.terminalId,
        expectedRevision: terminal.processRevision,
        input: batch.value,
        idempotencyKey: batch.idempotencyKey
      });
      if (inputRetryRef.current?.idempotencyKey === batch.idempotencyKey) {
        inputRetryRef.current = null;
      }
      if (terminalProjectionRef.current?.terminalId === batch.terminalId) {
        updateProjection(response);
        setError(null);
      }
    } catch (caught) {
      const code = errorCode(caught);
      if (terminalProjectionRef.current?.terminalId === batch.terminalId) {
        if (code) {
          if (inputRetryRef.current?.idempotencyKey === batch.idempotencyKey) {
            inputRetryRef.current = null;
          }
          inputBufferRef.current = "";
        } else {
          inputRetryRef.current = batch;
        }
        setError(
          errorMessage(
            locale,
            code,
            locale === "zh-CN" ? "终端输入发送失败" : "Failed to send terminal input"
          )
        );
      }
    } finally {
      inputSendingRef.current = false;
      const current = terminalProjectionRef.current;
      const pending = Boolean(inputRetryRef.current || inputBufferRef.current);
      if (pending && current?.state === "running" && mountedRef.current) {
        inputFlushTimerRef.current = window.setTimeout(() => {
          inputFlushTimerRef.current = null;
          void flushInput();
        }, inputRetryRef.current ? 250 : 40);
      }
    }
  }, [locale, updateProjection]);

  const queueInput = useCallback((value: string) => {
    if (!value) return;
    inputBufferRef.current += value;
    if (inputBufferRef.current.length >= 4096) {
      if (inputFlushTimerRef.current !== null) window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
      void flushInput();
      return;
    }
    if (inputFlushTimerRef.current !== null) return;
    inputFlushTimerRef.current = window.setTimeout(() => {
      inputFlushTimerRef.current = null;
      void flushInput();
    }, 20);
  }, [flushInput]);

  const requestResize = useCallback((rows: number, cols: number) => {
    const terminal = terminalProjectionRef.current;
    if (!terminal || terminal.state !== "running") return;
    const signature = `${terminal.terminalId}:${rows}x${cols}`;
    if (lastResizeRef.current === signature) return;
    lastResizeRef.current = signature;
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = window.setTimeout(async () => {
      resizeTimerRef.current = null;
      const current = terminalProjectionRef.current;
      if (!current || current.state !== "running" || current.terminalId !== terminal.terminalId) return;
      try {
        const response = await resizeRuntimeSessionTerminal({
          terminalId: current.terminalId,
          expectedRevision: current.processRevision,
          rows,
          cols,
          idempotencyKey: `runtime.terminal.resize.web:${crypto.randomUUID()}`
        });
        updateProjection(response);
      } catch (caught) {
        lastResizeRef.current = null;
        setError(
          errorMessage(
            locale,
            errorCode(caught),
            locale === "zh-CN" ? "终端尺寸同步失败" : "Failed to resize terminal"
          )
        );
      }
    }, 120);
  }, [locale, updateProjection]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !terminalProjection) return;

    const instance = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: terminalProjection.state === "running",
      cursorStyle: "block",
      disableStdin: terminalProjection.state !== "running",
      fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: 12.5,
      lineHeight: 1.28,
      scrollback: 6000,
      smoothScrollDuration: 80,
      theme: {
        background: "#0f1115",
        foreground: "#d8dde7",
        cursor: "#f4f6fa",
        cursorAccent: "#0f1115",
        selectionBackground: "#344054",
        black: "#111318",
        brightBlack: "#687181",
        red: "#ef8f96",
        brightRed: "#ffabb1",
        green: "#9fd6a6",
        brightGreen: "#b8e6be",
        yellow: "#e4c58c",
        brightYellow: "#f3d59b",
        blue: "#96b7e6",
        brightBlue: "#b0c9ee",
        magenta: "#c7a8df",
        brightMagenta: "#d8baed",
        cyan: "#8bcbd1",
        brightCyan: "#a8dfe3",
        white: "#d8dde7",
        brightWhite: "#f4f6fa"
      }
    });
    const fitAddon = new FitAddon();
    instance.loadAddon(fitAddon);
    instance.open(host);
    terminalInstanceRef.current = instance;
    fitAddonRef.current = fitAddon;
    cursorRef.current = 0;
    setScrollbackTruncated(false);

    const dataDisposable = instance.onData((value) => queueInput(value));
    const resizeDisposable = instance.onResize(({ rows, cols }) => requestResize(rows, cols));
    const fit = () => {
      try {
        fitAddon.fit();
      } catch {
        // Layout can transiently report zero dimensions while the card is mounting.
      }
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => fit());
    observer?.observe(host);
    requestAnimationFrame(() => {
      fit();
      if (focusAfterStartRef.current) {
        focusAfterStartRef.current = false;
        instance.focus();
      }
    });

    return () => {
      observer?.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      instance.dispose();
      if (terminalInstanceRef.current === instance) terminalInstanceRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
    };
  }, [queueInput, requestResize, terminalProjection?.terminalId]);

  useEffect(() => {
    const terminal = terminalProjection;
    const instance = terminalInstanceRef.current;
    if (!terminal || !instance) return;
    instance.options.disableStdin = terminal.state !== "running";
    instance.options.cursorBlink = terminal.state === "running";
  }, [terminalProjection?.state]);

  useEffect(() => {
    if (!terminalProjection || !terminalInstanceRef.current) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      const current = terminalProjectionRef.current;
      if (!current) return;
      try {
        const response = await readRuntimeSessionTerminal({
          terminalId: current.terminalId,
          cursor: cursorRef.current,
          limit: 200
        });
        if (cancelled) return;
        if (response.cursorTruncated) setScrollbackTruncated(true);
        for (const chunk of response.chunks) {
          terminalInstanceRef.current?.write(chunk.content);
        }
        cursorRef.current = response.nextCursor;
        updateProjection(response);
        setError(null);
        const delay = response.state === "running"
          ? response.chunks.length > 0 ? 60 : document.hidden ? 900 : 180
          : 1200;
        if (response.state === "running") {
          pollTimerRef.current = window.setTimeout(() => void poll(), delay);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(
          errorMessage(
            locale,
            errorCode(caught),
            locale === "zh-CN" ? "终端输出同步失败，正在重试" : "Terminal output sync failed; retrying"
          )
        );
        pollTimerRef.current = window.setTimeout(() => void poll(), 1000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [locale, terminalProjection?.terminalId, updateProjection]);

  const startTerminal = useCallback(async () => {
    if (!sessionId || starting) return;
    setStarting(true);
    setError(null);
    if (!startKeyRef.current) {
      startKeyRef.current = `runtime.terminal.start.web:${crypto.randomUUID()}`;
    }
    try {
      const rows = Math.max(18, Math.min(60, fitAddonRef.current?.proposeDimensions()?.rows ?? 28));
      const cols = Math.max(60, Math.min(220, fitAddonRef.current?.proposeDimensions()?.cols ?? 110));
      const response = await startRuntimeSessionTerminal({
        sessionId,
        rows,
        cols,
        idempotencyKey: startKeyRef.current
      });
      startKeyRef.current = null;
      cursorRef.current = 0;
      focusAfterStartRef.current = true;
      updateProjection(response);
    } catch (caught) {
      startKeyRef.current = null;
      setError(
        errorMessage(
          locale,
          errorCode(caught),
          locale === "zh-CN" ? "会话终端启动失败" : "Failed to start session terminal"
        )
      );
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [locale, sessionId, starting, updateProjection]);

  const stopTerminal = useCallback(async () => {
    const current = terminalProjectionRef.current;
    if (!current || current.state !== "running" || stopping) return;
    setStopping(true);
    setError(null);
    if (!stopKeyRef.current) {
      stopKeyRef.current = `runtime.terminal.stop.web:${crypto.randomUUID()}`;
    }
    try {
      const response = await terminateRuntimeSessionTerminal({
        terminalId: current.terminalId,
        expectedRevision: current.processRevision,
        idempotencyKey: stopKeyRef.current
      });
      stopKeyRef.current = null;
      updateProjection(response);
    } catch (caught) {
      stopKeyRef.current = null;
      setError(
        errorMessage(
          locale,
          errorCode(caught),
          locale === "zh-CN" ? "会话终端终止失败" : "Failed to terminate session terminal"
        )
      );
    } finally {
      if (mountedRef.current) setStopping(false);
    }
  }, [locale, stopping, updateProjection]);

  const metadata = useMemo(() => {
    if (!terminalProjection) return null;
    return `${terminalProjection.cols}×${terminalProjection.rows} · PID ${terminalProjection.privatePid}`;
  }, [terminalProjection]);

  return (
    <article className={`runtime-persistent-terminal${terminalIsRunning ? " is-live" : ""}`}>
      <header className="runtime-persistent-terminal__header">
        <div className="runtime-persistent-terminal__identity">
          <span className={`runtime-persistent-terminal__pulse${terminalIsRunning ? " is-live" : ""}`} aria-hidden="true" />
          <div className="runtime-persistent-terminal__identity-copy">
            <div className="runtime-persistent-terminal__title-row">
              <strong>{task.projectDisplayName ?? runtimeCopy.unknownProject}</strong>
              <span>{task.title}</span>
            </div>
            <div className="runtime-persistent-terminal__meta">
              {sessionId ? <code>session {compactId(sessionId)}</code> : null}
              {task.repoId ? <code>{task.repoId}</code> : null}
              {terminalProjection ? <code>{compactId(terminalProjection.terminalId)}</code> : null}
              {metadata ? <span>{metadata}</span> : null}
            </div>
          </div>
        </div>
        <Space size={6} wrap>
          <Tag color={statusColor(terminalProjection)}>{loading ? "…" : statusLabel(locale, terminalProjection)}</Tag>
          {canStart ? (
            <Button
              size="small"
              type="primary"
              ghost
              icon={<PlayCircleOutlined />}
              loading={starting}
              onClick={() => void startTerminal()}
            >
              {locale === "zh-CN" ? "启动终端" : "Start terminal"}
            </Button>
          ) : null}
          {terminalIsRunning ? (
            <Popconfirm
              title={locale === "zh-CN" ? "终止这个会话终端？" : "Terminate this session terminal?"}
              description={locale === "zh-CN"
                ? "这会终止当前 PTY shell；会话本身不会因此结束。"
                : "This terminates the current PTY shell without ending the development session."}
              okText={locale === "zh-CN" ? "终止终端" : "Terminate"}
              cancelText={runtimeCopy.cancel}
              okButtonProps={{ danger: true }}
              onConfirm={() => void stopTerminal()}
            >
              <Button size="small" danger type="text" icon={<StopOutlined />} loading={stopping}>
                {locale === "zh-CN" ? "终止" : "Terminate"}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </header>

      {terminalProjection ? (
        <div className="runtime-persistent-terminal__shell">
          <div ref={hostRef} className="runtime-persistent-terminal__xterm" />
          <div className="runtime-persistent-terminal__statusbar">
            <span>
              {terminalProjection.state === "running"
                ? locale === "zh-CN" ? "Process Supervisor 持有真实 PTY" : "Real PTY owned by Process Supervisor"
                : locale === "zh-CN" ? "终端已结束，可重新启动" : "Terminal ended; it can be started again"}
            </span>
            {scrollbackTruncated ? (
              <Tooltip title={locale === "zh-CN" ? "较早输出已超出保留窗口" : "Older output exceeded the retained scrollback window"}>
                <span className="runtime-persistent-terminal__warning">
                  <DisconnectOutlined /> {locale === "zh-CN" ? "历史输出已裁剪" : "Scrollback truncated"}
                </span>
              </Tooltip>
            ) : null}
            <span>gen {compactId(terminalProjection.supervisorGeneration)}</span>
          </div>
        </div>
      ) : (
        <div className="runtime-persistent-terminal__empty">
          <CodeEmptyIcon />
          <div>
            <strong>{locale === "zh-CN" ? "当前会话尚未启动持久终端" : "No persistent terminal has been started for this session"}</strong>
            <p>{locale === "zh-CN"
              ? "终端启动后由独立 Process Supervisor 持有；关闭或重启 4318 控制台后可重新附着到同一个 PTY。"
              : "Once started, the PTY is owned by the independent Process Supervisor and can be reattached after the 4318 control plane restarts."}</p>
          </div>
        </div>
      )}

      {error ? <div className="runtime-persistent-terminal__error">{error}</div> : null}
    </article>
  );
}

function CodeEmptyIcon() {
  return <span className="runtime-persistent-terminal__empty-icon" aria-hidden="true">›_</span>;
}
