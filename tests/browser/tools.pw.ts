import { expect, test } from "@playwright/test";
import {
  McpServerOAuth_GrantType,
  type McpServerSchema,
  McpServerService,
} from "../../src/gen/euler/v1/mcp_pb";
import type { UserPreferences } from "../../src/schemas/userPreferences";
import { type Init, at } from "./appFixture";
import { RpcFailure, mockRpc, on } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
});

test("tools desktop: paste a config, surface errors, and list server tools", async ({
  page,
}) => {
  const server: Init<typeof McpServerSchema> = {
    id: "server-1",
    name: "linear",
    url: "https://mcp.linear.app/mcp",
    headerNames: ["Authorization"],
    enabled: true,
    createdAt: at(1),
    updatedAt: at(1),
  };
  await mockRpc(
    page,
    [
      on(McpServerService.method.createServers, ({ config }) => {
        const { mcpServers } = JSON.parse(config) as {
          mcpServers: Record<string, { command?: string }>;
        };
        if (mcpServers.files?.command)
          return new RpcFailure(
            "invalid_argument",
            "local (command) servers are not supported; use a remote server url",
            "INVALID_REQUEST",
          );
        return { servers: [server] };
      }),
      on(McpServerService.method.testServer, ({ id }) =>
        id === server.id
          ? {
              result: {
                case: "connected" as const,
                value: {
                  tools: [{ name: "list_issues" }, { name: "create_issue" }],
                },
              },
            }
          : undefined,
      ),
    ],
    { empty: true },
  );
  await mockUserPreferences(page);

  await page.goto("/customization");
  await page.getByRole("button", { name: "Tools" }).click();
  await expect(page.getByText("No MCP servers yet.")).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const config = page.getByLabel("MCP server config");
  const add = page.getByRole("dialog").getByRole("button", { name: "Add" });
  await config.fill("{ not json");
  await add.click();
  await expect(page.getByText("Config is not valid JSON")).toBeVisible();

  await config.fill(
    JSON.stringify({ mcpServers: { files: { command: "npx" } } }),
  );
  await add.click();
  await expect(
    page.getByText("local (command) servers are not supported"),
  ).toBeVisible();
  await expect(config).toHaveAttribute("aria-invalid", "true");

  await config.fill(
    JSON.stringify({ mcpServers: { linear: { url: server.url } } }),
  );
  await add.click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("headers: Authorization")).toBeVisible();

  // Tools load without a manual check.
  await expect(
    page.getByRole("list", { name: "Tools" }).getByRole("listitem"),
  ).toHaveText(["list_issues", "create_issue"]);
});

test("tools desktop: authorize MCP server via BroadcastChannel callback and disconnect", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });

  let connected = false;
  let capturedOrigin = "";
  const makeServer = (): Init<typeof McpServerSchema> => ({
    id: "server-oauth",
    name: "notion",
    url: "https://mcp.notion.com/mcp",
    headerNames: [],
    enabled: true,
    createdAt: at(1),
    updatedAt: at(1),
    ...(connected
      ? {
          oauth: {
            connected: true,
            configured: false,
            grantType: McpServerOAuth_GrantType.AUTHORIZATION_CODE,
            hasClientSecret: false,
            scopes: ["mcp:tools"],
          },
        }
      : {}),
  });

  await mockRpc(
    page,
    [
      on(McpServerService.method.listServers, () => ({
        servers: [makeServer()],
      })),
      on(McpServerService.method.testServer, () =>
        connected
          ? {
              result: {
                case: "connected" as const,
                value: {
                  tools: [{ name: "search_pages" }, { name: "read_page" }],
                },
              },
              authorizationRequired: false,
            }
          : {
              result: {
                case: "error" as const,
                value: "Authorization required",
              },
              authorizationRequired: true,
            },
      ),
      on(McpServerService.method.startServerOAuth, ({ redirectOrigin }) => {
        capturedOrigin = redirectOrigin ?? "";
        return {
          authorizationUrl:
            "https://auth.notion.com/authorize?client_id=dyn-1&state=s1",
          redirectUri: "http://127.0.0.1:5199/api/mcp/oauth/callback",
          server: makeServer(),
        };
      }),
      on(McpServerService.method.disconnectServerOAuth, () => {
        connected = false;
        return { server: makeServer(), revoked: true };
      }),
    ],
    { empty: true },
  );
  await mockUserPreferences(page);

  await page.goto("/customization");
  await page.getByRole("button", { name: "Tools" }).click();

  await expect(page.getByText("Authorization required.")).toBeVisible();
  await page.getByRole("button", { name: "Authorize" }).click();
  expect(capturedOrigin).toBe("http://127.0.0.1:5199");

  await expect(
    page.getByRole("link", { name: "Open sign-in page" }),
  ).toHaveAttribute(
    "href",
    "https://auth.notion.com/authorize?client_id=dyn-1&state=s1",
  );

  // Simulate popup completing GET /api/mcp/oauth/callback and posting on BroadcastChannel.
  connected = true;
  await page.evaluate(() => {
    const channel = new BroadcastChannel("euler:mcp-oauth");
    channel.postMessage({
      type: "euler:mcp-oauth",
      serverId: "server-oauth",
      ok: true,
      error: null,
    });
    channel.close();
  });

  await expect(
    page.getByRole("list", { name: "Tools" }).getByRole("listitem"),
  ).toHaveText(["search_pages", "read_page"]);
  await expect(page.getByText("OAuth connected")).toBeVisible();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Authorization required.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize" })).toBeVisible();
});

