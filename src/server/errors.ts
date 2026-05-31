import { z } from "zod";
import type { FastifyReply } from "fastify";

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  statusCode: number;
  code: string;
  hint?: string;
  details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: { hint?: string; details?: unknown }
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.hint = options?.hint;
    this.details = options?.details;
  }
}

export function validationError(error: z.ZodError): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
    details: error.flatten()
  });
}

export function apiErrorBody(
  code: string,
  message: string,
  options?: { hint?: string; details?: unknown }
): ApiErrorBody {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(options?.hint ? { hint: options.hint } : {}),
      ...(options?.details !== undefined ? { details: options.details } : {})
    }
  };
}

export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  options?: { hint?: string; details?: unknown }
): ApiErrorBody {
  reply.code(statusCode);
  return apiErrorBody(code, message, options);
}

export function sendUnknownApiError(reply: FastifyReply, error: unknown): ApiErrorBody {
  if (error instanceof ApiError) {
    return sendApiError(reply, error.statusCode, error.code, error.message, {
      hint: error.hint,
      details: error.details
    });
  }

  return sendApiError(
    reply,
    500,
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : String(error)
  );
}
