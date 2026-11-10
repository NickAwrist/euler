import { basename } from "node:path";
import type { HandlerContext, ServiceImpl } from "@connectrpc/connect";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import {
  appendSessionEvent,
  getSessionById,
  patchSessionRow,
} from "../db/index";
import type { SessionRow } from "../db/types";
import {
  ArtifactEntry_Kind,
  type WorkspaceService,
} from "../gen/euler/v1/workspace_pb";
import { isLoopbackRequest } from "../http/isLoopbackRequest";
import { revealFileNative } from "../nativeFolderPicker";
import { OperationError } from "../observability/errors";
import { releaseWorkspace } from "../sessions/lifecycle";
import { workspaceService as workspaces } from "../workspaces/WorkspaceService";
import {
  listArtifactDirectory,
  readArtifactPreview,
} from "../workspaces/artifacts";
import { forwardedForKey, ownedSession, remoteAddressKey } from "./context";
import { sessionWorkspace } from "./sessions";
import { millis } from "./wire";

const CHUNK_BYTES = 64 * 1024;

/** The chat's current row when it still exists and is idle. */
function idleSession(context: HandlerContext, sessionId: string): SessionRow {
  const loaded = ownedSession(context, sessionId);
  const row = getSessionById(loaded.owner_uuid, loaded.id);
  if (!row)
    throw new OperationError("NOT_FOUND", { message: "Session not found" });
  if (agentRuntime.busy(row.owner_uuid, row.id))
    throw new OperationError("CONFLICT", {
      message: "Wait for the current turn to finish before changing workspaces",
    });
  return row;
}

export const workspaceService: ServiceImpl<typeof WorkspaceService> = {
  async selectDirectory(request, context) {
    idleSession(context, request.sessionId);
    const path = await workspaces.canonicalDirectory(request.path);
    // Re-read after the await: a turn may have started or the link changed.
    const row = idleSession(context, request.sessionId);
    patchSessionRow(row.owner_uuid, row.id, {
      workspace_kind: "local",
      session_directory: path,
      linked_workspace_id: null,
    });
    appendSessionEvent(
      row.owner_uuid,
      row.id,
      `Working directory changed to ${path}`,
    );
    await releaseWorkspace(row.owner_uuid, row.linked_workspace_id);
    return {
      workspace: {
        kind: {
          case: "local",
          value: { path, label: path.split(/[\\/]/).pop() || path },
        },
      },
    };
  },
  async useSandbox(request, context) {
    const row = idleSession(context, request.sessionId);
    await workspaces.provisionRetained(row.owner_uuid, row.id);
    const current = getSessionById(row.owner_uuid, row.id);
    if (current?.workspace_kind === "local" || current?.linked_workspace_id) {
      patchSessionRow(row.owner_uuid, row.id, {
        workspace_kind: "sandbox",
        session_directory: null,
        linked_workspace_id: null,
      });
      appendSessionEvent(
        row.owner_uuid,
        row.id,
        "Returned to the private workspace",
      );
      await releaseWorkspace(row.owner_uuid, current.linked_workspace_id);
    }
    return { workspace: { kind: { case: "sandbox", value: {} } } };
  },
  async linkWorkspace(request, context) {
    const row = idleSession(context, request.sessionId);
    const source = getSessionById(
      row.owner_uuid,
      request.sourceSessionId.trim(),
    );
    if (!source)
      throw new OperationError("NOT_FOUND", { message: "Chat not found" });
    if (source.id === row.id)
      throw new OperationError("INVALID_REQUEST", {
        message: "Choose another chat to link",
      });
    if (source.workspace_kind === "local")
      throw new OperationError("INVALID_REQUEST", {
        message: `That chat works in ${source.session_directory}. Use /directory to choose the same folder.`,
      });
    // Join the source's current sandbox so links never form chains.
    const workspaceId = source.linked_workspace_id ?? source.id;
    const linked = workspaceId === row.id ? null : workspaceId;
    const patch = {
      workspace_kind: "sandbox",
      session_directory: null,
      linked_workspace_id: linked,
    } as const;
    if (
      row.workspace_kind !== "sandbox" ||
      row.linked_workspace_id !== linked
    ) {
      // No await separates reading the source from recording the link.
      patchSessionRow(row.owner_uuid, row.id, patch);
      appendSessionEvent(
        row.owner_uuid,
        row.id,
        linked
          ? "Linked to another chat's workspace"
          : "Returned to the private workspace",
      );
      await releaseWorkspace(row.owner_uuid, row.linked_workspace_id);
    }
    return { workspace: sessionWorkspace({ ...row, ...patch }) };
  },
  async listFiles(request, context) {
    const workspace = await workspaces.resolveSession(
      ownedSession(context, request.sessionId),
    );
    const files = await workspaces.listFiles(workspace);
    const query = request.query?.toLowerCase() ?? "";
    return {
      files: (query
        ? files.filter((file) => file.path.toLowerCase().includes(query))
        : files
      )
        .slice(0, 200)
        .map((file) => ({
          path: file.path,
          name: file.name,
          size: BigInt(file.size),
          modifiedAt: millis(file.modifiedAt),
        })),
    };
  },
  async *downloadFile(request, context) {
    const workspace = await workspaces.resolveSession(
      ownedSession(context, request.sessionId),
    );
    const file = await workspaces.openFile(workspace, request.path);
    try {
      const { size } = await file.stat();
      yield {
        part: {
          case: "info",
          value: {
            name: basename(request.path),
            mediaType: "application/octet-stream",
            size: BigInt(size),
          },
        },
      };
      // Read through the pinned handle so a replaced path cannot be followed.
      for (let offset = 0; offset < size; ) {
        const buffer = new Uint8Array(Math.min(CHUNK_BYTES, size - offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        offset += bytesRead;
        yield {
          part: { case: "chunk", value: buffer.subarray(0, bytesRead) },
        };
        if (context.signal.aborted) return;
      }
    } finally {
      await file.close();
    }
  },
  async revealFile(request, context) {
    if (
      !isLoopbackRequest(
        context.values.get(remoteAddressKey),
        context.values.get(forwardedForKey),
      )
    )
      throw new OperationError("FORBIDDEN", {
        message: "Files can only be revealed on the machine running Euler",
      });
    const row = ownedSession(context, request.sessionId);
    if (row.workspace_kind !== "local")
      throw new OperationError("FORBIDDEN", {
        message: "Only local workspace files can be revealed",
      });
    const workspace = await workspaces.resolveSession(row);
    await revealFileNative(
      await workspaces.resolveExistingPath(workspace, request.path.trim()),
    );
    return {};
  },
  async listArtifacts(request, context) {
    const workspace = await workspaces.resolveSession(
      ownedSession(context, request.sessionId),
    );
    const entries = await listArtifactDirectory(
      workspaces,
      workspace,
      request.path || ".",
    );
    return {
      entries: entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        kind:
          entry.kind === "directory"
            ? ArtifactEntry_Kind.DIRECTORY
            : ArtifactEntry_Kind.FILE,
      })),
    };
  },
  async previewArtifact(request, context) {
    const workspace = await workspaces.resolveSession(
      ownedSession(context, request.sessionId),
    );
    const preview = await readArtifactPreview(
      workspaces,
      workspace,
      request.path,
    );
    return {
      preview: {
        path: preview.path,
        content:
          preview.kind === "text"
            ? { case: "text", value: preview.content }
            : {
                case: "image",
                value: {
                  mediaType: preview.mediaType,
                  data: preview.data,
                },
              },
      },
    };
  },
};
