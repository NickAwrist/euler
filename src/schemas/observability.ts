import { z } from "zod";

/** Public messages for recurring failures. Never include exception text or provider responses. */
export const ERROR_MESSAGES = {
  INTERNAL_ERROR: "Euler could not complete this request.",
  INVALID_REQUEST: "Check the request and try again.",
  UNSUPPORTED_MEDIA_TYPE: "This file type is not supported.",
  BODY_TOO_LARGE: "Request body too large.",
  NOT_FOUND: "The requested item was not found.",
  FORBIDDEN: "This action is not allowed.",
  CONFLICT: "The request conflicts with the current state. Try again.",
  ENVIRONMENT_MANAGED: "This setting is managed by the environment.",
  CATALOG_UNAVAILABLE:
    "The OpenRouter catalog is unavailable. Try again shortly.",
  COMFY_UNREACHABLE:
    "ComfyUI is unreachable. Check its connection in Settings.",
  COMFY_ASSET_UNAVAILABLE: "ComfyUI could not provide this image.",
  JOB_FAILED: "The background job stopped because of an unexpected error.",
  JOB_OUTPUT_INVALID:
    "The background job produced output that could not be saved.",
  JOB_INTERRUPTED:
    "A server restart interrupted this job. Check the current state before retrying.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

const ERROR_CODES = Object.keys(ERROR_MESSAGES) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return ErrorCodeSchema.safeParse(value).success;
}

/** The public diagnostic. Unrecognized fields are discarded when decoding. */
export const ErrorDetailsSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  requestId: z.string().optional(),
  jobId: z.string().optional(),
});

export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;

export function errorDetails(
  code: ErrorCode,
  context: Omit<Partial<ErrorDetails>, "code" | "message"> = {},
): ErrorDetails {
  return { code, message: ERROR_MESSAGES[code], ...context };
}

export function decodeErrorDetails(value: unknown): ErrorDetails | undefined {
  const parsed = ErrorDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** A failure to display: always a message, with a diagnostic when known. */
export type Diagnostic = Partial<ErrorDetails> & { message: string };

/** One format for displayed and copied diagnostic text. */
export function formatDiagnostic(details: Diagnostic): string {
  return [
    details.message,
    details.code && `Code: ${details.code}`,
    details.requestId && `Request: ${details.requestId}`,
    details.jobId && `Job: ${details.jobId}`,
  ]
    .filter(Boolean)
    .join("\n");
}
