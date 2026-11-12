import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Icon } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const MCP_TEST_TOKEN = "test-token";
export const MCP_CONFIDENTIAL_CLIENT_ID = "pre-registered-client";
export const MCP_CONFIDENTIAL_CLIENT_SECRET = "super-secret-client-value";

async function serveMcpTools(request: Request, icons?: Icon[]) {
  const mcp = new McpServer({ name: "test", version: "1.0.0", icons });
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
}

/** A stateless Streamable HTTP MCP server that requires a bearer token. */
export function startMcpTestServer(icons?: Icon[]) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${MCP_TEST_TOKEN}`)
        return new Response("Unauthorized", { status: 401 });
      return serveMcpTools(request, icons);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    close: () => server.stop(true),
  };
}

/** An OAuth 2.1 + MCP resource server with RFC 9728, RFC 8414, DCR, PKCE S256, refresh rotation, client_credentials, and revocation. */
export function startOAuthMcpTestServer() {
  const dynamicClients = new Map<string, string[]>();
  const authCodes = new Map<
    string,
    {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      scope: string;
    }
  >();
  const accessTokens = new Map<
    string,
    { clientId: string; scope: string; valid: boolean }
  >();
  const refreshTokens = new Map<
    string,
    { clientId: string; scope: string; usedOrRevoked: boolean }
  >();
  const revokedTokens: Array<{ token: string; hint: string | null }> = [];
  let registrations = 0;
  let refreshes = 0;
  let seq = 0;
  let expiresInSeconds = 3600;

  const checkConfidentialAuth = (
    request: Request,
    form: URLSearchParams,
    clientId: string,
  ): boolean => {
    const basic = request.headers.get("authorization");
    if (basic?.startsWith("Basic ")) {
      const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
      return (
        decoded ===
        `${MCP_CONFIDENTIAL_CLIENT_ID}:${MCP_CONFIDENTIAL_CLIENT_SECRET}`
      );
    }
    return (
      clientId === MCP_CONFIDENTIAL_CLIENT_ID &&
      form.get("client_secret") === MCP_CONFIDENTIAL_CLIENT_SECRET
    );
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const origin = url.origin;
      const mcpUrl = `${origin}/mcp`;
      const prmUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;

      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        return Response.json({
          resource: mcpUrl,
          authorization_servers: [origin],
          scopes_supported: ["mcp:tools"],
        });
      }

      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          revocation_endpoint: `${origin}/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: [
            "authorization_code",
            "refresh_token",
            "client_credentials",
          ],
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_basic",
            "client_secret_post",
          ],
          revocation_endpoint_auth_methods_supported: [
            "none",
            "client_secret_basic",
          ],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["mcp:tools"],
        });
      }

      if (url.pathname === "/register" && request.method === "POST") {
        registrations += 1;
        const body = (await request.json()) as { redirect_uris?: string[] };
        const clientId = `dyn-client-${registrations}`;
        const redirectUris = body.redirect_uris ?? [];
        dynamicClients.set(clientId, redirectUris);
        return Response.json(
          {
            client_id: clientId,
            redirect_uris: redirectUris,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          },
          { status: 201 },
        );
      }

      if (url.pathname === "/token" && request.method === "POST") {
        const form = new URLSearchParams(await request.text());
        const grantType = form.get("grant_type");
        const basic = request.headers.get("authorization");
        const basicClientId = basic?.startsWith("Basic ")
          ? Buffer.from(basic.slice(6), "base64").toString("utf8").split(":")[0]
          : undefined;
        const clientId = form.get("client_id") ?? basicClientId ?? "";

        if (clientId === MCP_CONFIDENTIAL_CLIENT_ID) {
          if (!checkConfidentialAuth(request, form, clientId)) {
            return Response.json({ error: "invalid_client" }, { status: 401 });
          }
        } else if (!dynamicClients.has(clientId)) {
          return Response.json({ error: "invalid_client" }, { status: 401 });
        }

        if (grantType === "authorization_code") {
          const code = form.get("code") ?? "";
          const record = authCodes.get(code);
          authCodes.delete(code);
          const verifier = form.get("code_verifier") ?? "";
          const redirectUri = form.get("redirect_uri") ?? "";
          if (!record || record.clientId !== clientId) {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          if (record.redirectUri !== redirectUri) {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          const challenge = createHash("sha256")
            .update(verifier)
            .digest("base64url");
          if (challenge !== record.codeChallenge) {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          seq += 1;
          const accessToken = `oauth-access-${seq}`;
          const refreshToken = `oauth-refresh-${seq}`;
          accessTokens.set(accessToken, {
            clientId,
            scope: record.scope,
            valid: true,
          });
          refreshTokens.set(refreshToken, {
            clientId,
            scope: record.scope,
            usedOrRevoked: false,
          });
          return Response.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: expiresInSeconds,
            refresh_token: refreshToken,
            scope: record.scope,
          });
        }

        if (grantType === "refresh_token") {
          refreshes += 1;
          const incoming = form.get("refresh_token") ?? "";
          const record = refreshTokens.get(incoming);
          if (!record || record.usedOrRevoked || record.clientId !== clientId) {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          record.usedOrRevoked = true;
          seq += 1;
          const accessToken = `oauth-access-${seq}`;
          const refreshToken = `oauth-refresh-${seq}`;
          accessTokens.set(accessToken, {
            clientId,
            scope: record.scope,
            valid: true,
          });
          refreshTokens.set(refreshToken, {
            clientId,
            scope: record.scope,
            usedOrRevoked: false,
          });
          return Response.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: expiresInSeconds,
            refresh_token: refreshToken,
            scope: record.scope,
          });
        }

        if (grantType === "client_credentials") {
          if (clientId !== MCP_CONFIDENTIAL_CLIENT_ID) {
            return Response.json(
              { error: "unauthorized_client" },
              { status: 400 },
            );
          }
          const scope = form.get("scope") || "mcp:tools";
          seq += 1;
          const accessToken = `oauth-cc-access-${seq}`;
          accessTokens.set(accessToken, { clientId, scope, valid: true });
          return Response.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: expiresInSeconds,
            scope,
          });
        }

        return Response.json(
          { error: "unsupported_grant_type" },
          { status: 400 },
        );
      }

      if (url.pathname === "/revoke" && request.method === "POST") {
        const form = new URLSearchParams(await request.text());
        const token = form.get("token") ?? "";
        revokedTokens.push({
          token,
          hint: form.get("token_type_hint"),
        });
        const refresh = refreshTokens.get(token);
        if (refresh) refresh.usedOrRevoked = true;
        const access = accessTokens.get(token);
        if (access) access.valid = false;
        return new Response(null, { status: 200 });
      }

      if (url.pathname === "/mcp") {
        const header = request.headers.get("authorization");
        const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
        const record = accessTokens.get(bearer);
        if (!record?.valid) {
          return new Response("Unauthorized", {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${prmUrl}", scope="mcp:tools"`,
            },
          });
        }
        return serveMcpTools(request);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    get registrations() {
      return registrations;
    },
    get refreshes() {
      return refreshes;
    },
    revokedTokens,
    setExpiresIn(seconds: number) {
      expiresInSeconds = seconds;
    },
    invalidateAccessTokens() {
      for (const entry of accessTokens.values()) {
        entry.valid = false;
      }
    },
    approveAuthorization(authorizationUrl: string): string {
      const parsed = new URL(authorizationUrl);
      const clientId = parsed.searchParams.get("client_id") ?? "";
      const redirectUri = parsed.searchParams.get("redirect_uri") ?? "";
      const state = parsed.searchParams.get("state") ?? "";
      const codeChallenge = parsed.searchParams.get("code_challenge") ?? "";
      const method = parsed.searchParams.get("code_challenge_method");
      if (method !== "S256" || !codeChallenge) {
        throw new Error("Expected PKCE S256 challenge");
      }
      const scope = parsed.searchParams.get("scope") || "mcp:tools";
      seq += 1;
      const code = `auth-code-${seq}`;
      authCodes.set(code, { clientId, redirectUri, codeChallenge, scope });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      if (state) callback.searchParams.set("state", state);
      return callback.toString();
    },
    close: () => server.stop(true),
  };
}
