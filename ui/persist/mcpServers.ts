import {
  type McpServer,
  McpServerOAuth_GrantType,
  type McpTool,
  type StartServerOAuthResponse,
  type TestServerResponse,
} from "../../src/gen/euler/v1/mcp_pb";
import { mcpServerClient, withErrorMessage } from "../lib/rpc";

export { McpServerOAuth_GrantType };
export type { McpServer, McpTool, StartServerOAuthResponse };
export type McpServerCheck = {
  result: TestServerResponse["result"];
  authorizationRequired: boolean;
};

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
  const response = await withErrorMessage(
    mcpServerClient.testServer({ id }),
    "Failed to check MCP server",
  );
  return {
    result: response.result,
    authorizationRequired: response.authorizationRequired,
  };
}

export async function startMcpServerOAuthApi(
  id: string,
  redirectOrigin?: string,
): Promise<StartServerOAuthResponse> {
  return withErrorMessage(
    mcpServerClient.startServerOAuth({
      id,
      ...(redirectOrigin ? { redirectOrigin } : {}),
    }),
    "Failed to start MCP sign-in",
  );
}

export async function finishMcpServerOAuthApi(
  id: string,
  callbackUrl: string,
): Promise<McpServer> {
  return (
    await withErrorMessage(
      mcpServerClient.finishServerOAuth({ id, callbackUrl }),
      "Failed to finish MCP sign-in",
    )
  ).server!;
}

export async function disconnectMcpServerOAuthApi(
  id: string,
): Promise<{ server: McpServer; revoked: boolean }> {
  const response = await withErrorMessage(
    mcpServerClient.disconnectServerOAuth({ id }),
    "Failed to disconnect MCP server",
  );
  return { server: response.server!, revoked: response.revoked };
}

export async function fetchMcpTools(signal?: AbortSignal): Promise<McpTool[]> {
  return (
    await withErrorMessage(
      mcpServerClient.listTools({}, { signal }),
      "Failed to fetch MCP tools",
    )
  ).tools;
}
