import "../setup";
import { expect, test } from "bun:test";
import { toBinary } from "@bufbuild/protobuf";
import {
  CreateServersResponseSchema,
  ListServersResponseSchema,
  McpServerOAuth_GrantType,
} from "../../src/gen/euler/v1/mcp_pb";
import { openUserMcpTools } from "../../src/mcp/userTools";
import {
  MCP_CONFIDENTIAL_CLIENT_ID,
  MCP_CONFIDENTIAL_CLIENT_SECRET,
  MCP_TEST_TOKEN,
  startMcpTestServer,
  startOAuthMcpTestServer,
  startSseMcpTestServer,
} from "../helpers/mcpServer";
import { Code, rpc, rpcCode, rpcError } from "../helpers/rpc";
import { TEST_USER_ID, startTestServer } from "../helpers/server";

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
    const wrongCheck = await api.testServer({ id: bad.id });
    expect(wrongCheck.result.case).toBe("error");
    expect(wrongCheck.authorizationRequired).toBe(false);

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

test("MCP servers that only speak HTTP+SSE connect through the fallback transport", async () => {
  const mcp = await startSseMcpTestServer();
  const api = rpc().mcp;

  try {
    const created = await api.createServers({
      config: JSON.stringify({
        mcpServers: {
          legacy: {
            url: mcp.url,
            headers: { Authorization: `Bearer ${MCP_TEST_TOKEN}` },
          },
          unauthorized: { url: mcp.url },
        },
      }),
    });
    const [legacy, unauthorized] = created.servers;
    if (!legacy || !unauthorized) throw new Error("expected two servers");

    const check = await api.testServer({ id: legacy.id });
    if (check.result.case !== "connected") throw new Error("expected tools");
    expect(check.result.value.tools.map((tool) => tool.name)).toEqual([
      "echo",
      "fail",
    ]);

    // The SSE stream's 401 is reported, not the 405 that caused the fallback.
    const denied = await api.testServer({ id: unauthorized.id });
    expect(denied.authorizationRequired).toBe(true);

    const toolSet = await openUserMcpTools(
      TEST_USER_ID,
      new AbortController().signal,
    );
    try {
      const echo = toolSet.tools.find((t) => t.name === "mcp__legacy__echo");
      expect(await echo?.execute({ text: "hello sse" })).toEqual({
        text: "hello sse",
        failed: false,
      });
    } finally {
      await toolSet.close();
    }
  } finally {
    mcp.close();
  }
});

