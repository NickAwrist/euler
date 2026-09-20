import { Router } from "express";
import {
  AgentCapabilityValidationError,
  createAgentRow,
  deleteAgentRow,
  getAgentById,
  listAgents,
  updateAgentRow,
} from "../db/index";
import { errorMessage, sendApiError } from "../http/errors";
import { sendValidationError } from "../http/validation";
import { AgentWriteSchema } from "../schemas/agents";
import { requireUserId } from "../userIdentity";

const agentsRoutes = Router();

function sendAgentWriteError(
  res: Parameters<typeof sendApiError>[0],
  error: unknown,
) {
  if (error instanceof AgentCapabilityValidationError) {
    sendApiError(res, 400, "VALIDATION_ERROR", error.message);
    return true;
  }
  const message = errorMessage(error);
  if (message.includes("UNIQUE constraint")) {
    sendApiError(
      res,
      409,
      "CONFLICT",
      "An agent with that name already exists",
    );
    return true;
  }
  return false;
}

agentsRoutes.get("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  res.json({ agents: listAgents(ownerUuid) });
});

agentsRoutes.get("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const agent = getAgentById(ownerUuid, req.params.id);
  if (!agent) {
    sendApiError(res, 404, "NOT_FOUND", "Agent not found");
    return;
  }
  res.json(agent);
});

agentsRoutes.post("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = AgentWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  try {
    const agent = createAgentRow(ownerUuid, parsed.data);
    res.status(201).json(agent);
  } catch (error: unknown) {
    if (sendAgentWriteError(res, error)) return;
    throw error;
  }
});

agentsRoutes.put("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = AgentWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  try {
    const ok = updateAgentRow(ownerUuid, req.params.id, parsed.data);
    if (!ok) {
      sendApiError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }
    res.json({ ok: true });
  } catch (error: unknown) {
    if (sendAgentWriteError(res, error)) return;
    throw error;
  }
});

agentsRoutes.delete("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const ok = deleteAgentRow(ownerUuid, req.params.id);
  if (!ok) {
    sendApiError(
      res,
      400,
      "BAD_REQUEST",
      "Agent not found or cannot delete the required general_agent fallback",
    );
    return;
  }
  res.json({ ok: true });
});

export default agentsRoutes;
