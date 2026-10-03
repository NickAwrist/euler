import { AsyncLocalStorage } from "node:async_hooks";
import { ERROR_MESSAGES, isErrorCode } from "../schemas/observability";

interface LogContext {
  requestId?: string;
  sessionId?: string;
  agentId?: string;
  activationId?: string;
  jobId?: string;
}
type LogFields = LogContext & {
  stage?: string;
  tool?: string;
  model?: string;
  label?: string;
  code?: string;
  status?: number | string;
  method?: string;
  route?: string;
  port?: number;
  host?: string;
  count?: number;
  turnIndex?: number;
  durationMs?: number;
  queueWaitMs?: number;
  outcome?: "success" | "failure" | "done" | "aborted" | "error" | "paused";
  /** A failure message already shown to the user or model. */
  reason?: string;
};
type LogLevel = "info" | "warn" | "error";

const context = new AsyncLocalStorage<LogContext>();

// Fixed descriptions keep paths, SQL, and provider payloads out of logs.
const SYSTEM_MESSAGES: Readonly<Record<string, string>> = {
  ENOSPC: "No space left on device.",
  EACCES: "Permission denied.",
  EPERM: "Operation not permitted.",
  ENOENT: "File or directory not found.",
  ECONNREFUSED: "Connection refused.",
  ECONNRESET: "Connection reset.",
  ETIMEDOUT: "Connection timed out.",
  SQLITE_BUSY: "The database is busy.",
  SQLITE_READONLY: "The database is read-only.",
  SQLITE_FULL: "The database or disk is full.",
};

interface LoggedError {
  name: string;
  code?: string;
  message?: string;
  stack?: string;
  cause?: LoggedError;
}

/** Retain known reasons and causal call sites without serializing messages. */
export function serializeError(
  error: unknown,
  depth = 0,
): LoggedError | undefined {
  if (!(error instanceof Error)) return undefined;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  return {
    name: error.name,
    code,
    message: isErrorCode(code)
      ? ERROR_MESSAGES[code]
      : code
        ? SYSTEM_MESSAGES[code]
        : undefined,
    stack: error.stack
      ?.split("\n")
      .filter((line) => /^\s+at /.test(line))
      .join("\n"),
    ...(error.cause && depth < 4
      ? { cause: serializeError(error.cause, depth + 1) }
      : {}),
  };
}

export function currentRequestId(): string | undefined {
  return context.getStore()?.requestId;
}

/** Adds identifiers to every event logged while `run` executes. */
export function withLogContext<T>(fields: LogContext, run: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, run);
}

/** Starts background work without inheriting the request that scheduled it. */
export function withBackgroundLogContext<T>(
  fields: Omit<LogContext, "requestId">,
  run: () => T,
): T {
  return context.run(fields, run);
}

function enabled(level: LogLevel): boolean {
  const configured = process.env.LOG_LEVEL ?? "info";
  return !(
    configured === "silent" ||
    (configured === "error" && level !== "error") ||
    (configured === "warn" && level === "info")
  );
}

/** Writes one JSON object per line with a stable event name. */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  error?: unknown,
): void {
  if (!enabled(level)) return;
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context.getStore(),
    ...fields,
    ...(fields.reason ? { reason: fields.reason.slice(0, 1000) } : {}),
    ...(isErrorCode(fields.code)
      ? { message: ERROR_MESSAGES[fields.code] }
      : {}),
    ...(error === undefined ? {} : { error: serializeError(error) }),
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}

/** Measures a stage, records its outcome, and rethrows failures unchanged. */
export async function observe<T>(
  stage: string,
  run: () => Promise<T>,
  fields: LogFields = {},
): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    logEvent("info", "operation.finished", {
      ...fields,
      stage,
      durationMs: Math.round(performance.now() - started),
      outcome: "success",
    });
    return value;
  } catch (error) {
    logEvent("warn", "operation.finished", {
      ...fields,
      stage,
      durationMs: Math.round(performance.now() - started),
      outcome: "failure",
    });
    throw error;
  }
}
