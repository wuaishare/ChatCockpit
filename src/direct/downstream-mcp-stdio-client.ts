import {
  StdioClientTransport,
  type StdioServerParameters
} from "@modelcontextprotocol/client/stdio";
import type { Transport } from "@modelcontextprotocol/client";

import { DownstreamMcpSdkClient } from "./downstream-mcp-sdk-client.js";

export { DownstreamMcpClientError } from "./downstream-mcp-client-error.js";
export type { DownstreamMcpClientErrorCode } from "./downstream-mcp-client-error.js";

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

export class DownstreamMcpStdioClient extends DownstreamMcpSdkClient {
  private stdioTransport: StdioClientTransport | null = null;
  private stderrBytes = 0;

  constructor(private readonly options: DownstreamMcpStdioClientOptions) {
    super(options.timeoutMs ?? 10_000);
  }

  get pid(): number | null {
    return this.stdioTransport?.pid ?? null;
  }

  override async close(): Promise<void> {
    await super.close();
    this.stdioTransport = null;
    this.stderrBytes = 0;
  }

  protected createTransport(): Transport {
    this.stderrBytes = 0;
    const parameters: StdioServerParameters = {
      command: this.options.command,
      args: this.options.args ?? [],
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env: definedEnvironment(this.options.env ?? process.env),
      stderr: "pipe",
      maxBufferSize: this.options.maxBufferBytes ?? 1024 * 1024
    };
    const transport = new StdioClientTransport(parameters);
    this.stdioTransport = transport;
    const stderr = transport.stderr;
    stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrBytes += Buffer.byteLength(chunk);
      if (this.stderrBytes <= (this.options.maxStderrBytes ?? 64 * 1024)) {
        return;
      }
      this.setFatalError(
        "DOWNSTREAM_MCP_PROTOCOL_ERROR",
        "Downstream MCP stderr exceeded the configured limit"
      );
      void transport.close().catch(() => undefined);
    });
    return transport;
  }
}
