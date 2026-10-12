import { expect, test } from "@playwright/test";
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
    const history = [
      {
        role: "assistant",
        content: "Echoed hello.",
        steps: [
          {
            kind: "tool_call",
            status: "done",
            toolName: "mcp__removed__echo",
            toolIcons: icons,
            result: "hello",
          },
          {
            kind: "tool_call",
            status: "done",
            toolName: "mcp__old__echo",
            result: "Legacy MCP call",
          },
          {
            kind: "tool_call",
            status: "done",
            toolName: "bash",
            result: "Built-in call",
          },
        ],
      },
    ];
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (path === "/api/mcp-servers")
        json = {
          servers: [
            {
              id: "test",
              name: "test",
              url: "https://mcp.example",
              headerNames: [],
              enabled: true,
              created_at: 1,
              updated_at: 1,
            },
          ],
        };
      if (path === "/api/mcp-servers/test/check")
        json = {
          ok: true,
          icons,
          tools: [
            { name: "echo", icons },
            {
              name: "broken",
              icons: [{ src: "data:image/png;base64,broken" }],
            },
          ],
        };
      if (path === "/api/mcp-servers/tools")
        json = {
          tools: [{ name: "mcp__test__echo", description: "Echo text", icons }],
        };
      if (path === "/api/sessions/icons")
        json = {
          id: "icons",
          model: "test",
          expiresAt: null,
          history,
        };
      if (path === "/api/sessions")
        json = {
          sessions: [
            {
              id: "icons",
              preview: "Icons",
              createdAt: 1,
              updatedAt: 1,
              expiresAt: null,
            },
          ],
        };
      if (path.endsWith("/health")) json = { connected: true };
      if (path === "/api/models")
        json = {
          models: [
            {
              id: "test",
              name: "Test",
              lab: "Ollama",
              provider: "ollama",
              inputCapabilities: ["text"],
            },
          ],
        };
      if (path.endsWith("/runtime"))
        json = {
          agents: [],
          activation: null,
          queued: [],
          held: false,
          sequence: 0,
          history,
        };
      return route.fulfill({ json });
    });
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
