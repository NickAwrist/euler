import {
  type McpServerCheck,
  McpServerCheckSchema,
  type McpServerData,
  McpServerListResponseSchema,
  McpServerSchema,
} from "../../src/schemas/mcp";
import { apiJson, apiVoid } from "../lib/api";

export type { McpServerCheck, McpServerData };

export async function fetchMcpServers(): Promise<McpServerData[]> {
  return McpServerListResponseSchema.parse(
    await apiJson<unknown>("/api/mcp-servers", {
      errorMessage: "Failed to fetch MCP servers",
    }),
  ).servers;
}

/** Adds every server in a pasted `mcpServers` config. */
export async function addMcpServersApi(
  config: unknown,
): Promise<McpServerData[]> {
  return McpServerListResponseSchema.parse(
    await apiJson<unknown>("/api/mcp-servers", {
      method: "POST",
      json: config,
      errorMessage: "Failed to add MCP servers",
    }),
  ).servers;
}

export async function setMcpServerEnabledApi(
  id: string,
  enabled: boolean,
): Promise<McpServerData> {
  return McpServerSchema.parse(
    await apiJson<unknown>(`/api/mcp-servers/${id}`, {
      method: "PATCH",
      json: { enabled },
      errorMessage: "Failed to update MCP server",
    }),
  );
}

export function deleteMcpServerApi(id: string): Promise<void> {
  return apiVoid(`/api/mcp-servers/${id}`, {
    method: "DELETE",
    errorMessage: "Failed to delete MCP server",
  });
}

export async function checkMcpServerApi(id: string): Promise<McpServerCheck> {
  return McpServerCheckSchema.parse(
    await apiJson<unknown>(`/api/mcp-servers/${id}/check`, {
      method: "POST",
      errorMessage: "Failed to check MCP server",
    }),
  );
}
