import {
  type Diagnostic,
  type ErrorDetails,
  decodeErrorDetails,
} from "../../src/schemas/observability";

/** A failed API request. `message` stays short; codes and IDs stay in `diagnostic`. */
export class ApiError extends Error {
  readonly status: number;
  readonly diagnostic?: ErrorDetails;

  constructor(message: string, status: number, diagnostic?: ErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.diagnostic = diagnostic;
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

/** The displayable form of any caught failure. */
export function toDiagnostic(error: unknown): Diagnostic {
  if (error instanceof ApiError && error.diagnostic) return error.diagnostic;
  return { message: error instanceof Error ? error.message : String(error) };
}
