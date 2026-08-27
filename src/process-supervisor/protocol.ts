import { z } from "zod";

export const PROCESS_SUPERVISOR_PROTOCOL_VERSION = 1 as const;
export const PROCESS_SUPERVISOR_REQUEST_MAX_BYTES = 32 * 1024;
export const PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES = 96 * 1024;

export const PROCESS_SUPERVISOR_METHODS = [
  "health",
  "owned.list",
  "process.start",
  "process.read",
  "process.input",
  "process.stop",
  "events.list",
  "events.ack",
  "runtime.restart",
  "runtime.restart.read"
] as const;

export type ProcessSupervisorMethod = (typeof PROCESS_SUPERVISOR_METHODS)[number];

const methodSchema = z.enum(PROCESS_SUPERVISOR_METHODS);
const requestSchema = z.object({
  protocolVersion: z.literal(PROCESS_SUPERVISOR_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(160),
  authToken: z.string().min(32).max(256),
  method: methodSchema,
  params: z.unknown()
});

const responseSchema = z.object({
  protocolVersion: z.literal(PROCESS_SUPERVISOR_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(160),
  supervisorGeneration: z.string().min(1).max(160),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string().min(1).max(160),
      message: z.string().min(1).max(1000)
    })
    .optional()
});

export interface ProcessSupervisorRequest {
  protocolVersion: 1;
  requestId: string;
  authToken: string;
  method: ProcessSupervisorMethod;
  params: unknown;
}

export interface ProcessSupervisorErrorPayload {
  code: string;
  message: string;
}

export interface ProcessSupervisorResponse {
  protocolVersion: 1;
  requestId: string;
  supervisorGeneration: string;
  ok: boolean;
  result?: unknown;
  error?: ProcessSupervisorErrorPayload;
}

function assertFrameSize(value: string, maxBytes: number, kind: "request" | "response"): void {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxBytes) {
    throw new Error(`Process Supervisor ${kind} frame is too large (${bytes} > ${maxBytes} bytes)`);
  }
}

export function isProcessSupervisorMethod(value: string): value is ProcessSupervisorMethod {
  return (PROCESS_SUPERVISOR_METHODS as readonly string[]).includes(value);
}

export function decodeSupervisorRequest(raw: string): ProcessSupervisorRequest {
  assertFrameSize(raw, PROCESS_SUPERVISOR_REQUEST_MAX_BYTES, "request");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Process Supervisor request frame contains invalid JSON");
  }
  const result = requestSchema.safeParse(parsed);
  if (!result.success) {
    const hasUnsupportedProtocol =
      typeof parsed === "object" &&
      parsed !== null &&
      "protocolVersion" in parsed &&
      (parsed as { protocolVersion?: unknown }).protocolVersion !== PROCESS_SUPERVISOR_PROTOCOL_VERSION;
    const hasUnsupportedMethod =
      typeof parsed === "object" &&
      parsed !== null &&
      "method" in parsed &&
      typeof (parsed as { method?: unknown }).method === "string" &&
      !isProcessSupervisorMethod((parsed as { method: string }).method);
    if (hasUnsupportedProtocol) {
      throw new Error("Process Supervisor protocol version is unsupported");
    }
    if (hasUnsupportedMethod) {
      throw new Error("Process Supervisor method is unsupported");
    }
    throw new Error("Process Supervisor request frame failed validation");
  }
  return result.data;
}

export function encodeSupervisorRequest(request: ProcessSupervisorRequest): string {
  const result = requestSchema.safeParse(request);
  if (!result.success) {
    throw new Error("Process Supervisor request failed validation");
  }
  const raw = JSON.stringify(result.data);
  assertFrameSize(raw, PROCESS_SUPERVISOR_REQUEST_MAX_BYTES, "request");
  return `${raw}\n`;
}

export function decodeSupervisorResponse(raw: string): ProcessSupervisorResponse {
  assertFrameSize(raw, PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES, "response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Process Supervisor response frame contains invalid JSON");
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Process Supervisor response frame failed validation");
  }
  if (result.data.ok && result.data.error) {
    throw new Error("Process Supervisor success response must not include an error");
  }
  if (!result.data.ok && !result.data.error) {
    throw new Error("Process Supervisor failure response must include an error");
  }
  return result.data;
}

export function encodeSupervisorResponse(response: ProcessSupervisorResponse): string {
  const result = responseSchema.safeParse(response);
  if (!result.success) {
    throw new Error("Process Supervisor response failed validation");
  }
  if (result.data.ok && result.data.error) {
    throw new Error("Process Supervisor success response must not include an error");
  }
  if (!result.data.ok && !result.data.error) {
    throw new Error("Process Supervisor failure response must include an error");
  }
  const raw = JSON.stringify(result.data);
  assertFrameSize(raw, PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES, "response");
  return `${raw}\n`;
}
