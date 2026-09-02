import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

import { ServiceError } from "../../application/service-error.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "../../core/product-identity.js";
import type { ProductIdentityKey } from "../../types.js";

interface AppServerRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface AppServerResponse {
  id: number | string;
  result?: unknown;
  error?: AppServerRpcError;
}

export type CodexAppServerRequestId = number | string;

export interface CodexAppServerInboundRequest {
  connectionId: string;
  requestKey: string;
  id: CodexAppServerRequestId;
  method: string;
  params: Record<string, unknown>;
}

export interface CodexAppServerInboundNotification {
  connectionId: string;
  method: string;
  params: Record<string, unknown>;
}

export interface CodexAppServerEventHandlers {
  onRequest?(request: CodexAppServerInboundRequest): void | Promise<void>;
  onNotification?(
    notification: CodexAppServerInboundNotification
  ): void | Promise<void>;
}

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout | null;
  abortCleanup: (() => void) | null;
}

export interface CodexAppServerRequestOptions {
  timeoutMs?: number | null;
  signal?: AbortSignal;
}

export interface CodexAppServerClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  clientVersion?: string;
  productIdentity?: ProductIdentityKey;
  experimentalApi?: boolean;
}

export interface CodexAppServerInitialization {
  userAgent: string | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown>;
  raw: Record<string, unknown>;
}

const MAX_STDERR_CHARS = 32_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rpcError(method: string, error: AppServerRpcError): ServiceError {
  if (
    method === "thread/resume" &&
    error.code === -32600 &&
    /already has an active writer/i.test(error.message)
  ) {
    return new ServiceError(
      "CODEX_THREAD_ACTIVE_WRITER",
      "This Codex thread is currently owned by another active Codex surface",
      {
        details: {
          method,
          rpcCode: error.code,
          writerState: "busy-elsewhere"
        }
      }
    );
  }

  if (error.code === -32601) {
    return new ServiceError(
      "CAPABILITY_UNAVAILABLE",
      `Codex App Server does not support ${method}`,
      {
        details: {
          method,
          rpcCode: error.code
        }
      }
    );
  }

  return new ServiceError(
    "CODEX_APP_SERVER_RPC_ERROR",
    `Codex App Server request ${method} failed: ${error.message}`,
    {
      details: {
        method,
        rpcCode: error.code
      }
    }
  );
}

export class CodexAppServerClient {
  private readonly options: Required<
    Pick<CodexAppServerClientOptions, "command" | "requestTimeoutMs" | "clientVersion">
  > &
    Omit<CodexAppServerClientOptions, "command" | "requestTimeoutMs" | "clientVersion">;
  private child: ChildProcessWithoutNullStreams | null = null;
  private lineReader: readline.Interface | null = null;
  private pending = new Map<number, PendingRequest>();
  private inbound = new Map<
    string,
    { id: CodexAppServerRequestId; method: string }
  >();
  private handlers: CodexAppServerEventHandlers = {};
  private connectionId = randomUUID();
  private nextRequestId = 1;
  private starting: Promise<CodexAppServerInitialization> | null = null;
  private initialization: CodexAppServerInitialization | null = null;
  private stderr = "";
  private closing = false;
  private readonly productIdentity: ProductIdentityKey;

  constructor(options: CodexAppServerClientOptions) {
    this.productIdentity = options.productIdentity ?? DEFAULT_PRODUCT_IDENTITY.key;
    this.options = {
      ...options,
      args: options.args ?? ["app-server", "--stdio"],
      requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
      clientVersion: options.clientVersion ?? "0.1.0-alpha"
    };
  }

  setEventHandlers(handlers: CodexAppServerEventHandlers): void {
    this.handlers = handlers;
  }

  async start(): Promise<CodexAppServerInitialization> {
    if (this.initialization) {
      return this.initialization;
    }
    if (this.starting) {
      return this.starting;
    }

    this.starting = this.startInternal();
    try {
      this.initialization = await this.starting;
      return this.initialization;
    } finally {
      this.starting = null;
    }
  }

