import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerRow } from "../db/mcpServers";
import { prepareMcpTransportAuth } from "./oauth";

const CONNECT_TIMEOUT_MS = 15_000;

export type McpConnection = { client: Client; tools: Tool[] };

async function listAllTools(
  client: Client,
  options: { signal?: AbortSignal; timeout: number },
): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {}, options);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/** Connects over Streamable HTTP (falling back to SSE) and lists every tool. */
export async function connectMcpServer(
  server: Pick<McpServerRow, "url" | "headers"> &
    Partial<Pick<McpServerRow, "id" | "owner_uuid" | "oauthConfig">>,
  signal?: AbortSignal,
): Promise<McpConnection> {
  const transportAuth = await prepareMcpTransportAuth(server, signal);
  const url = new URL(server.url);
  const options = { signal, timeout: CONNECT_TIMEOUT_MS };
  const transportOpts = {
    ...transportAuth,
    requestInit: { headers: server.headers },
  };

  const client = new Client({ name: "euler", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(url, transportOpts),
      options,
    );
    return { client, tools: await listAllTools(client, options) };
  } catch (error) {
    await client.close();
    if (
      !(error instanceof StreamableHTTPError) ||
      (error.code !== 405 && error.code !== 404)
    ) {
      throw error;
    }
    const fallbackClient = new Client({ name: "euler", version: "1.0.0" });
    try {
      await fallbackClient.connect(
        new SSEClientTransport(url, transportOpts),
        options,
      );
      return {
        client: fallbackClient,
        tools: await listAllTools(fallbackClient, options),
      };
    } catch (sseError) {
      await fallbackClient.close();
      if (
        error.code === 404 &&
        !/\/sse\/?$/i.test(url.pathname) &&
        !(sseError instanceof SseError && sseError.code === 401)
      ) {
        throw error;
      }
      throw sseError;
    }
  }
}
