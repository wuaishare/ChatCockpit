import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/core";
import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  type Transport
} from "@modelcontextprotocol/client";

import type {
  DownstreamMcpClient,
  DownstreamMcpListToolsResult,
  DownstreamMcpServerIdentity
} from "./downstream-mcp-types.js";
import {
  DownstreamMcpClientError,
  type DownstreamMcpClientErrorCode
} from "./downstream-mcp-client-error.js";

export abstract class DownstreamMcpSdkClient implements DownstreamMcpClient {
  protected sdkClient: Client | null = null;
  protected transport: Transport | null = null;
  protected identity: DownstreamMcpServerIdentity | null = null;
  protected fatalError: DownstreamMcpClientError | null = null;

  constructor(protected readonly timeoutMs: number) {}

  protected abstract createTransport(): Transport;

  protected afterTransportCreated(_transport: Transport): void {}

  protected afterConnected(_transport: Transport): void {}

  async initialize(): Promise<DownstreamMcpServerIdentity> {
    if (this.identity && this.sdkClient && this.transport) {
      return { ...this.identity };
    }
    if (!this.sdkClient || !this.transport) {
      this.fatalError = null;
      this.transport = this.createTransport();
      this.afterTransportCreated(this.transport);
      this.sdkClient = new Client(
        { name: "chatcockpit-downstream-mcp", version: "0.1.0-alpha" },
        { versionNegotiation: { mode: "legacy" } }
      );
    }

    try {
      await this.withTimeout(
        this.sdkClient.connect(this.transport),
        "initialize"
      );
    } catch (error) {
      throw this.mapError(error, "initialize");
    }
    this.installTransportErrorBridge(this.transport);
    this.afterConnected(this.transport);

    const server = this.sdkClient.getServerVersion();
    const protocolVersion = this.sdkClient.getNegotiatedProtocolVersion();
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
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: structuredClone(tool.inputSchema) as Record<string, unknown>,
          ...(tool.outputSchema
            ? {
                outputSchema: structuredClone(tool.outputSchema) as Record<
                  string,
                  unknown
                >
              }
            : {}),
          ...(tool.annotations
            ? {
                annotations: structuredClone(tool.annotations) as Record<
                  string,
                  unknown
                >
              }
            : {})
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

    if (client) {
      try {
        await client.close();
        return;
      } catch {
        // Fall through to the owned transport so an SDK-level close error does
        // not leave an underlying connection or child process alive.
      }
    }
    if (transport) {
      await transport.close().catch(() => undefined);
    }
  }

  protected setFatalError(
    code: DownstreamMcpClientErrorCode,
    message: string
  ): void {
    if (!this.fatalError) {
      this.fatalError = new DownstreamMcpClientError(code, message);
    }
  }

  private installTransportErrorBridge(transport: Transport): void {
    const sdkErrorHandler = transport.onerror;
    transport.onerror = (error) => {
      this.setFatalError(
        "DOWNSTREAM_MCP_PROTOCOL_ERROR",
        "Downstream MCP transport reported a protocol error"
      );
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
        "Downstream MCP transport disconnected"
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
        ? "Downstream MCP transport could not be initialized"
        : "Downstream MCP request failed protocol validation"
    );
  }
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
