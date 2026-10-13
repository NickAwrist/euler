import { z } from "zod";
import type { RunContext } from "../RunContext";
import { type Workspace, WorkspaceError } from "../workspaces/WorkspaceService";

/** Parameter schema for the file a tool reads or changes. */
export const FILE_PATH_PARAMETER = {
  type: "string",
  description:
    "File path (relative to /workspace or absolute under /workspace)",
};
export const FilePathArgs = z.object({ path: z.string().min(1) });

export function requireWorkspace(ctx?: RunContext): Workspace {
  if (!ctx?.workspace) {
    throw new WorkspaceError("No active workspace is available for this tool");
  }
  return ctx.workspace;
}

export function workspaceError(error: unknown): string {
  return error instanceof Error
    ? `Error: ${error.message}`
    : "Error: workspace operation failed";
}
