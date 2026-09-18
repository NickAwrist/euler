import type { Response } from "express";
import { buildServerRunPromptContext } from "../agents/agentManager";
import { DEFAULT_RUN_MODEL } from "../constants";
import type { AttachmentRow } from "../db/index";
import {
  type SessionRow,
  getAgentByName,
  getOpenRouterApiKey,
  getSessionAttachments,
  getSessionById,
} from "../db/index";
import { sendApiError } from "../http/errors";
import { sendValidationError } from "../http/validation";
import { resolveModelSelection } from "../llm/index";
import type { PromptContext } from "../prompts/render";
import { type RunBody, RunBodySchema } from "../schemas/run";
import {
  type Workspace,
  WorkspaceError,
  workspaceService,
} from "../workspaces/WorkspaceService";

export type RunTurnContext = {
  body: RunBody;
  ephemeral: boolean;
  /** Persisted session ID or temporary workspace lease ID. */
  sessionId: string;
  model: string;
  reasoningEffort?: string;
  agentName: string;
  toolSessionDir?: string;
  workspace: Workspace;
  promptContext: PromptContext;
  persistedSession: SessionRow | null;
  ownerUuid: string;
  attachments: AttachmentRow[];
};

/**
 * Parse + validate `req.body` and resolve everything downstream needs
 * (persisted session, effective agent, tool dir, model). Writes a 4xx
 * response and returns `null` on failure so the caller can early-return.
 */
export async function buildTurnContext(
  rawBody: unknown,
  res: Response,
  ownerUuid: string,
): Promise<RunTurnContext | null> {
  const parsed = RunBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return null;
  }
  const body = parsed.data;
  const ephemeral = body.ephemeral === true;
  let sessionId = body.sessionId ?? "";

  if (!ephemeral && !sessionId) {
    sendApiError(res, 400, "BAD_REQUEST", "sessionId required");
    return null;
  }

  let persistedSession: SessionRow | null = null;
  if (!ephemeral) {
    persistedSession = getSessionById(ownerUuid, sessionId);
    if (!persistedSession) {
      sendApiError(res, 404, "NOT_FOUND", "Session not found");
      return null;
    }
  }

  const agentName = body.agentName.trim();
  if (!getAgentByName(ownerUuid, agentName)) {
    sendApiError(res, 400, "BAD_REQUEST", `Unknown agent: ${agentName}`);
    return null;
  }

  const model = body.model?.trim() || DEFAULT_RUN_MODEL;
  const resolvedModel = resolveModelSelection(model);
  if (resolvedModel.provider === "openrouter") {
    if (
      !resolvedModel.model ||
      !/^[^/\s]+\/[^\s]+$/.test(resolvedModel.model)
    ) {
      sendApiError(res, 400, "BAD_REQUEST", "Unknown OpenRouter model");
      return null;
    }
    if (!getOpenRouterApiKey()) {
      sendApiError(
        res,
        400,
        "BAD_REQUEST",
        "Configure an OpenRouter API key in Settings before using this model",
      );
      return null;
    }
  }

  let workspace: Workspace;
  try {
    if (ephemeral && !sessionId) {
      const lease = await workspaceService.createTemporary(ownerUuid);
      sessionId = lease.id;
      workspace = {
        kind: "sandbox",
        hostPath: lease.hostPath,
        displayPath: "/workspace",
      };
    } else {
      workspace = ephemeral
        ? await workspaceService.resolveTemporary(ownerUuid, sessionId)
        : await workspaceService.resolveSession(persistedSession!);
    }
  } catch (error) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      error instanceof WorkspaceError
        ? error.message
        : "The chat workspace is unavailable",
    );
    return null;
  }
  const toolSessionDir = workspace.hostPath;

  const attachmentIds = body.attachmentIds ?? [];
  if (ephemeral && attachmentIds.length > 0) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      "Images are not available in temporary sessions",
    );
    return null;
  }
  const attachments = getSessionAttachments(
    ownerUuid,
    sessionId,
    attachmentIds,
  );
  if (attachments.length !== attachmentIds.length) {
    sendApiError(res, 400, "BAD_REQUEST", "Invalid image attachment");
    return null;
  }

  return {
    body,
    ephemeral,
    sessionId,
    model,
    reasoningEffort: body.reasoningEffort ?? undefined,
    agentName,
    toolSessionDir,
    workspace,
    promptContext: buildServerRunPromptContext({
      metadata: body.metadata,
      toolSessionDir: workspace.displayPath,
    }),
    persistedSession,
    ownerUuid,
    attachments,
  };
}
