import { z } from "zod";
import type { FastifyReply } from "fastify";

import { ServiceError } from "../application/service-error.js";

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

const serviceErrorStatusCodes: Readonly<Record<string, number>> = {
  VALIDATION_ERROR: 400,
  AUTH_REQUIRED: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONTINUITY_RECORD_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  ARTIFACT_NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  LEASE_CONFLICT: 409,
  WRITER_LEASE_REQUIRED: 409,
  WRITER_LEASE_CONFLICT: 409,
  HANDOFF_READY_CONFLICT: 409,
  TASK_REVIEW_BLOCKED: 409,
  TASK_COMPLETION_BLOCKED: 409,
  TASK_EXECUTION_POLICY_BLOCKED: 409,
  CONTINUITY_RELATION_INVALID: 409,
  RUNTIME_BINDING_CONFLICT: 409,
  RUNTIME_BINDING_REQUIRED: 409,
  RUNTIME_RUN_CONFLICT: 409,
  RUNTIME_WORKSPACE_MISMATCH: 409,
  CODEX_SERVER_REQUEST_UNAVAILABLE: 409,
  DIRECT_EXECUTOR_NOT_FOUND: 404,
  DIRECT_EXECUTOR_UNAVAILABLE: 503,
  DIRECT_EXECUTOR_UNSUPPORTED: 409,
  DIRECT_CAPABILITY_UNAVAILABLE: 501,
  HOST_ROOT_NOT_CONFIGURED: 404,
  HOST_ROOT_ACCESS_DENIED: 403,
  HOST_PATH_BLOCKED: 403,
  HOST_FILE_NOT_FOUND: 404,
  HOST_FILE_UNSUPPORTED: 415,
  HOST_FILE_TOO_LARGE: 413,
  HOST_EXECUTOR_UNSUPPORTED: 409,
  HOST_EXECUTION_RESPONSE_INVALID: 502,
  HOST_EXECUTION_FAILED: 502,
  DOWNSTREAM_EXECUTOR_NOT_CONFIGURED: 409,
  DOWNSTREAM_SNAPSHOT_UNAVAILABLE: 503,
  DOWNSTREAM_MAPPING_UNAVAILABLE: 409,
  DOWNSTREAM_EXECUTION_FAILED: 502,
  CAPABILITY_UNAVAILABLE: 501,
  CODEX_BINARY_UNAVAILABLE: 503,
  CODEX_APP_SERVER_UNAVAILABLE: 503,
  CODEX_APP_SERVER_START_FAILED: 503,
  CODEX_APP_SERVER_DISCONNECTED: 503,
  CODEX_APP_SERVER_TIMEOUT: 504,
  CODEX_APP_SERVER_RPC_ERROR: 502,
  CODEX_THREAD_RESPONSE_INVALID: 502,
  CODEX_TURN_RESPONSE_INVALID: 502,
  GIT_RECENT_COMMITS_FAILED: 500
};

export function toApiError(error: ServiceError): ApiError {
  return new ApiError(
    serviceErrorStatusCodes[error.code] ?? 400,
    error.code,
    error.message,
    {
      hint: error.hint,
      details: error.details
    }
  );
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

const INTERNAL_ERROR_MESSAGE =
  "Unexpected TokenPilot error. Check local server logs with the request ID.";

function requestIdFromReply(reply: FastifyReply): string {
  return String(reply.request.id);
}

export function sendUnknownApiError(reply: FastifyReply, error: unknown): ApiErrorBody {
  const requestId = requestIdFromReply(reply);
  if (error instanceof ServiceError && error.cause !== undefined) {
    reply.request.log.warn(
      { err: error.cause, requestId, code: error.code },
      "TokenPilot service operation failed"
    );
  }

  const apiError =
    error instanceof ApiError
      ? error
      : error instanceof ServiceError
        ? toApiError(error)
        : null;

  if (apiError) {
    return sendApiError(reply, apiError.statusCode, apiError.code, apiError.message, {
      hint: apiError.hint,
      details: apiError.details
    });
  }

  reply.request.log.error(
    { err: error, requestId },
    "Unhandled TokenPilot request error"
  );
  return sendApiError(reply, 500, "INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE, {
    details: { requestId }
  });
}
