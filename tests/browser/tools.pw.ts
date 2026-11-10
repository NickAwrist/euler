import { expect, test } from "@playwright/test";
import {
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
