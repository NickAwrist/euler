import "../setup";
import { expect, test } from "bun:test";
import { createMcpServers, setMcpServerEnabled } from "../../src/db/mcpServers";
import { openUserMcpTools } from "../../src/mcp/userTools";
import { MCP_TEST_TOKEN, startMcpTestServer } from "../helpers/mcpServer";
import { TEST_USER_ID } from "../helpers/server";

test("agents get tools from enabled, reachable MCP servers", async () => {
  const mcp = startMcpTestServer();
  const auth = { Authorization: `Bearer ${MCP_TEST_TOKEN}` };
  const [, disabled] = createMcpServers(TEST_USER_ID, [
    { name: "test", url: mcp.url, headers: auth },
    { name: "off", url: mcp.url, headers: auth },
    { name: "down", url: "http://127.0.0.1:9/mcp", headers: {} },
  ]);
  if (!disabled) throw new Error("expected server");
  setMcpServerEnabled(TEST_USER_ID, disabled.id, false);

  const toolSet = await openUserMcpTools(
    TEST_USER_ID,
    new AbortController().signal,
  );
  try {
    expect(toolSet.tools.map((tool) => tool.name)).toEqual([
      "mcp__test__echo",
      "mcp__test__fail",
    ]);
    const [echo, fail] = toolSet.tools;
    expect(echo?.toTool().function.parameters).toMatchObject({
      type: "object",
      required: ["text"],
    });
    expect(await echo?.execute({ text: "hi" })).toEqual({
      text: "hi",
      failed: false,
    });
    expect(await fail?.execute({})).toEqual({ text: "boom", failed: true });
  } finally {
    await toolSet.close();
    mcp.close();
  }
});
