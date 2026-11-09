import "../setup";
import { expect, test } from "bun:test";
import { getDb } from "../../src/db/connection";
import { PermissionField_Type } from "../../src/gen/euler/v1/preferences_pb";
import { fromProtoField } from "../../src/permissions/wire";
import { MCP_TEST_TOKEN, startMcpTestServer } from "../helpers/mcpServer";
import { Code, rpc, rpcCode } from "../helpers/rpc";

test("the tool picker uses enabled user tools, actual MCP names, and runtime tools without saving agents", async () => {
  const icons = [{ src: "data:image/png;base64,AAAA" }];
  const mcp = startMcpTestServer(icons);
  const api = rpc();
  const other = rpc("22222222-2222-4222-8222-222222222222");
  const tools = async (client = api) =>
    (await client.preferences.listPermissionTools({})).tools;
  const names = async (client = api) =>
    (await tools(client)).map((tool) => tool.name);
  try {
    const before = getDb().query("SELECT COUNT(*) AS count FROM agents").get();
    const initial = await names();
    for (const name of [
      "bash",
      "read_file",
      "spawn_agent",
      "ask_parent",
      "get_job",
    ])
      expect(initial).toContain(name);
    const catalog = await tools();
    expect(
      catalog.find((tool) => tool.name === "bash")?.fields.map(fromProtoField),
    ).toEqual([
      { path: "background", type: "boolean", description: expect.any(String) },
      { path: "command", type: "string", description: expect.any(String) },
    ]);
    expect(
      catalog
        .find((tool) => tool.name === "send_message")
        ?.fields.some((field) => field.path === "to"),
    ).toBe(true);
    const action = catalog
      .find((tool) => tool.name === "manage_skills")
      ?.fields.find((field) => field.path === "action");
    expect(action?.type).toBe(PermissionField_Type.STRING);
    expect(action && fromProtoField(action)).toEqual({
      path: "action",
      type: "string",
      values: ["view", "create", "update", "delete"],
    });
    expect(new Set(initial).size).toBe(initial.length);
    expect(getDb().query("SELECT COUNT(*) AS count FROM agents").get()).toEqual(
      before,
    );
    await api.preferences.updatePreferences({
      capabilities: { shell: false },
    });
    expect(await names()).not.toContain("bash");
    expect(await names(other)).toContain("bash");
    const { servers } = await api.mcp.createServers({
      config: JSON.stringify({
        mcpServers: {
          picker: {
            url: mcp.url,
            headers: { Authorization: `Bearer ${MCP_TEST_TOKEN}` },
          },
        },
      }),
    });
    const available = await names();
    expect(available).toContain("mcp__picker__echo");
    expect(available).toContain("mcp__picker__fail");
    const echo = (await tools()).find(
      (tool) => tool.name === "mcp__picker__echo",
    );
    expect(echo?.fields.map(fromProtoField)).toEqual([
      { path: "text", type: "string" },
    ]);
    expect(echo?.icons.map((icon) => icon.src)).toEqual([icons[0]!.src]);
    expect(await names(other)).not.toContain("mcp__picker__echo");
    await api.mcp.updateServer({ id: servers[0]!.id, enabled: false });
    expect(await names()).not.toContain("mcp__picker__echo");
    expect(await rpcCode(rpc(null).preferences.listPermissionTools({}))).toBe(
      Code.InvalidArgument,
    );
  } finally {
    mcp.close();
  }
});
