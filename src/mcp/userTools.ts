import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { listMcpServers } from "../db/mcpServers";
import { logEvent } from "../observability/logger";
import { McpTool } from "../tools/mcp";
import { connectMcpServer } from "./client";

export type McpToolSet = { tools: McpTool[]; close(): Promise<void> };

/**
 * Connects to the user's enabled MCP servers for one activation. A server that
 * fails to connect is logged and left out so it cannot block the run.
 */
export async function openUserMcpTools(
  ownerUuid: string,
  signal: AbortSignal,
): Promise<McpToolSet> {
  const servers = listMcpServers(ownerUuid).filter((server) => server.enabled);
  const results = await Promise.allSettled(
    servers.map((server) => connectMcpServer(server, signal)),
  );
  const clients: Client[] = [];
  const tools = new Map<string, McpTool>();
  for (const [index, result] of results.entries()) {
    const server = servers[index];
    if (!server) continue;
    if (result.status === "rejected") {
      logEvent(
        "warn",
        "mcp.connect_failed",
        { label: server.name },
        result.reason,
      );
      continue;
    }
    clients.push(result.value.client);
    for (const definition of result.value.tools) {
      const tool = new McpTool(result.value.client, server.name, definition);
      // Distinct names can collide once sanitized; keep the first.
      if (!tools.has(tool.name)) tools.set(tool.name, tool);
    }
  }
  return {
    tools: [...tools.values()],
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}
