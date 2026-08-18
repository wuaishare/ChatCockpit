import {
  StreamableHTTPClientTransport,
  type Transport
} from "@modelcontextprotocol/client";

import { DownstreamMcpSdkClient } from "./downstream-mcp-sdk-client.js";

export interface DownstreamMcpStreamableHttpClientOptions {
  url: string;
  timeoutMs?: number;
}

export class DownstreamMcpStreamableHttpClient extends DownstreamMcpSdkClient {
  constructor(private readonly options: DownstreamMcpStreamableHttpClientOptions) {
    super(options.timeoutMs ?? 10_000);
  }

  protected createTransport(): Transport {
    return new StreamableHTTPClientTransport(new URL(this.options.url));
  }
}
