import type { Response } from "express";
import type { ZodError } from "zod";
import { sendApiError } from "./errors";

export function formatZodError(error: ZodError): string {
  return error.issues[0]?.message ?? "Invalid request body";
}

export function sendValidationError(
  res: Response,
  error: ZodError,
  message?: string,
): void {
  sendApiError(
    res,
    400,
    "VALIDATION_ERROR",
    message ?? formatZodError(error),
    error.flatten(),
  );
}
