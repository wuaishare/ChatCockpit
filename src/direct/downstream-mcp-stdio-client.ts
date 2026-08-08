import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  CallToolResultSchema,
  InitializeResultSchema,
  JSONRPCMessageSchema,
  ListToolsResultSchema
} from "@modelcontextprotocol/core";
import {
  LATEST_PROTOCOL_VERSION,
  ReadBuffer,
  serializeMessage
} from "@modelcontextprotocol/server";

import type {
  DownstreamMcpClient,
  DownstreamMcpListToolsResult,
  DownstreamMcpServerIdentity
} from "./downstream-mcp-types.js";

export type DownstreamMcpClientErrorCode =
  | "DOWNSTREAM_MCP_START_FAILED"
  | "DOWNSTREAM_MCP_DISCONNECTED"
  | "DOWNSTREAM_MCP_TIMEOUT"
  | "DOWNSTREAM_MCP_PROTOCOL_ERROR"
  | "DOWNSTREAM_MCP_RESPONSE_INVALID";

export class DownstreamMcpClientError extends Error {
  constructor(
    readonly code: DownstreamMcpClientErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DownstreamMcpClientError";
  }
}

export interface DownstreamMcpStdioClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
  maxStderrBytes?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

type JsonRpcRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRpcRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRpcRecord)
    : null;
}

function safeIdentity(value: {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
}): DownstreamMcpServerIdentity {
  return {
    name: value.serverInfo.name,
    version: value.serverInfo.version,
    protocolVersion: value.protocolVersion
  };
}

export class DownstreamMcpStdioClient implements DownstreamMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly readBuffer: ReadBuffer;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private identity: DownstreamMcpServerIdentity | null = null;
  private stderrBytes = 0;

  constructor(private readonly options: DownstreamMcpStdioClientOptions) {
    this.readBuffer = new ReadBuffer({
      maxBufferSize: options.maxBufferBytes ?? 1024 * 1024
    });
  }

  async initialize(): Promise<DownstreamMcpServerIdentity> {
    if (this.identity) {
      return { ...this.identity };
    }
    this.ensureStarted();
    const result = await this.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "tokenpilot-downstream-mcp",
        version: "0.1.0-alpha"
      }
    });
    const parsed = InitializeResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_RESPONSE_INVALID",
        "Downstream MCP initialize result failed protocol validation"
      );
    }
    this.identity = safeIdentity(parsed.data);
    this.notify("notifications/initialized", {});
    return { ...this.identity };
  }

  async listTools(): Promise<DownstreamMcpListToolsResult> {
    const server = await this.initialize();
    const tools: DownstreamMcpListToolsResult["tools"] = [];
    let cursor: string | undefined;

    do {
      const result = await this.request(
        "tools/list",
        cursor ? { cursor } : {}
      );
      const parsed = ListToolsResultSchema.safeParse(result);
      if (!parsed.success) {
        throw new DownstreamMcpClientError(
          "DOWNSTREAM_MCP_RESPONSE_INVALID",
          "Downstream MCP tools/list result failed protocol validation"
        );
      }
      for (const tool of parsed.data.tools) {
        tools.push({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {})
        });
      }
      cursor = parsed.data.nextCursor;
    } while (cursor);

    return {
      server,
      tools
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    await this.initialize();
    const result = await this.request("tools/call", {
      name,
      arguments: args
    });
    const parsed = CallToolResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_RESPONSE_INVALID",
        "Downstream MCP tools/call result failed protocol validation"
      );
    }
    return parsed.data;
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.identity = null;
    this.rejectPending(
      new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_DISCONNECTED",
        "Downstream MCP client closed"
      )
    );
    this.readBuffer.clear();
    if (!child || child.exitCode !== null || child.killed) {
      return;
    }
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 1000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child;
    }
    this.stderrBytes = 0;
    try {
      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: this.options.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.child = child;
      child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        this.stderrBytes += chunk.length;
        if (this.stderrBytes > (this.options.maxStderrBytes ?? 64 * 1024)) {
          this.failConnection(
            new DownstreamMcpClientError(
              "DOWNSTREAM_MCP_PROTOCOL_ERROR",
              "Downstream MCP stderr exceeded the configured limit"
            )
          );
        }
      });
      child.once("error", () => {
        this.failConnection(
          new DownstreamMcpClientError(
            "DOWNSTREAM_MCP_START_FAILED",
            "Downstream MCP process could not be started"
          )
        );
      });
      child.once("exit", () => {
        if (this.child === child) {
          this.child = null;
        }
        this.identity = null;
        this.rejectPending(
          new DownstreamMcpClientError(
            "DOWNSTREAM_MCP_DISCONNECTED",
            "Downstream MCP process disconnected"
          )
        );
      });
      return child;
    } catch {
      throw new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_START_FAILED",
        "Downstream MCP process could not be started"
      );
    }
  }

  private handleStdout(chunk: Buffer): void {
    try {
      this.readBuffer.append(chunk);
      while (true) {
        const message = this.readBuffer.readMessage();
        if (!message) {
          break;
        }
        const validated = JSONRPCMessageSchema.safeParse(message);
        if (!validated.success) {
          throw new DownstreamMcpClientError(
            "DOWNSTREAM_MCP_PROTOCOL_ERROR",
            "Downstream MCP emitted an invalid JSON-RPC message"
          );
        }
        this.handleMessage(validated.data as unknown);
      }
    } catch (error) {
      this.failConnection(
        error instanceof DownstreamMcpClientError
          ? error
          : new DownstreamMcpClientError(
              "DOWNSTREAM_MCP_PROTOCOL_ERROR",
              "Downstream MCP stdout could not be decoded safely"
            )
      );
    }
  }

  private handleMessage(message: unknown): void {
    const record = asRecord(message);
    if (!record) {
      return;
    }
    if (typeof record.id === "number" && ("result" in record || "error" in record)) {
      const pending = this.pending.get(record.id);
      if (!pending) {
        return;
      }
      this.pending.delete(record.id);
      clearTimeout(pending.timer);
      if ("error" in record) {
        pending.reject(
          new DownstreamMcpClientError(
            "DOWNSTREAM_MCP_PROTOCOL_ERROR",
            "Downstream MCP returned a JSON-RPC error"
          )
        );
      } else {
        pending.resolve(record.result);
      }
      return;
    }

    if (typeof record.id === "number" && typeof record.method === "string") {
      this.send({
        jsonrpc: "2.0",
        id: record.id,
        error: {
          code: -32601,
          message: "TokenPilot downstream probe does not support server requests"
        }
      });
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new DownstreamMcpClientError(
            "DOWNSTREAM_MCP_TIMEOUT",
            `Downstream MCP ${method} request timed out`
          )
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          error instanceof Error
            ? error
            : new DownstreamMcpClientError(
                "DOWNSTREAM_MCP_DISCONNECTED",
                "Downstream MCP request could not be sent"
              )
        );
      }
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(
    message: Parameters<typeof serializeMessage>[0]
  ): void {
    const child = this.ensureStarted();
    if (!child.stdin.writable) {
      throw new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_DISCONNECTED",
        "Downstream MCP stdin is not writable"
      );
    }
    child.stdin.write(serializeMessage(message));
  }

  private failConnection(error: DownstreamMcpClientError): void {
    const child = this.child;
    this.child = null;
    this.identity = null;
    this.readBuffer.clear();
    this.rejectPending(error);
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
