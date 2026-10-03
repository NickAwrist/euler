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

/** A short error message safe to show in model/tool output. */
export function toolErrorToString(err: unknown, sessionDir?: string): string {
  const msg = redactPaths(errorMessage(err), sessionDir);
  return msg.length > 2000 ? `${msg.slice(0, 2000)}...` : msg;
}
