import { ERROR_MESSAGES, type ErrorCode } from "../schemas/observability";

/**
 * A known failure. Its message is safe to show; a specific message, such as a
 * validation rule, replaces the code's shared message.
 */
export class OperationError extends Error {
  constructor(
    readonly code: ErrorCode,
    options?: ErrorOptions & { message?: string },
  ) {
    super(options?.message ?? ERROR_MESSAGES[code], options);
    this.name = "OperationError";
  }
}
