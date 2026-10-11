import "../setup";
import { expect, test } from "bun:test";
import { MCP_TEST_TOKEN, startMcpTestServer } from "../helpers/mcpServer";
import { startTestServer, userHeaders } from "../helpers/server";

const jsonHeaders = (ownerUuid?: string) =>
  userHeaders(ownerUuid, { "Content-Type": "application/json" });

test("MCP server configs are validated, user scoped, and never return header values", async () => {
  const { url, close } = await startTestServer();
  const mcp = startMcpTestServer();
  const otherUser = "22222222-2222-4222-8222-222222222222";
  try {
    const local = await fetch(`${url}/api/mcp-servers`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        mcpServers: { files: { command: "npx", args: ["server"] } },
      }),
    });
    expect(local.status).toBe(400);
    expect(await local.json()).toMatchObject({
      error: {
        message:
          "local (command) servers are not supported; use a remote server url",
      },
    });

    const config = {
      mcpServers: {
        test: {
          url: mcp.url,
          headers: { Authorization: `Bearer ${MCP_TEST_TOKEN}` },
        },
        wrong: { url: mcp.url, headers: { Authorization: "Bearer nope" } },
      },
    };
    const create = await fetch(`${url}/api/mcp-servers`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(config),
    });
    expect(create.status).toBe(201);
    const body = await create.text();
    expect(body).not.toContain(MCP_TEST_TOKEN);
    const { servers } = JSON.parse(body) as {
      servers: { id: string; name: string }[];
    };
    expect(servers).toMatchObject([
      { name: "test", headerNames: ["Authorization"], enabled: true },
      { name: "wrong" },
    ]);
    const [good, bad] = servers;
    if (!good || !bad) throw new Error("expected two servers");

    const duplicate = await fetch(`${url}/api/mcp-servers`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ mcpServers: { test: { url: mcp.url } } }),
    });
    expect(duplicate.status).toBe(409);

    const otherList = await fetch(`${url}/api/mcp-servers`, {
      headers: userHeaders(otherUser),
    });
    expect(await otherList.json()).toEqual({ servers: [] });
    const otherCheck = await fetch(`${url}/api/mcp-servers/${good.id}/check`, {
      method: "POST",
      headers: userHeaders(otherUser),
    });
    expect(otherCheck.status).toBe(404);

    const check = await fetch(`${url}/api/mcp-servers/${good.id}/check`, {
      method: "POST",
      headers: userHeaders(),
    });
    expect(await check.json()).toEqual({
      ok: true,
      tools: [
        { name: "echo", description: "Echo text." },
        { name: "fail", description: "Always fails." },
      ],
    });
    const failedCheck = await fetch(`${url}/api/mcp-servers/${bad.id}/check`, {
      method: "POST",
      headers: userHeaders(),
    });
    expect(await failedCheck.json()).toMatchObject({ ok: false });

    const disable = await fetch(`${url}/api/mcp-servers/${good.id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(await disable.json()).toMatchObject({ enabled: false });

    const remove = await fetch(`${url}/api/mcp-servers/${bad.id}`, {
      method: "DELETE",
      headers: userHeaders(),
    });
    expect(remove.status).toBe(200);
    const list = await fetch(`${url}/api/mcp-servers`, {
      headers: userHeaders(),
    });
    expect(await list.json()).toMatchObject({
      servers: [{ id: good.id, enabled: false }],
    });
  } finally {
    mcp.close();
    await close();
  }
});