test("tools desktop: finish MCP OAuth by pasting callback URL and surface callback errors", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });

  let connected = false;
  const makeServer = (): Init<typeof McpServerSchema> => ({
    id: "server-paste",
    name: "sentry",
    url: "https://mcp.sentry.dev/mcp",
    headerNames: [],
    enabled: true,
    createdAt: at(1),
    updatedAt: at(1),
    oauth: {
      connected,
      configured: true,
      grantType: McpServerOAuth_GrantType.AUTHORIZATION_CODE,
      clientId: "sentry-client",
      hasClientSecret: true,
      scopes: [],
    },
  });

  await mockRpc(
    page,
    [
      on(McpServerService.method.listServers, () => ({
        servers: [makeServer()],
      })),
      on(McpServerService.method.testServer, () =>
        connected
          ? {
              result: {
                case: "connected" as const,
                value: { tools: [{ name: "list_events" }] },
              },
              authorizationRequired: false,
            }
          : {
              result: {
                case: "error" as const,
                value: "Authorization required",
              },
              authorizationRequired: true,
            },
      ),
      on(McpServerService.method.startServerOAuth, () => ({
        authorizationUrl: "https://sentry.io/oauth/authorize?state=good",
        redirectUri: "http://127.0.0.1:9321/api/mcp/oauth/callback",
        server: makeServer(),
      })),
      on(McpServerService.method.finishServerOAuth, ({ callbackUrl }) => {
        if (!callbackUrl.includes("state=good")) {
          return new RpcFailure(
            "invalid_argument",
            "OAuth session expired or state did not match",
            "INVALID_REQUEST",
          );
        }
        connected = true;
        return { server: makeServer() };
      }),
    ],
    { empty: true },
  );
  await mockUserPreferences(page);

  await page.goto("/customization");
  await page.getByRole("button", { name: "Tools" }).click();

  await page.getByRole("button", { name: "Authorize" }).click();
  const input = page.getByLabel("Callback URL for sentry");
  await input.fill(
    "http://127.0.0.1:9321/api/mcp/oauth/callback?code=abc&state=wrong",
  );
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(
    page.getByText("OAuth session expired or state did not match"),
  ).toBeVisible();

  await input.fill(
    "http://127.0.0.1:9321/api/mcp/oauth/callback?code=abc&state=good",
  );
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(
    page.getByRole("list", { name: "Tools" }).getByRole("listitem"),
  ).toHaveText(["list_events"]);
});

test("tools desktop: built-in capabilities save per user", async ({ page }) => {
  const store = new Map<string, UserPreferences>();
  await mockRpc(page, [], { empty: true });
  await mockUserPreferences(page, store);

  await page.goto("/customization");
  await page.getByRole("button", { name: "Tools" }).click();
  const imageGeneration = page.getByRole("switch", {
    name: "Image generation",
  });
  await expect(imageGeneration).toHaveAttribute("aria-checked", "true");
  await imageGeneration.click();
  await expect(imageGeneration).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() => [...store.values()][0]?.capabilities)
    .toEqual({
      web: true,
      imageGeneration: false,
      shell: true,
      files: true,
      skills: true,
    });

  await page.reload();
  await page.getByRole("button", { name: "Tools" }).click();
  await expect(
    page.getByRole("switch", { name: "Image generation" }),
  ).toHaveAttribute("aria-checked", "false");
});
