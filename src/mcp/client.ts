import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerRow } from "../db/mcpServers";

const CONNECT_TIMEOUT_MS = 15_000;

export type McpConnection = { client: Client; tools: Tool[] };

/** Connects over Streamable HTTP and lists every tool the server offers. */
export async function connectMcpServer(
  server: Pick<McpServerRow, "url" | "headers">,
  signal?: AbortSignal,
): Promise<McpConnection> {
  const client = new Client({ name: "euler", version: "1.0.0" });
  const options = { signal, timeout: CONNECT_TIMEOUT_MS };
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      }),
      options,
    );
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, options);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return { client, tools };
  } catch (error) {
    await client.close();
    throw error;
  }
}
