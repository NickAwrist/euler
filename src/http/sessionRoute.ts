import type { NextFunction, Request, Response } from "express";
import { getSessionById } from "../db/sessions";
import type { SessionRow } from "../db/types";
import { sendError } from "../observability/http";
import { requireUserId } from "../userIdentity";

const sessions = new WeakMap<Request, SessionRow>();

/** Loads the requesting user's chat named by `:id`, or responds that it is missing. */
export function loadSession(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): void {
  const owner = requireUserId(req, res);
  if (!owner) return;
  const session = getSessionById(owner, req.params.id);
  if (!session) {
    sendError(res, "NOT_FOUND", "Session not found");
    return;
  }
  sessions.set(req, session);
  next();
}

/** The chat `loadSession` loaded for this request, as it was when loaded. */
export function requestSession(req: Request): SessionRow {
  const session = sessions.get(req);
  if (!session) throw new Error("loadSession must run before this route");
  return session;
}
