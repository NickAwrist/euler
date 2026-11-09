import crypto from "node:crypto";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { withoutImageData } from "../db/agents";
import {
  createSessionRow,
  deleteSessionRow,
  findWorkspaceUser,
  getMessagesForSession,
  listSessionSummaries,
  patchSessionRow,
} from "../db/index";
import { markSessionViewed } from "../db/sessions";
import type { SessionRow } from "../db/types";
import type { SessionService } from "../gen/euler/v1/sessions_pb";
import { SessionSummary_Badge } from "../gen/euler/v1/sessions_pb";
import { stripReasoningFromModelMessages } from "../llm/reasoningDetails";
import { OperationError } from "../observability/errors";
import { deleteSession, ephemeralExpiry } from "../sessions/lifecycle";
import { workspaceService } from "../workspaces/WorkspaceService";
import { ownedSession, ownerOf } from "./context";
import { message, millis, optionalMillis } from "./wire";

/** The chat's workspace as clients see it. */
export function sessionWorkspace(row: SessionRow) {
  const workspaceId = row.linked_workspace_id;
  const workspace = workspaceService.presentation(
    row,
    workspaceId && findWorkspaceUser(row.owner_uuid, workspaceId, row.id),
  );
  return workspace.kind === "local"
    ? {
        kind: {
          case: "local" as const,
          value: { path: workspace.path, label: workspace.label },
        },
      }
    : {
        kind: {
          case: "sandbox" as const,
          value: {
            linked: workspace.linked && {
              workspaceId: workspace.linked.workspaceId,
              sessionId: workspace.linked.sessionId ?? undefined,
            },
          },
        },
      };
}

export const sessionService: ServiceImpl<typeof SessionService> = {
  listSessions(_request, context) {
    const owner = ownerOf(context);
    const working = agentRuntime.store.sessionsWithStatus(owner, [
      "queued",
      "running",
    ]);
    return {
      sessions: listSessionSummaries(owner)
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((row) => ({
          id: row.id,
          createdAt: millis(row.created_at),
          updatedAt: millis(row.updated_at),
          customTitle: row.title ?? undefined,
          preview: row.preview,
          badge: working.has(row.id)
            ? SessionSummary_Badge.WORKING
            : row.unread
              ? SessionSummary_Badge.UNREAD
              : SessionSummary_Badge.UNSPECIFIED,
          expiresAt: optionalMillis(row.expires_at),
        })),
    };
  },
  getSession(request, context) {
    const row = ownedSession(context, request.id);
    const { owner_uuid: owner, id } = row;
    return {
      session: {
        id,
        createdAt: millis(row.created_at),
        updatedAt: millis(row.updated_at),
        customTitle: row.title ?? undefined,
        history: getMessagesForSession(owner, id).map(message),
        modelMessages: stripReasoningFromModelMessages(
          agentRuntime.main(owner, id).history.map(withoutImageData),
        ) as JsonObject[],
        model: row.model ?? undefined,
        workspace: sessionWorkspace(row),
        expiresAt: optionalMillis(row.expires_at),
      },
    };
  },
  async createSession(request, context) {
    const owner = ownerOf(context);
    const id = crypto.randomUUID();
    const now = Date.now();
    const model = request.model?.trim() || null;
    const expiresAt = request.ephemeral ? ephemeralExpiry(now) : null;
    createSessionRow(owner, id, now, model, expiresAt);
    try {
      await workspaceService.provisionRetained(owner, id);
    } catch (error) {
      deleteSessionRow(owner, id);
      throw error;
    }
    agentRuntime.main(owner, id);
    return { id, createdAt: millis(now), expiresAt: optionalMillis(expiresAt) };
  },
  updateSession(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.id);
    const patch: Parameters<typeof patchSessionRow>[2] = {
      updated_at: Date.now(),
    };
    if (request.customTitle !== undefined)
      patch.title = request.customTitle.trim() || null;
    if (request.model !== undefined) patch.model = request.model.trim() || null;
    patchSessionRow(owner, id, patch);
    return {};
  },
  async deleteSession(request, context) {
    if (!(await deleteSession(ownedSession(context, request.id))))
      throw new OperationError("NOT_FOUND", { message: "Session not found" });
    return {};
  },
  markViewed(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.id);
    markSessionViewed(owner, id);
    return {};
  },
};
