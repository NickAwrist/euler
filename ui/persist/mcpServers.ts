import type {
  McpServer,
  McpTool,
  TestServerResponse,
} from "../../src/gen/euler/v1/mcp_pb";
import { mcpServerClient, withErrorMessage } from "../lib/rpc";

export type { McpServer, McpTool };
export type McpServerCheck = TestServerResponse["result"];

export async function fetchMcpServers(): Promise<McpServer[]> {
  return (
    await withErrorMessage(
      mcpServerClient.listServers({}),
      "Failed to fetch MCP servers",
    )
  ).servers;
}

/** Adds every server in a pasted `mcpServers` config. */
export async function addMcpServersApi(config: string): Promise<McpServer[]> {
  return (
    await withErrorMessage(
      mcpServerClient.createServers({ config }),
      "Failed to add MCP servers",
    )
  ).servers;
}

export async function setMcpServerEnabledApi(
  id: string,
  enabled: boolean,
): Promise<McpServer> {
  return (
    await withErrorMessage(
      mcpServerClient.updateServer({ id, enabled }),
      "Failed to update MCP server",
    )
  ).server!;
}

export async function deleteMcpServerApi(id: string): Promise<void> {
  await withErrorMessage(
    mcpServerClient.deleteServer({ id }),
    "Failed to delete MCP server",
  );
}

export async function checkMcpServerApi(id: string): Promise<McpServerCheck> {
  return (
    await withErrorMessage(
      mcpServerClient.testServer({ id }),
      "Failed to check MCP server",
    )
  ).result;
}

export async function fetchMcpTools(signal?: AbortSignal): Promise<McpTool[]> {
  return (
    await withErrorMessage(
      mcpServerClient.listTools({}, { signal }),
      "Failed to fetch MCP tools",
    )
  ).tools;
}
