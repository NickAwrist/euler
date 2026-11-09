import { expect, test } from "@playwright/test";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import { McpServerService } from "../../src/gen/euler/v1/mcp_pb";
import { SkillService } from "../../src/gen/euler/v1/skills_pb";
import { WorkspaceService } from "../../src/gen/euler/v1/workspace_pb";
import { at, mockApp, ollamaModel } from "./appFixture";
import { RpcFailure, mockRpc, on } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

for (const device of ["desktop", "mobile"] as const) {
  test(`file references ${device}: autocomplete, dismissal, and sending`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      baseURL: testInfo.project.use.baseURL,
      viewport:
        device === "desktop"
          ? { width: 1280, height: 800 }
          : { width: 390, height: 844 },
      isMobile: device === "mobile",
      hasTouch: device === "mobile",
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "euler:userUuid",
        "12345678-1234-4234-9234-123456789abc",
      );
    });
    const files = ["src/index.ts", "src/server.ts", "docs/notes one.md"];
    const messages: { content: string }[] = [];
    let failFiles = false;
    let failTools = false;
    await mockApp(page, {
      sessions: [
        { id: "files", preview: "Files", createdAt: at(1), updatedAt: at(1) },
      ],
      chats: {
        files: {
          model: "test",
          workspace: {
            kind: {
              case: "local",
              value: { path: "/project", label: "project" },
            },
          },
        },
      },
      models: [ollamaModel("test", { name: "Test" })],
    });
    await mockRpc(page, [
      on(McpServerService.method.listTools, () =>
        failTools
          ? new RpcFailure("internal", "Failed")
          : {
              tools: [
                {
                  name: "mcp__test__echo",
                  description: "Echo text",
                  icons: [
                    {
                      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X0AAAAASUVORK5CYII=",
                    },
                  ],
                },
                {
                  name: "mcp__test__fail",
                  description: "Fail",
                  icons: [{ src: "data:image/png;base64,broken" }],
                },
              ],
            },
      ),
      on(WorkspaceService.method.listFiles, ({ query }) => {
        if (failFiles) return new RpcFailure("internal", "Failed");
        const search = query?.toLowerCase() ?? "";
        return {
          files: files
            .filter((path) => path.toLowerCase().includes(search))
            .map((path) => ({
              path,
              name: path.split("/").at(-1),
              size: 10n,
              modifiedAt: at(1),
            })),
        };
      }),
      on(AgentService.method.sendMessage, ({ content }) => {
        messages.push({ content });
        return { messageId: 1n, queued: false };
      }),
      on(SkillService.method.listSkills, () => ({
        skills: [
          {
            id: "review",
            name: "review",
            description: "Review code",
            instructions: "Review code",
            userInvocable: true,
            disableModelInvocation: false,
            createdAt: at(1),
            updatedAt: at(1),
          },
        ],
      })),
    ]);
    try {
      await mockUserPreferences(page);
      await page.goto("/run/files");
      const input = page.getByPlaceholder("Send a message...");
      const picker = page.locator("#file-picker");
      await input.fill("Check @src");
      await expect(picker.getByRole("button")).toHaveCount(2);
      await expect(input).toHaveAttribute("aria-controls", "file-picker");
      await input.press("ArrowDown");
      await input.press("Enter");
      await expect(input).toHaveValue("Check @src/server.ts ");
      await expect(input).toBeFocused();
      expect(messages).toHaveLength(0);
      await expect(picker).toBeHidden();
      await input.fill("@src");
      await expect(picker.getByRole("button")).toHaveCount(2);
      await input.press("Tab");
      await expect(input).toHaveValue("@src/index.ts ");
      await input.fill("Read @notes");
      await picker
        .getByRole("button", { name: "@docs/notes one.md", exact: true })
        .click();
      await expect(input).toHaveValue('Read @"docs/notes one.md" ');
      await expect(input).toBeFocused();
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect.poll(() => messages.length).toBe(1);
      expect(messages[0]?.content).toBe('Read @"docs/notes one.md"');
      await input.fill("@");
      await expect(picker.getByRole("button")).toHaveCount(3);
      const bounds = (await picker.boundingBox())!;
      const formBounds = (await input
        .locator("xpath=ancestor::form")
        .boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(formBounds.width);
      await input.press("Escape");
      await expect(picker).toBeHidden();
      await expect(input).toHaveValue("@");
      await input.fill("nick@example.com");
      await expect(picker).toBeHidden();
      await input.fill("@missing");
      await expect(picker.getByText("No matching files")).toBeVisible();
      await input.press("Escape");
      await expect(picker).toBeHidden();
      await input.fill("Use $rev");
      await expect(page.locator("#skill-picker")).toBeVisible();
      await expect(picker).toBeHidden();
      await input.press("Tab");
      await expect(input).toHaveValue("Use $review ");
      const integrations = page.locator("#command-picker");
      await input.fill("/");
      await expect(
        integrations.getByRole("button", { name: /\/directory/ }),
      ).toBeVisible();
      await expect(
        integrations.getByRole("button", { name: /mcp__test__echo/ }),
      ).toBeVisible();
      await expect(integrations.locator("img").first()).toBeVisible();
      await expect(integrations.locator(".lucide-plug")).toBeVisible();
      await input.fill("Use /echo");
      await expect(integrations.getByRole("button")).toHaveCount(1);
      await input.press("Tab");
      await expect(input).toHaveValue("Use /mcp__test__echo ");
      await expect(input).toBeFocused();
      await expect(integrations).toBeHidden();
      expect(messages).toHaveLength(1);
      await input.fill("Use /mcp__test__echo hello");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect.poll(() => messages.length).toBe(2);
      expect(messages[1]?.content).toBe("Use /mcp__test__echo hello");
      await input.fill("/fail");
      await expect(integrations.getByRole("button")).toHaveCount(1);
      await input.press("Escape");
      await expect(integrations).toBeHidden();
      await expect(input).toHaveValue("/fail");
      failTools = true;
      await input.fill("/echo");
      await expect(
        integrations.getByText("Could not load MCP tools"),
      ).toBeVisible();
      await input.press("Escape");
      failTools = false;
      failFiles = true;
      await input.fill("@error");
      await expect(
        picker.getByText("Could not load workspace files"),
      ).toBeVisible();
      await input.press("Escape");
      await expect(picker).toBeHidden();
    } finally {
      await page.close();
    }
  });
}
