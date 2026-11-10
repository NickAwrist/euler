import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorCode, ErrorDetailSchema } from "../gen/euler/v1/common_pb";
import { OperationError } from "../observability/errors";
import { currentRequestId, logEvent } from "../observability/logger";
import {
  type ErrorCode as EulerErrorCode,
  errorDetails,
} from "../schemas/observability";

const CONNECT_CODES: Record<EulerErrorCode, Code> = {
  INTERNAL_ERROR: Code.Internal,
  INVALID_REQUEST: Code.InvalidArgument,
  UNSUPPORTED_MEDIA_TYPE: Code.InvalidArgument,
  BODY_TOO_LARGE: Code.ResourceExhausted,
  NOT_FOUND: Code.NotFound,
  FORBIDDEN: Code.PermissionDenied,
  CONFLICT: Code.FailedPrecondition,
  ENVIRONMENT_MANAGED: Code.FailedPrecondition,
  CATALOG_UNAVAILABLE: Code.Unavailable,
  COMFY_UNREACHABLE: Code.Unavailable,
  COMFY_ASSET_UNAVAILABLE: Code.Unavailable,
  JOB_FAILED: Code.Internal,
  JOB_OUTPUT_INVALID: Code.Internal,
  JOB_INTERRUPTED: Code.Internal,
};

/** Codes whose specific message is safe to send, as 4xx responses were. */
const CLIENT_CODES: ReadonlySet<Code> = new Set([
  Code.InvalidArgument,
  Code.NotFound,
  Code.PermissionDenied,
  Code.FailedPrecondition,
  Code.ResourceExhausted,
]);

/** The Connect error for a Euler failure, with its diagnostic as a detail. */
export function eulerError(code: EulerErrorCode, message?: string) {
  const connectCode = CONNECT_CODES[code];
  const details = errorDetails(code, { requestId: currentRequestId() });
  if (message && CLIENT_CODES.has(connectCode)) details.message = message;
  return new ConnectError(details.message, connectCode, undefined, [
    {
      desc: ErrorDetailSchema,
      value: create(ErrorDetailSchema, {
        code: ErrorCode[details.code],
        message: details.message,
        requestId: details.requestId,
      }),
    },
  ]);
}

/**
 * Maps a handler failure to a Connect error. Known failures keep their public
 * message; anything unexpected is logged and reported without detail.
 */
export function toConnectError(error: unknown, procedure: string) {
  if (error instanceof OperationError)
    return eulerError(error.code, error.message);
  if (error instanceof ConnectError) {
    // Protocol errors, such as a malformed body or a cancelled stream.
    if (error.code !== Code.Internal && error.code !== Code.Unknown)
      return error;
  }
  logEvent("error", "rpc.failed", { route: procedure }, error);
  return eulerError("INTERNAL_ERROR");
}
