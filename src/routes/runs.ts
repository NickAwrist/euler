import { Router } from "express";
import { z } from "zod";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../agents/agentManager";
import { type SessionRow, getSessionById } from "../db/index";
import { sendApiError } from "../http/errors";
import { sendValidationError } from "../http/validation";
import { handleRun } from "../run/runController";
import { sseManager } from "../run/sseManager";
import { AbortRunBodySchema, DebugPromptBodySchema } from "../schemas/run";
import { requireUserId } from "../userIdentity";
import {
  type Workspace,
  WorkspaceError,
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
      sendApiError(res, 404, "NOT_FOUND", "Session not found");
      return;
    }
  }
  try {
    if (persistedSession) {
      workspace = await workspaceService.resolveSession(persistedSession);
    } else if (ephemeral && sessionId) {
      workspace = await workspaceService.resolveTemporary(ownerUuid, sessionId);
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
    return;
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

  res.json({ systemPrompt: agent.systemPrompt });
});

router.post("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  void handleRun(req, res, sseManager, ownerUuid);
});

router.post("/abort", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = AbortRunBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ aborted: false });
    return;
  }
  const aborted = sseManager.abortRequest(parsed.data.requestId, ownerUuid);
  res.json({ aborted });
});

router.get("/active/:sessionId", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const gen = sseManager.getActive(req.params.sessionId, ownerUuid);
  if (!gen) {
    res.json({ active: false });
    return;
  }
  res.json({ active: true, requestId: gen.requestId });
});

router.get("/stream/:sessionId", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const gen = sseManager.getActive(req.params.sessionId, ownerUuid);
  if (!gen) {
    sendApiError(
      res,
      404,
      "NOT_FOUND",
      "No active generation for this session",
    );
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const event of gen.eventBuffer) {
    sseManager.sendTo(res, event);
  }

  sseManager.attachClient(gen, res);

  const ping = setInterval(() => {
    res.write(":\n\n");
  }, 15000);

  res.on("close", () => {
    clearInterval(ping);
    if (!res.writableFinished) {
      sseManager.removeClient(gen, res);
    }
  });
});

export default router;
