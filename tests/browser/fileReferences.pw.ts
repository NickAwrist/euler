import { expect, test } from "@playwright/test";
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
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.endsWith("/workspace/files")) {
        if (failFiles)
          return route.fulfill({ status: 500, json: { error: "Failed" } });
        const query = url.searchParams.get("q")?.toLowerCase() ?? "";
        return route.fulfill({
          json: {
            files: files
              .filter((path) => path.toLowerCase().includes(query))
              .map((path) => ({
                path,
                name: path.split("/").at(-1),
                size: 10,
                modifiedAt: 1,
              })),
          },
        });
      }
      if (path.endsWith("/messages") && route.request().method() === "POST") {
        messages.push(route.request().postDataJSON());
        return route.fulfill({
          status: 202,
          json: { messageId: 1, queued: false },
        });
      }
      if (path === "/api/skills") {
        return route.fulfill({
          json: {
            skills: [
              {
                id: "review",
                name: "review",
                description: "Review code",
                instructions: "Review code",
                user_invocable: true,
                disable_model_invocation: false,
                created_at: 1,
                updated_at: 1,
              },
            ],
          },
        });
      }
      const json =
        path === "/api/models"
          ? {
              models: [
                {
                  id: "test",
                  name: "Test",
                  lab: "Ollama",
                  provider: "ollama",
                  inputCapabilities: ["text"],
                },
              ],
            }
          : path === "/api/sessions/files"
            ? {
                id: "files",
                model: "test",
                history: [],
                expiresAt: null,
                workspace: {
                  kind: "local",
                  path: "/project",
                  label: "project",
                },
              }
            : path === "/api/sessions"
              ? {
                  sessions: [
                    {
                      id: "files",
                      preview: "Files",
                      createdAt: 1,
                      updatedAt: 1,
                      expiresAt: null,
                    },
                  ],
                }
              : path.endsWith("/runtime")
                ? {
                    agents: [],
                    activation: null,
                    queued: [],
                    held: false,
                    sequence: 0,
                    history: [],
                  }
                : path.endsWith("/health")
                  ? { connected: true }
                  : {};
      await route.fulfill({ json });
    });
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