test("MCP OAuth supports zero-config DCR + PKCE HTTP callback, refresh rotation, and revocation", async () => {
  const oauthMcp = startOAuthMcpTestServer();
  const appServer = await startTestServer();
  const api = rpc().mcp;
  const other = rpc("33333333-3333-4333-8333-333333333333").mcp;

  try {
    const created = await api.createServers({
      config: JSON.stringify({
        mcpServers: {
          remote: { url: oauthMcp.url },
        },
      }),
    });
    const [server] = created.servers;
    if (!server) throw new Error("expected server");

    // Background TestServer detects 401 WWW-Authenticate without spamming DCR.
    const initialCheck = await api.testServer({ id: server.id });
    expect(initialCheck.result.case).toBe("error");
    expect(initialCheck.authorizationRequired).toBe(true);
    expect(oauthMcp.registrations).toBe(0);

    // Other users cannot initiate, finish, or disconnect OAuth on this server.
    expect(
      await rpcCode(
        other.startServerOAuth({
          id: server.id,
          redirectOrigin: appServer.url,
        }),
      ),
    ).toBe(Code.NotFound);
    expect(await rpcCode(other.disconnectServerOAuth({ id: server.id }))).toBe(
      Code.NotFound,
    );

    const started = await api.startServerOAuth({
      id: server.id,
      redirectOrigin: appServer.url,
    });
    expect(oauthMcp.registrations).toBe(1);
    expect(started.redirectUri).toBe(`${appServer.url}/api/mcp/oauth/callback`);
    expect(started.authorizationUrl).toContain("code_challenge_method=S256");
    expect(started.authorizationUrl).toContain("scope=mcp%3Atools");

    // Complete OAuth via the HTTP callback route (browser popup flow).
    const callbackUrl = oauthMcp.approveAuthorization(started.authorizationUrl);
    const callbackRes = await fetch(callbackUrl);
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.headers.get("cache-control")).toBe("no-store");
    const callbackHtml = await callbackRes.text();
    expect(callbackHtml).toContain("Connected to remote");
    expect(callbackHtml).toContain("euler:mcp-oauth");

    // Replaying the same callback state fails cleanly.
    const replayRes = await fetch(callbackUrl);
    expect(replayRes.status).toBe(400);

    // Tokens never leak in RPC responses.
    const listed = await api.listServers({});
    const wire = Buffer.from(
      toBinary(ListServersResponseSchema, listed),
    ).toString();
    expect(wire).not.toContain("oauth-access-");
    expect(wire).not.toContain("oauth-refresh-");
    expect(listed.servers[0]?.oauth).toMatchObject({
      configured: false,
      connected: true,
      grantType: McpServerOAuth_GrantType.AUTHORIZATION_CODE,
    });

    // Connected check and agent tool execution succeed.
    const connectedCheck = await api.testServer({ id: server.id });
    expect(connectedCheck.authorizationRequired).toBe(false);
    expect(connectedCheck.result.case).toBe("connected");

    const toolSet = await openUserMcpTools(
      TEST_USER_ID,
      new AbortController().signal,
    );
    try {
      const echo = toolSet.tools.find((t) => t.name === "mcp__remote__echo");
      expect(await echo?.execute({ text: "hello oauth" })).toEqual({
        text: "hello oauth",
        failed: false,
      });
    } finally {
      await toolSet.close();
    }

    // Reactive refresh when access token is invalidated on resource server,
    // plus single-flight lock across concurrent TestServer calls.
    oauthMcp.invalidateAccessTokens();
    const [r1, r2] = await Promise.all([
      api.testServer({ id: server.id }),
      api.testServer({ id: server.id }),
    ]);
    expect(r1.result.case).toBe("connected");
    expect(r2.result.case).toBe("connected");
    expect(oauthMcp.refreshes).toBe(1);

    // Disconnect revokes refresh token at RFC 7009 endpoint and clears local tokens.
    const disconnected = await api.disconnectServerOAuth({ id: server.id });
    expect(disconnected.revoked).toBe(true);
    expect(disconnected.server?.oauth).toBeUndefined();
    expect(oauthMcp.revokedTokens).toHaveLength(1);
    expect(oauthMcp.revokedTokens[0]?.hint).toBe("refresh_token");

    const afterDisconnect = await api.testServer({ id: server.id });
    expect(afterDisconnect.authorizationRequired).toBe(true);
  } finally {
    await appServer.close();
    oauthMcp.close();
  }
});

