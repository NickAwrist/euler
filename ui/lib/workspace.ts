import { create } from "@bufbuild/protobuf";
import { WorkspaceFileAttachment_WorkspaceKind } from "../../src/gen/euler/v1/attachments_pb";
import {
  type SessionWorkspace,
  SessionWorkspaceSchema,
} from "../../src/gen/euler/v1/sessions_pb";

/** Which kind of workspace a chat uses: its sandbox or a local folder. */
export type WorkspaceKind = NonNullable<SessionWorkspace["kind"]["case"]>;

/** A chat's own sandbox, the workspace a new chat starts in. */
export const sandboxWorkspace = (): SessionWorkspace =>
  create(SessionWorkspaceSchema, { kind: { case: "sandbox", value: {} } });

export function workspaceKind(workspace: SessionWorkspace): WorkspaceKind {
  return workspace.kind.case ?? "sandbox";
}

/** The server folder a chat works in, when it uses one. */
export function localWorkspace(workspace: SessionWorkspace) {
  return workspace.kind.case === "local" ? workspace.kind.value : undefined;
}

/** The other chat's sandbox this chat shares, when linked. */
export function linkedWorkspace(workspace: SessionWorkspace) {
  return workspace.kind.case === "sandbox"
    ? workspace.kind.value.linked
    : undefined;
}

export function fileWorkspaceKind(
  kind: WorkspaceFileAttachment_WorkspaceKind,
): WorkspaceKind {
  return kind === WorkspaceFileAttachment_WorkspaceKind.LOCAL
    ? "local"
    : "sandbox";
}
