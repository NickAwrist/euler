import { expect, test } from "@playwright/test";
import { McpServerService } from "../../src/gen/euler/v1/mcp_pb";
import { Step_Kind, Step_Status } from "../../src/gen/euler/v1/steps_pb";
import { at, message, mockApp, ollamaModel } from "./appFixture";
import { mockRpc, on } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

const src =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X0AAAAASUVORK5CYII=";
const icons = [{ src }];

for (const device of ["desktop", "mobile"] as const) {
  test(`file references ${device}: MCP icons are shared by tools, composer, and historical traces`, async ({
    page,
  }) => {
    await page.setViewportSize(
      device === "desktop"
        ? { width: 1280, height: 800 }
        : { width: 390, height: 844 },
    );
    await page.addInitScript(() =>
      localStorage.setItem(
        "euler:userUuid",
        "12345678-1234-4234-9234-123456789abc",
      ),
    );
    const step = (toolName: string, result: string, toolIcons = icons) => ({
      kind: Step_Kind.TOOL_CALL,
      status: Step_Status.DONE,
      toolName,
      toolIcons,
      result,
    });
    await mockApp(page, {
      sessions: [
        { id: "icons", preview: "Icons", createdAt: at(1), updatedAt: at(1) },
      ],
      chats: {
        icons: {
          model: "test",
          history: [
            message("assistant", "Echoed hello.", {
              steps: [
                step("mcp__removed__echo", "hello"),
                step("mcp__old__echo", "Legacy MCP call", []),
                step("bash", "Built-in call", []),
              ],
            }),
          ],
        },
      },
      models: [ollamaModel("test", { name: "Test" })],
    });
    await mockRpc(page, [
      on(McpServerService.method.listServers, () => ({
        servers: [
          {
            id: "test",
            name: "test",
            url: "https://mcp.example",
            enabled: true,
            createdAt: at(1),
            updatedAt: at(1),
          },
        ],
      })),
      on(McpServerService.method.testServer, () => ({
        result: {
          case: "connected" as const,
          value: {
            icons,
            tools: [
              { name: "echo", icons },
              {
                name: "broken",
                icons: [{ src: "data:image/png;base64,broken" }],
              },
            ],
          },
        },
      })),
      on(McpServerService.method.listTools, () => ({
        tools: [{ name: "mcp__test__echo", description: "Echo text", icons }],
      })),
    ]);
    await mockUserPreferences(page);
    await page.goto("/customization/tools");
    const tools = page.locator("section[aria-labelledby='mcp-servers']");
    await expect(tools.locator("img")).toHaveCount(2);
    await expect(
      tools
        .getByRole("listitem")
        .filter({ hasText: "broken" })
        .locator(".lucide-plug"),
    ).toBeVisible();
    expect(await tools.locator("img").first().getAttribute("src")).toBe(src);

    await page.goto("/run/icons");
    const input = page.getByPlaceholder("Send a message...");
    await input.fill("/echo");
    await expect(page.locator("#command-picker img")).toHaveAttribute(
      "src",
      src,
    );
    await input.press("Escape");
    const traceButton = page.getByRole("button", {
      name: "View trace",
      exact: true,
    });
    if (!(await traceButton.isVisible())) {
      await page
        .getByRole("button", { name: "More message actions", exact: true })
        .last()
        .click();
    }
    await page.getByRole("button", { name: "View trace", exact: true }).click();
    const trace = page.getByRole("dialog", {
      name: "Execution Trace",
      exact: true,
    });
    await expect(trace.locator("img")).toHaveAttribute("src", src);
    await expect(trace.locator(".lucide-plug")).toHaveCount(1);
    await expect(trace.locator(".lucide-wrench")).toHaveCount(1);
  });
}
