import { Code, type ConnectError } from "@connectrpc/connect";
import {
  ErrorCode,
  type ErrorDetail,
  ErrorDetailSchema,
} from "../../src/gen/euler/v1/common_pb";
import {
  type Diagnostic,
  type ErrorDetails,
  decodeErrorDetails,
  isErrorCode,
} from "../../src/schemas/observability";

/** A failed API request. `message` stays short; codes and IDs stay in `diagnostic`. */
export class ApiError extends Error {
  readonly status: number;
  readonly diagnostic?: ErrorDetails;
  /** The Connect code for a failed RPC. */
  readonly code?: Code;

  constructor(
    message: string,
    status: number,
    diagnostic?: ErrorDetails,
    code?: Code,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.diagnostic = diagnostic;
    this.code = code;
  }
}

export async function createApiError(
  response: Response,
  fallbackMessage?: string,
): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  const diagnostic = decodeErrorDetails(
    body && typeof body === "object" && "error" in body
      ? body.error
      : undefined,
  );
  const requestId = response.headers.get("X-Request-Id");
  if (diagnostic && requestId) diagnostic.requestId = requestId;
  return new ApiError(
    diagnostic?.message ??
      fallbackMessage ??
      (response.statusText || `HTTP ${response.status}`),
    response.status,
    diagnostic,
  );
}

/** A diagnostic the server sent, such as a failed job's, ready to display. */
export function diagnosticFromDetail(
  detail: ErrorDetail,
): ErrorDetails | undefined {
  const name = ErrorCode[detail.code];
  return isErrorCode(name)
    ? {
        code: name,
        message: detail.message,
        ...(detail.requestId ? { requestId: detail.requestId } : {}),
        ...(detail.jobId ? { jobId: detail.jobId } : {}),
      }
    : undefined;
}

/** A failed RPC with the server's public message and Euler diagnostic. */
export function apiErrorFromConnect(error: ConnectError): ApiError {
  const [detail] = error.findDetails(ErrorDetailSchema);
  const diagnostic = detail && diagnosticFromDetail(detail);
  return new ApiError(
    diagnostic?.message ?? (error.rawMessage || Code[error.code]),
    0,
    diagnostic,
    error.code,
  );
}

/** The displayable form of any caught failure. */
export function toDiagnostic(error: unknown): Diagnostic {
  if (error instanceof ApiError && error.diagnostic) return error.diagnostic;
  return { message: error instanceof Error ? error.message : String(error) };
}
