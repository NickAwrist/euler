import { Router } from "express";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../agents/agentManager";
import { INBOX_DIRECTIVES } from "../agents/runtime/agentContext";
import { type SessionRow, getSessionById } from "../db/index";
import { sendError, sendValidationError } from "../observability/http";
import { DebugPromptBodySchema } from "../schemas/run";
import { requireUserId } from "../userIdentity";
import {
  type Workspace,
  workspaceService,
} from "../workspaces/WorkspaceService";

const router = Router();

router.post("/debug-prompt", async (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = DebugPromptBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const body = parsed.data;
  const ephemeral = body.ephemeral === true;
  const sessionId = body.sessionId?.trim() || "";

  let workspace: Workspace | undefined;
  let persistedSession: SessionRow | null = null;

  if (!ephemeral && sessionId) {
    persistedSession = getSessionById(ownerUuid, sessionId);
    if (!persistedSession) {
      sendError(res, "NOT_FOUND", "Session not found");
      return;
    }
  }
  if (persistedSession) {
    workspace = await workspaceService.resolveSession(persistedSession);
  } else if (ephemeral && sessionId) {
    workspace = await workspaceService.resolveTemporary(ownerUuid, sessionId);
  }

  const promptContext = buildServerRunPromptContext({
    metadata: body.metadata,
    toolSessionDir: workspace?.displayPath ?? "/workspace",
  });

  const agent = agentManager.createAgent({
    promptContext,
    toolSessionDir: workspace?.hostPath,
    ownerUuid,
    userPrompt: body.message,
  });

  res.json({ systemPrompt: `${agent.systemPrompt}\n\n${INBOX_DIRECTIVES}` });
});

export default router;
