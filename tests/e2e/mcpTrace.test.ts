import { waitForActivation } from "../helpers/activation";
import "../setup";
import { expect, test } from "bun:test";
import { setOpenRouterApiKey } from "../../src/db";
import { createMcpServers } from "../../src/db/mcpServers";
import { Step_Kind } from "../../src/gen/euler/v1/steps_pb";
import { MCP_TEST_TOKEN, startMcpTestServer } from "../helpers/mcpServer";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { rpc } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

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
  const api = rpc();
  try {
    const { id } = await api.sessions.createSession({ model });
    await api.agent.sendMessage({
      sessionId: id,
      content: "Echo hello",
      settings: { model },
    });
    await waitForActivation(id);
    const { session } = await api.sessions.getSession({ id });
    expect(session?.history.at(-1)?.steps).toContainEqual(
      expect.objectContaining({
        kind: Step_Kind.TOOL_CALL,
        toolName: "mcp__test__echo",
        toolIcons: [expect.objectContaining({ src: icons[0]!.src })],
        args: { text: "hello" },
        result: "hello",
      }),
    );
  } finally {
    mcp.close();
  }
});
