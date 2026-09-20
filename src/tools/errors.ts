import { logger } from "../logger";
import { errorMessage } from "../utils/errors";

function redactPaths(msg: string, sessionDir?: string): string {
  const root = sessionDir?.trim();
  if (!root || root.length < 4) return msg;
  let out = msg;
  const norm = root.replace(/\\/g, "/");
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(escaped, "gi"), "[session]/");
  out = out.replace(
    new RegExp(norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    "[session]/",
  );
  return out;
}

/**
 * Log the full error server-side and return a short message safe to show in model/tool output.
 */
export function toolErrorToString(
  err: unknown,
  context?: string,
  sessionDir?: string,
): string {
  const raw = errorMessage(err);
  if (context) {
    logger.error({ err, context }, "tool error");
  } else {
    logger.error({ err }, "tool error");
  }
  const msg = redactPaths(raw, sessionDir);
  return msg.length > 2000 ? `${msg.slice(0, 2000)}...` : msg;
}
