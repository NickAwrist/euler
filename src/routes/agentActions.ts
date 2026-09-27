import { Router } from "express";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { getOpenRouterApiKey } from "../db";
import { getAttachment } from "../db/attachments";
import { getSessionById, markSessionViewed } from "../db/sessions";
import { sendApiError } from "../http/errors";
import { sendValidationError } from "../http/validation";
import { resolveModelSelection } from "../llm";
import { EditQueuedMessageSchema } from "../schemas/agents";
import { RewindSchema, SendMessageSchema } from "../schemas/agents";
import { requireUserId } from "../userIdentity";
import { workspaceService } from "../workspaces/WorkspaceService";

export function agentActions(temporary = false) {
  const router = Router();
  router.use("/:id", (req, res, next) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    if (temporary) {
      try {
        workspaceService.temporaryPresentation(owner, req.params.id);
      } catch {
        sendApiError(res, 404, "NOT_FOUND", "Temporary chat not found");
        return;
      }
    } else if (!getSessionById(owner, req.params.id)) {
      sendApiError(res, 404, "NOT_FOUND", "Session not found");
      return;
    }
    next();
  });
  router.post("/:id/viewed", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    if (!temporary) markSessionViewed(owner, req.params.id);
    res.json({ ok: true });
  });
  router.post("/:id/messages", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const parsed = SendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const body = parsed.data;
    if (agentRuntime.isChanging(req.params.id)) {
      sendApiError(
        res,
        409,
        "CONFLICT",
        "The conversation is being changed. Try again when it finishes.",
      );
      return;
    }
    if (
      body.attachmentIds.some(
        (id) => getAttachment(owner, id)?.sessionId !== req.params.id,
      )
    ) {
      sendApiError(res, 400, "BAD_REQUEST", "Invalid attachment");
      return;
    }
    const main = agentRuntime.main(owner, req.params.id, temporary);
    const selection = resolveModelSelection(body.model ?? main.model);
    if (selection.provider === "openrouter" && !getOpenRouterApiKey()) {
      sendApiError(
        res,
        400,
        "BAD_REQUEST",
        "Configure an OpenRouter API key in Settings before using this model",
      );
      return;
    }
    const { message, queued } = agentRuntime.send(main, body);
    res.status(202).json({ messageId: message.id, queued });
  });
  router.post("/:id/stop", async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    await agentRuntime.cancel(
      agentRuntime.main(owner, req.params.id, temporary),
    );
    res.json({ ok: true });
  });
  router.post("/:id/deliver", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    agentRuntime.deliver(agentRuntime.main(owner, req.params.id, temporary));
    res.json({ ok: true });
  });
  router.patch("/:id/messages/:messageId", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const parsed = EditQueuedMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const main = agentRuntime.main(owner, req.params.id, temporary);
    if (
      !agentRuntime.store.editQueued(
        main.id,
        Number(req.params.messageId),
        parsed.data.content,
      )
    ) {
      sendApiError(res, 409, "CONFLICT", "Message was already delivered");
      return;
    }
    agentRuntime.resync(owner, req.params.id);
    res.json({ ok: true });
  });
  router.delete("/:id/messages/:messageId", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const main = agentRuntime.main(owner, req.params.id, temporary);
    if (
      !agentRuntime.store.removeQueued(main.id, Number(req.params.messageId))
    ) {
      sendApiError(res, 409, "CONFLICT", "Message was already delivered");
      return;
    }
    agentRuntime.resync(owner, req.params.id);
    res.json({ ok: true });
  });
  router.get("/:id/runtime", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    res.json(agentRuntime.snapshot(owner, req.params.id));
  });
  router.get("/:id/agents/:agentId", (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const agents = agentRuntime.store.view(owner, req.params.id);
    const agent = agents.find((a) => a.id === req.params.agentId);
    if (!agent) {
      sendApiError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }
    const messages = agents
      .flatMap((a) => agentRuntime.store.inbox(a.id))
      .filter((m) => m.agentId === agent.id || m.sender === agent.id)
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    res.json({ agent, messages });
  });
  router.post("/:id/agents/:agentId/cancel", async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const visible = agentRuntime.store
      .view(owner, req.params.id)
      .find((a) => a.id === req.params.agentId && a.kind !== "main");
    const agent = visible ? agentRuntime.store.get(visible.id) : undefined;
    if (!agent) {
      sendApiError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }
    await agentRuntime.cancel(agent);
    res.json({ ok: true });
  });
  router.post("/:id/rewind", async (req, res) => {
    const owner = requireUserId(req, res);
    if (!owner) return;
    const parsed = RewindSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    await agentRuntime.rewind(owner, req.params.id, parsed.data, temporary);
    res.json({ ok: true });
  });
  return router;
}
