import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { pathToString } from "@bufbuild/protobuf/reflect";
import { createValidator } from "@bufbuild/protovalidate";
import type { Interceptor } from "@connectrpc/connect";
import { ensureUserData } from "../db/index";
import { OperationError } from "../observability/errors";
import { USER_ID_HEADER, normalizeUserId } from "../userIdentity";
import { ownerKey } from "./context";
import { toConnectError } from "./errors";

/** Validates the user header when present and exposes the owner to handlers. */
export const userIdentity: Interceptor = (next) => (request) => {
  const header = request.header.get(USER_ID_HEADER);
  if (header !== null) {
    const owner = normalizeUserId(header);
    if (!owner)
      throw new OperationError("INVALID_REQUEST", {
        message: `A valid ${USER_ID_HEADER} header is required`,
      });
    ensureUserData(owner);
    request.contextValues.set(ownerKey, owner);
  }
  return next(request);
};

const validator = createValidator();

function validate<T extends DescMessage>(schema: T, message: MessageShape<T>) {
  const result = validator.validate(schema, message);
  if (result.kind === "valid") return;
  if (result.kind === "error") throw result.error;
  const [violation] = result.violations;
  const field = violation?.field.length ? pathToString(violation.field) : "";
  // Rules with "euler." IDs carry a complete message for people.
  const custom = violation?.ruleId.startsWith("euler.");
  throw new OperationError("INVALID_REQUEST", {
    message:
      field && !custom
        ? `${field}: ${violation?.message}`
        : (violation?.message ?? "Invalid request"),
  });
}

/** Enforces the buf.validate rules declared on each request message. */
export const validation: Interceptor = (next) => (request) => {
  if (request.stream) {
    const schema = request.method.input;
    const messages = request.message;
    return next({
      ...request,
      message: (async function* () {
        for await (const message of messages) {
          validate(schema, message);
          yield message;
        }
      })(),
    });
  }
  validate(request.method.input, request.message);
  return next(request);
};

async function* mappingErrors<T>(
  messages: AsyncIterable<T>,
  procedure: string,
) {
  try {
    yield* messages;
  } catch (error) {
    throw toConnectError(error, procedure);
  }
}

/** Turns handler failures, including ones raised mid-stream, into Connect errors. */
export const errorMapping: Interceptor = (next) => async (request) => {
  const procedure = `${request.service.typeName}/${request.method.name}`;
  try {
    const response = await next(request);
    if (!response.stream) return response;
    return { ...response, message: mappingErrors(response.message, procedure) };
  } catch (error) {
    throw toConnectError(error, procedure);
  }
};
