import { basename, relative } from "node:path";
import type { WorkspaceFileAttachment } from "../../attachments/types";
import {
  type Workspace,
  workspaceService,
} from "../../workspaces/WorkspaceService";

/** Resolve only tool-reported outputs. Concurrent edits are not inferred from timestamps. */
export async function changedWorkspaceFiles(
  workspace: Workspace,
  paths: ReadonlySet<string>,
  sessionId: string,
  temporary: boolean,
): Promise<WorkspaceFileAttachment[]> {
  const files = new Map<string, WorkspaceFileAttachment>();
  for (const requested of paths) {
    try {
      const canonical = await workspaceService.resolveExistingPath(
        workspace,
        requested,
      );
      const path = relative(workspace.hostPath, canonical)
        .split("\\")
        .join("/");
      const stat = await workspaceService.statPath(workspace, path);
      if (!stat.isFile()) continue;
      files.set(path, {
        id: crypto.randomUUID(),
        kind: "file",
        name: basename(path),
        path,
        size: stat.size,
        sessionId,
        workspaceKind: workspace.kind,
        temporary,
      });
    } catch {
      // Deleted or inaccessible outputs cannot be attached.
    }
  }
  return [...files.values()];
}
