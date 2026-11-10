import "../setup";
import { expect, test } from "bun:test";
import { toBinary } from "@bufbuild/protobuf";
import { CreateServersResponseSchema } from "../../src/gen/euler/v1/mcp_pb";
import { MCP_TEST_TOKEN, startMcpTestServer } from "../helpers/mcpServer";
import { Code, rpc, rpcCode, rpcError } from "../helpers/rpc";

test("MCP server configs are validated, user scoped, and never return header values", async () => {
  const mcp = startMcpTestServer();
  const api = rpc().mcp;
  const other = rpc("22222222-2222-4222-8222-222222222222").mcp;
  try {
    const local = await rpcError(
      api.createServers({
        config: JSON.stringify({
          mcpServers: { files: { command: "npx", args: ["server"] } },
        }),
      }),
    );
    expect(local.code).toBe(Code.InvalidArgument);
    expect(local.rawMessage).toBe(
      "local (command) servers are not supported; use a remote server url",
    );
    expect(await rpcCode(api.createServers({ config: "{not json" }))).toBe(
      Code.InvalidArgument,
    );

    const created = await api.createServers({
      config: JSON.stringify({
        mcpServers: {
          test: {
            url: mcp.url,
            headers: { Authorization: `Bearer ${MCP_TEST_TOKEN}` },
          },
          wrong: { url: mcp.url, headers: { Authorization: "Bearer nope" } },
        },
      }),
    });
    expect(
      Buffer.from(toBinary(CreateServersResponseSchema, created)).toString(),
    ).not.toContain(MCP_TEST_TOKEN);
    expect(created.servers).toMatchObject([
      { name: "test", headerNames: ["Authorization"], enabled: true },
      { name: "wrong" },
    ]);
    const [good, bad] = created.servers;
    if (!good || !bad) throw new Error("expected two servers");

    expect(
      await rpcCode(
        api.createServers({
          config: JSON.stringify({ mcpServers: { test: { url: mcp.url } } }),
        }),
      ),
    ).toBe(Code.FailedPrecondition);

    expect((await other.listServers({})).servers).toEqual([]);
    expect(await rpcCode(other.testServer({ id: good.id }))).toBe(
      Code.NotFound,
    );

    const check = await api.testServer({ id: good.id });
    expect(check.result).toMatchObject({
      case: "connected",
      value: {
        icons: [],
        tools: [
          { name: "echo", description: "Echo text.", icons: [] },
          { name: "fail", description: "Always fails.", icons: [] },
        ],
      },
    });
    expect((await api.testServer({ id: bad.id })).result.case).toBe("error");

    expect((await api.listTools({})).tools).toMatchObject([
      { name: "mcp__test__echo", description: "Echo text.", icons: [] },
      { name: "mcp__test__fail", description: "Always fails.", icons: [] },
    ]);
    expect((await other.listTools({})).tools).toEqual([]);

    const disabled = await api.updateServer({ id: good.id, enabled: false });
    expect(disabled.server).toMatchObject({ enabled: false });
    expect((await api.listTools({})).tools).toEqual([]);

    await api.deleteServer({ id: bad.id });
    expect((await api.listServers({})).servers).toMatchObject([
      { id: good.id, enabled: false },
    ]);
    expect(await rpcCode(api.deleteServer({ id: bad.id }))).toBe(Code.NotFound);
  } finally {
    mcp.close();
  }
});
