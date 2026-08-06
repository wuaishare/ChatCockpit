import type { z } from "zod";

import type { OperationContext } from "../application/operation-context.js";
import type {
  McpToolAnnotations,
  TokenPilotMcpTool,
  TokenPilotMcpToolResult
} from "./tool-definition.js";

export interface McpToolRegistrationConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodTypeAny;
  annotations?: McpToolAnnotations;
}

export type McpRegisteredToolHandler = (
  input: unknown,
  sdkContext: unknown
) => Promise<TokenPilotMcpToolResult>;

export interface McpToolRegistrar {
  registerTool(
    name: string,
    config: McpToolRegistrationConfig,
    handler: McpRegisteredToolHandler
  ): unknown;
}

export type McpOperationContextFactory = (
  toolName: string,
  sdkContext: unknown
) => OperationContext;

export function registerMcpTools(
  registrar: McpToolRegistrar,
  tools: TokenPilotMcpTool[],
  contextFactory: McpOperationContextFactory
): void {
  for (const tool of tools) {
    registrar.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      },
      (input, sdkContext) =>
        tool.execute(contextFactory(tool.name, sdkContext), input)
    );
  }
}
