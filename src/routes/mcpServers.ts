import { Router } from "express";
import { isUniqueViolation } from "../db/errors";
import {
  type McpServerRow,
  createMcpServers,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  setMcpServerEnabled,
} from "../db/mcpServers";
import { asyncRoute } from "../http/asyncRoute";
import { connectMcpServer } from "../mcp/client";
import { sendError, sendValidationError } from "../observability/http";
import {
  McpConfigSchema,
  type McpServerCheck,
  type McpServerData,
  McpServerPatchSchema,
} from "../schemas/mcp";
import { requireUserId } from "../userIdentity";
import { errorMessage } from "../utils/errors";

const mcpServersRoutes = Router();

function toMcpServerData({
  owner_uuid: _owner,
  headers,
  ...server
}: McpServerRow): McpServerData {
  return { ...server, headerNames: Object.keys(headers) };
}

mcpServersRoutes.get("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  res.json({ servers: listMcpServers(ownerUuid).map(toMcpServerData) });
});

/** Accepts a pasted `mcpServers` config and adds every server in it. */
mcpServersRoutes.post("/", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = McpConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  try {
    res.status(201).json({
      servers: createMcpServers(ownerUuid, parsed.data).map(toMcpServerData),
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      sendError(res, "CONFLICT", "An MCP server with that name already exists");
      return;
    }
    throw error;
  }
});

mcpServersRoutes.patch("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  const parsed = McpServerPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const server = setMcpServerEnabled(
    ownerUuid,
    req.params.id,
    parsed.data.enabled,
  );
  if (!server) {
    sendError(res, "NOT_FOUND", "MCP server not found");
    return;
  }
  res.json(toMcpServerData(server));
});

mcpServersRoutes.delete("/:id", (req, res) => {
  const ownerUuid = requireUserId(req, res);
  if (!ownerUuid) return;
  if (!deleteMcpServer(ownerUuid, req.params.id)) {
    sendError(res, "NOT_FOUND", "MCP server not found");
    return;
  }
  res.json({ ok: true });
});

/**
 * Connects to the server and lists its tools. An unreachable server is a
 * result of the check, so its error is returned for the user to fix.
 */
mcpServersRoutes.post(
  "/:id/check",
  asyncRoute(async (req, res) => {
    const ownerUuid = requireUserId(req, res);
    if (!ownerUuid) return;
    const server = getMcpServer(ownerUuid, String(req.params.id));
    if (!server) {
      sendError(res, "NOT_FOUND", "MCP server not found");
      return;
    }
    let check: McpServerCheck;
    try {
      const { client, tools } = await connectMcpServer(server);
      await client.close();
      check = {
        ok: true,
        tools: tools.map(({ name, description }) => ({ name, description })),
      };
    } catch (error: unknown) {
      check = { ok: false, error: errorMessage(error) };
    }
    res.json(check);
  }),
);

export default mcpServersRoutes;
