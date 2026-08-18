import type { DownstreamMcpExecutorConfig } from "./downstream-mcp-config.js";
import { DownstreamMcpStdioClient } from "./downstream-mcp-stdio-client.js";
import { DownstreamMcpStreamableHttpClient } from "./downstream-mcp-streamable-http-client.js";
import type {
  DownstreamMcpClient,
  DownstreamMcpProtocolFamily
} from "./downstream-mcp-types.js";

export function downstreamMcpProtocolFamily(
  executor: DownstreamMcpExecutorConfig
): DownstreamMcpProtocolFamily {
  return executor.transport.kind === "stdio"
    ? "mcp-legacy-stdio"
    : "mcp-streamable-http";
}

export function createDownstreamMcpClient(
  executor: DownstreamMcpExecutorConfig
): DownstreamMcpClient {
  if (executor.transport.kind === "streamable-http") {
    return new DownstreamMcpStreamableHttpClient({
      url: executor.transport.url,
      timeoutMs: executor.transport.timeoutMs
    });
  }

  return new DownstreamMcpStdioClient({
    command: executor.transport.command,
    args: executor.transport.args,
    ...(executor.transport.cwd ? { cwd: executor.transport.cwd } : {}),
    env: {
      ...process.env,
      ...(executor.transport.env ?? {})
    },
    timeoutMs: executor.transport.timeoutMs,
    maxBufferBytes: executor.transport.maxBufferBytes,
    maxStderrBytes: executor.transport.maxStderrBytes
  });
}