test("MCP OAuth callback hands the iPhone app back to its URL scheme", async () => {
  const oauthMcp = startOAuthMcpTestServer();
  const appServer = await startTestServer();
  const api = rpc().mcp;

  try {
    const created = await api.createServers({
      config: JSON.stringify({ mcpServers: { remote: { url: oauthMcp.url } } }),
    });
    const [server] = created.servers;
    if (!server) throw new Error("expected server");
    const start = () =>
      api.startServerOAuth({
        id: server.id,
        redirectOrigin: appServer.url,
        returnToApp: true,
      });

    // A refused sign-in still returns to the app, with the reason.
    const started = await start();
    const refused = new URL(started.redirectUri);
    refused.searchParams.set("error", "access_denied");
    refused.searchParams.set(
      "state",
      new URL(started.authorizationUrl).searchParams.get("state") ?? "",
    );
    const refusedRes = await fetch(refused, { redirect: "manual" });
    expect(refusedRes.status).toBe(302);
    expect(refusedRes.headers.get("location")).toBe(
      "euler://mcp-oauth?error=OAuth%20authorization%20failed%3A%20access_denied",
    );

    const callbackUrl = oauthMcp.approveAuthorization(
      (await start()).authorizationUrl,
    );
    const res = await fetch(callbackUrl, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("euler://mcp-oauth");
    expect((await api.listServers({})).servers[0]?.oauth?.connected).toBe(true);
  } finally {
    await appServer.close();
    oauthMcp.close();
  }
});

test("MCP OAuth supports pre-registered confidential clients, manual FinishServerOAuth, and client_credentials", async () => {
  const oauthMcp = startOAuthMcpTestServer();
  const api = rpc().mcp;

  try {
    const created = await api.createServers({
      config: JSON.stringify({
        mcpServers: {
          confidential: {
            url: oauthMcp.url,
            oauth: {
              clientId: MCP_CONFIDENTIAL_CLIENT_ID,
              clientSecret: MCP_CONFIDENTIAL_CLIENT_SECRET,
              scopes: ["mcp:tools"],
            },
          },
          m2m: {
            url: oauthMcp.url,
            oauth: {
              grantType: "client_credentials",
              clientId: MCP_CONFIDENTIAL_CLIENT_ID,
              clientSecret: MCP_CONFIDENTIAL_CLIENT_SECRET,
              scopes: ["mcp:tools"],
            },
          },
        },
      }),
    });

    const wire = Buffer.from(
      toBinary(CreateServersResponseSchema, created),
    ).toString();
    expect(wire).not.toContain(MCP_CONFIDENTIAL_CLIENT_SECRET);

    const [confidential, m2m] = created.servers;
    if (!confidential || !m2m) throw new Error("expected two servers");

    expect(confidential.oauth).toMatchObject({
      configured: true,
      connected: false,
      grantType: McpServerOAuth_GrantType.AUTHORIZATION_CODE,
    });
    expect(m2m.oauth).toMatchObject({
      configured: true,
      connected: false,
      grantType: McpServerOAuth_GrantType.CLIENT_CREDENTIALS,
    });

    // Non-HTTPS non-loopback LAN origins fall back to loopback for RFC 8252 compliance,
    // while HTTPS origins use the HTTPS origin directly.
    const lanStarted = await api.startServerOAuth({
      id: confidential.id,
      redirectOrigin: "http://spaceheater:8194",
    });
    expect(lanStarted.redirectUri).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/api\/mcp\/oauth\/callback$/,
    );

    // Confidential authorization_code flow via manual callback URL paste.
    oauthMcp.setExpiresIn(5); // Near-expiry triggers proactive refresh on next connect.
    const started = await api.startServerOAuth({
      id: confidential.id,
      redirectOrigin: "https://euler.example.com",
    });
    expect(oauthMcp.registrations).toBe(0);
    expect(started.redirectUri).toBe(
      "https://euler.example.com/api/mcp/oauth/callback",
    );

    const badFinish = await rpcError(
      api.finishServerOAuth({
        id: confidential.id,
        callbackUrl:
          "https://euler.example.com/api/mcp/oauth/callback?code=x&state=wrong",
      }),
    );
    expect(badFinish.code).toBe(Code.InvalidArgument);

    const callbackUrl = oauthMcp.approveAuthorization(started.authorizationUrl);
    const finished = await api.finishServerOAuth({
      id: confidential.id,
      callbackUrl,
    });
    expect(finished.server?.oauth?.connected).toBe(true);

    // Near-expiry token refreshes proactively during TestServer.
    oauthMcp.setExpiresIn(3600);
    const confCheck = await api.testServer({ id: confidential.id });
    expect(confCheck.result.case).toBe("connected");
    expect(oauthMcp.refreshes).toBe(1);

    // client_credentials connects automatically without interactive authorizationUrl.
    const m2mCheck = await api.testServer({ id: m2m.id });
    expect(m2mCheck.result.case).toBe("connected");
    expect(m2mCheck.authorizationRequired).toBe(false);

    const m2mStarted = await api.startServerOAuth({ id: m2m.id });
    expect(m2mStarted.authorizationUrl).toBe("");
    expect(m2mStarted.server?.oauth?.connected).toBe(true);
  } finally {
    oauthMcp.close();
  }
});
