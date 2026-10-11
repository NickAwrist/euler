import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export const MCP_TEST_TOKEN = "test-token";

/** A stateless Streamable HTTP MCP server that requires a bearer token. */
export function startMcpTestServer() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${MCP_TEST_TOKEN}`)
        return new Response("Unauthorized", { status: 401 });
      const mcp = new McpServer({ name: "test", version: "1.0.0" });
      mcp.registerTool(
        "echo",
        { description: "Echo text.", inputSchema: { text: z.string() } },
        async ({ text }) => ({ content: [{ type: "text", text }] }),
      );
      mcp.registerTool("fail", { description: "Always fails." }, async () => ({
        content: [{ type: "text", text: "boom" }],
        isError: true,
      }));
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      return transport.handleRequest(request);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    close: () => server.stop(true),
  };
}
