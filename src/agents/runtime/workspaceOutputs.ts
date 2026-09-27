import type { WorkspaceFileAttachment } from "../../attachments/types";
import {
  type Workspace,
  workspaceService,
} from "../../workspaces/WorkspaceService";
export async function snapshotWorkspace(
  workspace: Workspace,
): Promise<Map<string, string>> {
  try {
    return new Map(
      (await workspaceService.listFiles(workspace)).map((file) => [
        file.path,
        `${file.size}:${file.modifiedAt}`,
      ]),
    );
  } catch {
    return new Map();
  }
}
export async function changedWorkspaceFiles(
  workspace: Workspace,
  before: Map<string, string>,
  sessionId: string,
  temporary: boolean,
): Promise<WorkspaceFileAttachment[]> {
  try {
    return (await workspaceService.listFiles(workspace))
      .filter(
        (file) => before.get(file.path) !== `${file.size}:${file.modifiedAt}`,
      )
      .map((file) => ({
        id: crypto.randomUUID(),
        kind: "file",
        name: file.name,
        path: file.path,
        size: file.size,
        sessionId,
        workspaceKind: workspace.kind,
        temporary,
      }));
  } catch {
    return [];
  }
}
