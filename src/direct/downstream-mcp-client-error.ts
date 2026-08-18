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
