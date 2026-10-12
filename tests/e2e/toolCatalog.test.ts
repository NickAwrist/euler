import "../setup";
import { expect, test } from "bun:test";
import { getDb } from "../../src/db/connection";
import { ToolPermissionToolsSchema } from "../../src/schemas/toolPermissions";
import { MCP_TEST_TOKEN, startMcpTestServer } from "../helpers/mcpServer";
import { startTestServer, userHeaders } from "../helpers/server";

test("the tool picker uses enabled user tools, actual MCP names, and runtime tools without saving agents", async () => {
  const server = await startTestServer();
  const mcp = startMcpTestServer();
  const other = "22222222-2222-4222-8222-222222222222";
  const names = async (owner?: string) => {
    const response = await fetch(`${server.url}/api/settings/user/tools`, {
      headers: userHeaders(owner),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = ToolPermissionToolsSchema.parse(await response.json());
    return data.tools.map((tool) => tool.name);
  };
  try {
    const before = getDb().query("SELECT COUNT(*) AS count FROM agents").get();
    const initial = await names();
    expect(initial).toContain("bash");
    expect(initial).toContain("read_file");
    expect(initial).toContain("spawn_agent");
    expect(initial).toContain("ask_parent");
    expect(initial).toContain("get_job");
    expect(new Set(initial).size).toBe(initial.length);
    expect(getDb().query("SELECT COUNT(*) AS count FROM agents").get()).toEqual(
      before,
    );
    await fetch(`${server.url}/api/settings/user`, {
      method: "PATCH",
      headers: userHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({ capabilities: { shell: false } }),
    });
    expect(await names()).not.toContain("bash");
    expect(await names(other)).toContain("bash");
    const created = await fetch(`${server.url}/api/mcp-servers`, {
      method: "POST",
      headers: userHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        mcpServers: {
          picker: {
            url: mcp.url,
            headers: { Authorization: `Bearer ${MCP_TEST_TOKEN}` },
          },
        },
      }),
    });
    expect(created.status).toBe(201);
    const data = (await created.json()) as { servers: { id: string }[] };
    const available = await names();
    expect(available).toContain("mcp__picker__echo");
    expect(available).toContain("mcp__picker__fail");
    expect(await names(other)).not.toContain("mcp__picker__echo");
    const disabled = await fetch(
      `${server.url}/api/mcp-servers/${data.servers[0]!.id}`,
      {
        method: "PATCH",
        headers: userHeaders(undefined, { "Content-Type": "application/json" }),
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(disabled.status).toBe(200);
    expect(await names()).not.toContain("mcp__picker__echo");
    const unauthorized = await fetch(`${server.url}/api/settings/user/tools`);
    expect(unauthorized.status).toBe(400);
  } finally {
    mcp.close();
    await server.close();
  }
});
