import type { Request, Response } from "express";
import { ensureUserData } from "./db/index";
import { sendApiError } from "./http/errors";

export const USER_ID_HEADER = "x-euler-user-id";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function requireUserId(req: Request, res: Response): string | null {
  const ownerUuid = normalizeUserId(req.get(USER_ID_HEADER));
  if (!ownerUuid) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      `A valid ${USER_ID_HEADER} header is required`,
    );
    return null;
  }
  ensureUserData(ownerUuid);
  return ownerUuid;
}
