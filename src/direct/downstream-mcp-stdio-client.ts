import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/core";
import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

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

function definedEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function sdkErrorCode(error: unknown): string | null {
  if (error instanceof SdkError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

export class DownstreamMcpStdioClient implements DownstreamMcpClient {
  private sdkClient: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private identity: DownstreamMcpServerIdentity | null = null;
  private stderrBytes = 0;
  private fatalError: DownstreamMcpClientError | null = null;

  constructor(private readonly options: DownstreamMcpStdioClientOptions) {}

  get pid(): number | null {
    return this.transport?.pid ?? null;
  }

  async initialize(): Promise<DownstreamMcpServerIdentity> {
    if (this.identity && this.pid !== null) {
      return { ...this.identity };
    }
    if (!this.sdkClient || !this.transport || this.pid === null) {
      this.createSdkClient();
    }

    const client = this.sdkClient!;
    const transport = this.transport!;
    try {
      await this.withTimeout(client.connect(transport), "initialize");
    } catch (error) {
      throw this.mapError(error, "initialize");
    }
    this.installTransportErrorBridge(transport);

    const server = client.getServerVersion();
    const protocolVersion = client.getNegotiatedProtocolVersion();
    if (!server?.name || !server.version || !protocolVersion) {
      throw new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_RESPONSE_INVALID",
        "Downstream MCP initialize result did not include a valid server identity"
      );
    }
    this.identity = {
      name: server.name,
      version: server.version,
      protocolVersion
    };
    return { ...this.identity };
  }

  async listTools(): Promise<DownstreamMcpListToolsResult> {
    const server = await this.initialize();
    const tools: DownstreamMcpListToolsResult["tools"] = [];
    let cursor: string | undefined;

    do {
      let result: unknown;
      try {
        result = await this.withTimeout(
          this.sdkClient!.listTools(cursor ? { cursor } : {}, {
            timeout: this.timeoutMs
          }),
          "tools/list"
        );
      } catch (error) {
        throw this.mapError(error, "tools/list");
      }
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

    return { server, tools };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    await this.initialize();
    let result: unknown;
    try {
      result = await this.withTimeout(
        this.sdkClient!.callTool(
          { name, arguments: args },
          { timeout: this.timeoutMs }
        ),
        `tools/call:${name}`
      );
    } catch (error) {
      throw this.mapError(error, "tools/call");
    }
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
    const client = this.sdkClient;
    const transport = this.transport;
    this.sdkClient = null;
    this.transport = null;
    this.identity = null;
    this.fatalError = null;
    this.stderrBytes = 0;

    if (client) {
      try {
        await client.close();
        return;
      } catch {
        // Fall through to the owned transport so an SDK-level close error does
        // not leave the child process alive.
      }
    }
    if (transport) {
      await transport.close().catch(() => undefined);
    }
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 10_000;
  }

  private createSdkClient(): void {
    this.fatalError = null;
    this.stderrBytes = 0;
    const transport = new StdioClientTransport({
      command: this.options.command,
      args: this.options.args ?? [],
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env: definedEnvironment(this.options.env ?? process.env),
      stderr: "pipe",
      maxBufferSize: this.options.maxBufferBytes ?? 1024 * 1024
    });
    const stderr = transport.stderr;
    stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrBytes += Buffer.byteLength(chunk);
      if (this.stderrBytes <= (this.options.maxStderrBytes ?? 64 * 1024)) {
        return;
      }
      if (!this.fatalError) {
        this.fatalError = new DownstreamMcpClientError(
          "DOWNSTREAM_MCP_PROTOCOL_ERROR",
          "Downstream MCP stderr exceeded the configured limit"
        );
      }
      void transport.close().catch(() => undefined);
    });

    this.transport = transport;
    this.sdkClient = new Client(
      { name: "chatcockpit-downstream-mcp", version: "0.1.0-alpha" },
      { versionNegotiation: { mode: "legacy" } }
    );
  }

  private installTransportErrorBridge(transport: StdioClientTransport): void {
    const sdkErrorHandler = transport.onerror;
    transport.onerror = (error) => {
      if (!this.fatalError) {
        this.fatalError = new DownstreamMcpClientError(
          "DOWNSTREAM_MCP_PROTOCOL_ERROR",
          "Downstream MCP transport reported a protocol error"
        );
      }
      sdkErrorHandler?.(error);
      void transport.close().catch(() => undefined);
    };
  }

  private async withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    promise.catch(() => undefined);
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new DownstreamMcpClientError(
            "DOWNSTREAM_MCP_TIMEOUT",
            `Downstream MCP ${operation} request timed out`
          )
        );
      }, this.timeoutMs);
      timer.unref();
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private mapError(
    error: unknown,
    operation: "initialize" | "tools/list" | "tools/call"
  ): DownstreamMcpClientError {
    if (error instanceof DownstreamMcpClientError) return error;
    if (this.fatalError) return this.fatalError;

    const code = sdkErrorCode(error);
    if (code === SdkErrorCode.RequestTimeout) {
      return new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_TIMEOUT",
        `Downstream MCP ${operation} request timed out`
      );
    }
    if (code === SdkErrorCode.InvalidResult) {
      return new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_RESPONSE_INVALID",
        `Downstream MCP ${operation} result failed protocol validation`
      );
    }
    if (
      code === SdkErrorCode.ConnectionClosed ||
      code === SdkErrorCode.NotConnected
    ) {
      return new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_DISCONNECTED",
        "Downstream MCP process disconnected"
      );
    }
    if (
      code === "ENOENT" ||
      (error instanceof Error && /spawn .*ENOENT/i.test(error.message))
    ) {
      return new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_START_FAILED",
        "Downstream MCP process could not be started"
      );
    }
    if (error instanceof ProtocolError) {
      return new DownstreamMcpClientError(
        "DOWNSTREAM_MCP_PROTOCOL_ERROR",
        "Downstream MCP returned a protocol error"
      );
    }

    return new DownstreamMcpClientError(
      operation === "initialize"
        ? "DOWNSTREAM_MCP_START_FAILED"
        : "DOWNSTREAM_MCP_PROTOCOL_ERROR",
      operation === "initialize"
        ? "Downstream MCP process could not be initialized"
        : "Downstream MCP request failed protocol validation"
    );
  }
}
