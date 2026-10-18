import { type Response, Router } from "express";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { getOpenRouterApiKey } from "../db";
import { getAttachment } from "../db/attachments";
import { markSessionViewed } from "../db/sessions";
import { asyncRoute } from "../http/asyncRoute";
import { requestSession } from "../http/sessionRoute";
import { resolveModelSelection } from "../llm";
import { chatGptStatus } from "../models/chatgpt";
import { sendError, sendValidationError } from "../observability/http";
import { RewindSchema, SendMessageSchema } from "../schemas/agents";
import { ToolApprovalResponseSchema } from "../schemas/toolPermissions";

/** Sends an error for a model that cannot run and returns false. */
function modelAvailable(res: Response, model: string, owner: string) {
  if (
    resolveModelSelection(model).provider === "openrouter" &&
    !getOpenRouterApiKey()
  ) {
    sendError(
      res,
      "INVALID_REQUEST",
      "Configure an OpenRouter API key in Settings before using this model",
    );
    return false;
  }
  if (
    resolveModelSelection(model).provider === "chatgpt" &&
    !chatGptStatus(owner).planEnabled
  ) {
    sendError(
      res,
      "INVALID_REQUEST",
      "Connect ChatGPT in Settings before using this model",
    );
    return false;
  }
  return true;
}

export function agentActions() {
  const router = Router();
  router.post("/:id/viewed", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    markSessionViewed(owner, id);
    res.json({ ok: true });
  });
  router.post("/:id/messages", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    const parsed = SendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const body = parsed.data;
    if (agentRuntime.isChanging(id)) {
      sendError(
        res,
        "CONFLICT",
        "The conversation is being changed. Try again when it finishes.",
      );
      return;
    }
    if (
      body.attachmentIds.some(
        (attachmentId) => getAttachment(owner, attachmentId)?.sessionId !== id,
      )
    ) {
      sendError(res, "INVALID_REQUEST", "Invalid attachment");
      return;
    }
    const main = agentRuntime.main(owner, id);
    if (!modelAvailable(res, body.model ?? main.model, owner)) return;
    const { message, queued } = agentRuntime.send(main, body);
    res.status(202).json({ messageId: message.id, queued });
  });
  router.post("/:id/stop", async (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    await agentRuntime.cancel(agentRuntime.main(owner, id));
    res.json({ ok: true });
  });
  router.post("/:id/deliver", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    agentRuntime.deliver(agentRuntime.main(owner, id));
    res.json({ ok: true });
  });
  router.delete("/:id/messages/:messageId", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    const main = agentRuntime.main(owner, id);
    if (!agentRuntime.removeQueued(main, Number(req.params.messageId))) {
      sendError(res, "CONFLICT", "Message was already delivered");
      return;
    }
    res.json({ ok: true });
  });
  router.get("/:id/jobs", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    res.json(agentRuntime.jobs.list(owner, id));
  });
  router.get("/:id/jobs/:jobId", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    try {
      res.json(agentRuntime.jobs.read(owner, id, req.params.jobId));
    } catch {
      sendError(res, "NOT_FOUND", "Job not found");
    }
  });
  router.post("/:id/jobs/:jobId/cancel", async (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    try {
      res.json(await agentRuntime.jobs.cancel(owner, id, req.params.jobId));
    } catch {
      sendError(res, "NOT_FOUND", "Job not found");
    }
  });
  router.get("/:id/runtime", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    res.json(agentRuntime.snapshot(owner, id));
  });
  router.post(
    "/:id/approvals/:approvalId",
    asyncRoute(async (req, res) => {
      const { owner_uuid: owner, id } = requestSession(req);
      const parsed = ToolApprovalResponseSchema.safeParse(req.body);
      if (!parsed.success) return sendValidationError(res, parsed.error);
      res.json(
        await agentRuntime.approvals.respond(
          owner,
          id,
          req.params.approvalId as string,
          parsed.data,
        ),
      );
    }),
  );
  router.get("/:id/agents/:agentId", (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    const agents = agentRuntime.store.view(owner, id);
    const agent = agents.find((a) => a.id === req.params.agentId);
    if (!agent) {
      sendError(res, "NOT_FOUND", "Agent not found");
      return;
    }
    const messages = agents
      .flatMap((a) => agentRuntime.store.inbox(a.id))
      .filter((m) => m.agentId === agent.id || m.sender === agent.id)
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    res.json({ agent, steps: agentRuntime.store.steps(agent.id), messages });
  });
  router.post("/:id/agents/:agentId/cancel", async (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    const visible = agentRuntime.store
      .view(owner, id)
      .find((a) => a.id === req.params.agentId && a.kind !== "main");
    const agent = visible ? agentRuntime.store.get(visible.id) : undefined;
    if (!agent) {
      sendError(res, "NOT_FOUND", "Agent not found");
      return;
    }
    await agentRuntime.cancel(agent);
    res.json({ ok: true });
  });
  router.post("/:id/rewind", async (req, res) => {
    const { owner_uuid: owner, id } = requestSession(req);
    const parsed = RewindSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const main = agentRuntime.main(owner, id);
    if (!modelAvailable(res, parsed.data.model ?? main.model, owner)) return;
    await agentRuntime.rewind(owner, id, parsed.data);
    res.json({ ok: true });
  });
  return router;
}
