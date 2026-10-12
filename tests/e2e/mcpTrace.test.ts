import { waitForActivation } from "../helpers/activation";
import "../setup";
import { expect, test } from "bun:test";
import { setOpenRouterApiKey } from "../../src/db";
import { createMcpServers } from "../../src/db/mcpServers";
import { MCP_TEST_TOKEN, startMcpTestServer } from "../helpers/mcpServer";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { TEST_USER_ID, startTestServer, userHeaders } from "../helpers/server";

const model = "openrouter:openai/gpt-5.6-terra";

test("MCP tool calls are traced with their arguments and result", async () => {
  setOpenRouterApiKey("sk-or-mcp-test");
  setOpenRouterScenario("mcp-tool");
  const icons = [{ src: "data:image/png;base64,AAAA" }];
  const mcp = startMcpTestServer(icons);
  createMcpServers(TEST_USER_ID, [
    {
      name: "test",
      url: mcp.url,
      headers: { Authorization: `Bearer ${MCP_TEST_TOKEN}` },
    },
  ]);
  const { url, close } = await startTestServer();
  const headers = userHeaders(undefined, {
    "Content-Type": "application/json",
  });
  try {
    const created = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model }),
    });
    const { id } = (await created.json()) as { id: string };
    await fetch(`${url}/api/sessions/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "Echo hello", model }),
    });
    await waitForActivation(id);
    const stored = await fetch(`${url}/api/sessions/${id}`, {
      headers: userHeaders(),
    });
    const { history } = (await stored.json()) as {
      history: { role: string; steps?: Record<string, unknown>[] }[];
    };
    expect(history.at(-1)?.steps).toContainEqual(
      expect.objectContaining({
        kind: "tool_call",
        toolName: "mcp__test__echo",
        toolIcons: icons,
        args: { text: "hello" },
        result: "hello",
      }),
    );
  } finally {
    await close();
    mcp.close();
  }
});
