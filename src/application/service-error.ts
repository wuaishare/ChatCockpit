export interface ServiceErrorOptions {
  hint?: string;
  details?: unknown;
}

export class ServiceError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: string, message: string, options?: ServiceErrorOptions) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.hint = options?.hint;
    this.details = options?.details;
  }
}
