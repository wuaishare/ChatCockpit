import { z } from "zod";

import type { OperationContext } from "../application/operation-context.js";
import { ServiceError } from "../application/service-error.js";

export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface TokenPilotMcpToolResult {
  content: McpTextContent[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

export interface TokenPilotMcpTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  inputSchema: TSchema;
  annotations: McpToolAnnotations;
  execute(context: OperationContext, input: unknown): Promise<TokenPilotMcpToolResult>;
}

interface DefineMcpToolInput<TSchema extends z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  inputSchema: TSchema;
  annotations: McpToolAnnotations;
  handler: (
    context: OperationContext,
    input: z.infer<TSchema>
  ) => unknown | Promise<unknown>;
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function toToolResult(value: unknown): TokenPilotMcpToolResult {
  const structuredContent = toStructuredContent(value);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}

const INTERNAL_TOOL_ERROR_MESSAGE =
  "Unexpected control-plane error. Check local server logs with the request ID.";

function logPrivateToolError(
  context: OperationContext,
  error: unknown,
  code: string
): void {
  const diagnostic =
    error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(
    `[Control Plane MCP] requestId=${context.requestId} code=${code} ${diagnostic}\n`
  );
}

function toToolError(
  context: OperationContext,
  error: unknown
): TokenPilotMcpToolResult {
  if (error instanceof ServiceError && error.cause !== undefined) {
    logPrivateToolError(context, error.cause, error.code);
  } else if (!(error instanceof ServiceError) && !(error instanceof z.ZodError)) {
    logPrivateToolError(context, error, "INTERNAL_ERROR");
  }

  const normalized =
    error instanceof z.ZodError
      ? {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Tool input validation failed",
            details: error.flatten()
          }
        }
      : error instanceof ServiceError
        ? {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              ...(error.hint ? { hint: error.hint } : {}),
              ...(error.details !== undefined ? { details: error.details } : {})
            }
          }
        : {
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: INTERNAL_TOOL_ERROR_MESSAGE,
              details: { requestId: context.requestId }
            }
          };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(normalized, null, 2)
      }
    ],
    structuredContent: normalized,
    isError: true
  };
}

export function defineMcpTool<TSchema extends z.ZodTypeAny>(
  definition: DefineMcpToolInput<TSchema>
): TokenPilotMcpTool<TSchema> {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: definition.annotations,
    async execute(context, input) {
      try {
        const parsed = definition.inputSchema.parse(input);
        return toToolResult(await definition.handler(context, parsed));
      } catch (error) {
        return toToolError(context, error);
      }
    }
  };
}

export const readOnlyToolAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
