export interface ServiceErrorOptions {
  hint?: string;
  details?: unknown;
  cause?: unknown;
}

export class ServiceError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;
  readonly cause?: unknown;

  constructor(code: string, message: string, options?: ServiceErrorOptions) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.hint = options?.hint;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}

export function wrapServiceOperationError(
  code: string,
  error: unknown,
  message: string,
  hint?: string
): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }
  return new ServiceError(code, message, {
    ...(hint ? { hint } : {}),
    cause: error
  });
}