  async request<T = unknown>(
    method: string,
    params: unknown = {},
    options: CodexAppServerRequestOptions = {}
  ): Promise<T> {
    await this.start();
    return this.sendRequest<T>(method, params, options);
  }

  async respondToServerRequest(
    requestKey: string,
    result: Record<string, unknown>
  ): Promise<void> {
    const request = this.inbound.get(requestKey);
    if (!request) {
      throw new ServiceError(
        "CODEX_SERVER_REQUEST_UNAVAILABLE",
        "The Codex App Server request is no longer pending",
        { details: { requestKey } }
      );
    }
    await this.writeMessage({ id: request.id, result }, request.method);
    this.inbound.delete(requestKey);
  }

  async rejectServerRequest(
    requestKey: string,
    code: number,
    message: string
  ): Promise<void> {
    const request = this.inbound.get(requestKey);
    if (!request) {
      throw new ServiceError(
        "CODEX_SERVER_REQUEST_UNAVAILABLE",
        "The Codex App Server request is no longer pending",
        { details: { requestKey } }
      );
    }
    await this.writeMessage(
      { id: request.id, error: { code, message } },
      request.method
    );
    this.inbound.delete(requestKey);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.rejectPending(
      new ServiceError(
        "CODEX_APP_SERVER_DISCONNECTED",
        "Codex App Server connection was closed"
      )
    );
    this.lineReader?.close();
    this.lineReader = null;
    this.inbound.clear();

    const child = this.child;
    this.child = null;
    this.initialization = null;
    if (!child || child.exitCode !== null) {
      return;
    }

    child.stdin.end();
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 2_000);
      killTimer.unref();
      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  }

  private async startInternal(): Promise<CodexAppServerInitialization> {
    this.closing = false;
    this.stderr = "";
    this.connectionId = randomUUID();
    this.inbound.clear();
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-MAX_STDERR_CHARS);
    });
    child.on("error", (error) => {
      this.rejectPending(
        new ServiceError(
          "CODEX_APP_SERVER_START_FAILED",
          "Codex App Server process could not be started",
          {
            details: {
              reasonCode: (error as NodeJS.ErrnoException).code ?? "UNKNOWN"
            }
          }
        )
      );
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) {
        this.child = null;
        this.initialization = null;
      }
      if (!this.closing) {
        this.rejectPending(
          new ServiceError(
            "CODEX_APP_SERVER_DISCONNECTED",
            "Codex App Server disconnected unexpectedly",
            {
              details: {
                exitCode: code,
                signal,
                diagnosticsCaptured: Boolean(this.stderr.trim())
              }
            }
          )
        );
      }
    });

    this.lineReader = readline.createInterface({ input: child.stdout });
    this.lineReader.on("line", (line) => this.handleLine(line));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new ServiceError(
            "CODEX_APP_SERVER_START_FAILED",
            "Codex App Server did not start before the timeout"
          )
        );
      }, 5_000);
      timeout.unref();
      child.once("spawn", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(
          new ServiceError(
            "CODEX_APP_SERVER_START_FAILED",
            "Codex App Server process could not be started",
            {
              details: {
                reasonCode: (error as NodeJS.ErrnoException).code ?? "UNKNOWN"
              }
            }
          )
        );
      });
    });

    const identity = productIdentityForKey(this.productIdentity);
    const raw = asRecord(
      await this.sendRequest<Record<string, unknown>>("initialize", {
        clientInfo: {
          name: identity.packageName,
          title: identity.displayName,
          version: this.options.clientVersion
        },
        capabilities: {
          experimentalApi: this.options.experimentalApi ?? false
        }
      })
    );
    this.sendNotification("initialized", {});

    return {
      userAgent: typeof raw.userAgent === "string" ? raw.userAgent : null,
      protocolVersion:
        typeof raw.protocolVersion === "string" ? raw.protocolVersion : null,
      capabilities: asRecord(raw.capabilities),
      raw
    };
  }

  private sendRequest<T>(
    method: string,
    params: unknown,
    options: CodexAppServerRequestOptions = {}
  ): Promise<T> {
    const child = this.child;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      return Promise.reject(
        new ServiceError(
          "CODEX_APP_SERVER_DISCONNECTED",
          "Codex App Server is not connected"
        )
      );
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const cleanupPending = (pending: PendingRequest | undefined) => {
        if (!pending) return;
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.abortCleanup?.();
        this.pending.delete(id);
      };
      const requestTimeoutMs =
        options.timeoutMs === undefined
          ? this.options.requestTimeoutMs
          : options.timeoutMs;
      const timeout =
        requestTimeoutMs === null
          ? null
          : setTimeout(() => {
              const pending = this.pending.get(id);
              cleanupPending(pending);
              reject(
                new ServiceError(
                  "CODEX_APP_SERVER_TIMEOUT",
                  `Codex App Server request ${method} timed out`,
                  { details: { method } }
                )
              );
            }, requestTimeoutMs);
      timeout?.unref();
      const abortHandler = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        cleanupPending(pending);
        reject(
          new ServiceError(
            "CODEX_APP_SERVER_REQUEST_ABORTED",
            `Codex App Server request ${method} was abandoned after terminal process proof`,
            { details: { method } }
          )
        );
      };
      const abortCleanup = options.signal
        ? () => options.signal?.removeEventListener("abort", abortHandler)
        : null;
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
        abortCleanup
      });
      if (options.signal?.aborted) {
        abortHandler();
        return;
      }
      options.signal?.addEventListener("abort", abortHandler, { once: true });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        cleanupPending(pending);
        reject(
          new ServiceError(
            "CODEX_APP_SERVER_DISCONNECTED",
            "Codex App Server request could not be written",
            { details: { method } }
          )
        );
      });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const child = this.child;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      return;
    }
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private writeMessage(
    message: Record<string, unknown>,
    method: string
  ): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      return Promise.reject(
        new ServiceError(
          "CODEX_APP_SERVER_DISCONNECTED",
          "Codex App Server is not connected"
        )
      );
    }
    return new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (!error) {
          resolve();
          return;
        }
        reject(
          new ServiceError(
            "CODEX_APP_SERVER_DISCONNECTED",
            "Codex App Server response could not be written",
            { details: { method } }
          )
        );
      });
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    const record = asRecord(message);
    if (typeof record.method === "string") {
      const params = asRecord(record.params);
      if (typeof record.id === "number" || typeof record.id === "string") {
        const requestKey = `${this.connectionId}:${JSON.stringify(record.id)}`;
        this.inbound.set(requestKey, {
          id: record.id,
          method: record.method
        });
        const handler = this.handlers.onRequest;
        if (!handler) {
          void this.rejectServerRequest(
            requestKey,
            -32601,
            "ChatCockpit does not handle this Codex App Server request"
          );
          return;
        }
        void Promise.resolve(
          handler({
            connectionId: this.connectionId,
            requestKey,
            id: record.id,
            method: record.method,
            params
          })
        ).catch(() => {
          void this.rejectServerRequest(
            requestKey,
            -32603,
            "ChatCockpit could not persist the Codex App Server request"
          );
        });
        return;
      }

      const notificationHandler = this.handlers.onNotification;
      if (notificationHandler) {
        void Promise.resolve(
          notificationHandler({
            connectionId: this.connectionId,
            method: record.method,
            params
          })
        ).catch(() => {
          // Notifications are best-effort; persistence errors are handled by
          // the runtime event sink and must not crash the protocol reader.
        });
      }
      return;
    }

    if (typeof record.id !== "number") {
      return;
    }
    const pending = this.pending.get(record.id);
    if (!pending) {
      return;
    }
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.abortCleanup?.();
    this.pending.delete(record.id);

    if (record.error) {
      pending.reject(rpcError(pending.method, record.error as AppServerRpcError));
      return;
    }
    pending.resolve(record.result);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.abortCleanup?.();
      pending.reject(error);
    }
    this.pending.clear();
  }
}
