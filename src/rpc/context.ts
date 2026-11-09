import { type HandlerContext, createContextKey } from "@connectrpc/connect";
import { getSessionById } from "../db/sessions";
import type { SessionRow } from "../db/types";
import { OperationError } from "../observability/errors";
import { USER_ID_HEADER } from "../userIdentity";

export const ownerKey = createContextKey<string | undefined>(undefined, {
  description: `The validated ${USER_ID_HEADER} header`,
});

/** The socket address the request came from, before any proxy. */
export const remoteAddressKey = createContextKey<string>("", {
  description: "The request's socket address",
});

/** The X-Forwarded-For header a proxy added, if any. */
export const forwardedForKey = createContextKey<string | undefined>(undefined, {
  description: "The request's X-Forwarded-For header",
});

/** The caller's user ID, for RPCs on user-owned data. */
export function ownerOf(context: HandlerContext): string {
  const owner = context.values.get(ownerKey);
  if (!owner)
    throw new OperationError("INVALID_REQUEST", {
      message: `A valid ${USER_ID_HEADER} header is required`,
    });
  return owner;
}

/** The caller's chat, or NOT_FOUND when it is missing or someone else's. */
export function ownedSession(
  context: HandlerContext,
  sessionId: string,
): SessionRow {
  const session = getSessionById(ownerOf(context), sessionId);
  if (!session)
    throw new OperationError("NOT_FOUND", { message: "Session not found" });
  return session;
}
