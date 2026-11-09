import type {
  McpServer,
  McpTool,
  TestServerResponse,
} from "../../src/gen/euler/v1/mcp_pb";
import { mcpServerClient } from "../lib/rpc";

export type { McpServer, McpTool };
export type McpServerCheck = TestServerResponse["result"];

export async function fetchMcpServers(): Promise<McpServer[]> {
  return (await mcpServerClient.listServers({})).servers;
}

/** Adds every server in a pasted `mcpServers` config. */
export async function addMcpServersApi(config: string): Promise<McpServer[]> {
  return (await mcpServerClient.createServers({ config })).servers;
}

export async function setMcpServerEnabledApi(
  id: string,
  enabled: boolean,
): Promise<McpServer> {
  return (await mcpServerClient.updateServer({ id, enabled })).server!;
}

export async function deleteMcpServerApi(id: string): Promise<void> {
  await mcpServerClient.deleteServer({ id });
}

export async function checkMcpServerApi(id: string): Promise<McpServerCheck> {
  return (await mcpServerClient.testServer({ id })).result;
}

export async function fetchMcpTools(signal?: AbortSignal): Promise<McpTool[]> {
  return (await mcpServerClient.listTools({}, { signal })).tools;
}
