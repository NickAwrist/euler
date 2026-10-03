import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { type ErrorCode, errorDetails } from "../schemas/observability";
import { OperationError } from "./errors";
import { logEvent, withLogContext } from "./logger";

export const REQUEST_ID_HEADER = "X-Request-Id";

const ERROR_STATUS: Record<ErrorCode, number> = {
  INTERNAL_ERROR: 500,
  INVALID_REQUEST: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BODY_TOO_LARGE: 413,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  ENVIRONMENT_MANAGED: 409,
  CATALOG_UNAVAILABLE: 503,
  COMFY_UNREACHABLE: 502,
  COMFY_ASSET_UNAVAILABLE: 502,
  // Background job failures are job state, never a request's response.
  JOB_FAILED: 500,
  JOB_OUTPUT_INVALID: 500,
  JOB_INTERRUPTED: 500,
};

/** Errors that ended a request, kept for its completion log. */
const failures = new WeakMap<Response, unknown>();

/**
 * Sends the standard error envelope. A specific message replaces the code's
 * shared message only for client errors; server errors never expose details.
 */
export function sendError(
  res: Response,
  code: ErrorCode,
  message?: string,
): void {
  const status = ERROR_STATUS[code];
  const requestId = res.getHeader(REQUEST_ID_HEADER);
  const details = errorDetails(code, {
    requestId: typeof requestId === "string" ? requestId : undefined,
  });
  if (message && status < 500) details.message = message;
  res.status(status).json({ error: details });
}

export function sendValidationError(res: Response, error: ZodError): void {
  sendError(res, "INVALID_REQUEST", error.issues[0]?.message);
}

/** Correlates a request's logs and records its completion. */
export function requestObservability(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = crypto.randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  const started = performance.now();
  res.on("close", () => {
    const status = res.statusCode;
    const durationMs = Math.round(performance.now() - started);
    // Keep writes, errors, and slow requests; omit routine polling and reads.
    if (req.method === "GET" && status < 400 && durationMs < 1000) return;
    logEvent(
      status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      "http.finished",
      {
        requestId,
        method: req.method,
        route: req.originalUrl.split("?")[0],
        status,
        durationMs,
      },
      failures.get(res),
    );
  });
  withLogContext({ requestId }, next);
}

function parserStatus(error: unknown): number | undefined {
  return error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : undefined;
}

/** Converts an error that escaped a route into the standard envelope. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  failures.set(res, error);
  if (res.headersSent || res.destroyed) {
    res.destroy();
    return;
  }
  if (error instanceof OperationError) {
    sendError(res, error.code, error.message);
    return;
  }
  // Body parser failures carry a client status.
  const status = parserStatus(error);
  sendError(
    res,
    status === 413
      ? "BODY_TOO_LARGE"
      : status && status < 500
        ? "INVALID_REQUEST"
        : "INTERNAL_ERROR",
  );
}
