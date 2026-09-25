import { type Page, expect, test } from "@playwright/test";

async function mockApp(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/settings/environment") {
      await route.fulfill({
        json: {
          ollamaHost: false,
          comfyuiHost: false,
          searxngHost: false,
          openrouterApiKey: false,
        },
      });
      return;
    }
    if (path === "/api/usage" || path === "/api/settings/openrouter/catalog") {
      await route.fulfill({
        status: 503,
        json: { error: "Usage unavailable" },
      });
      return;
    }
    const json =
      path === "/api/sessions"
        ? {
            sessions: ["a", "b"].map((id) => ({
              id,
              preview: `Conversation ${id}`,
              createdAt: 1,
              updatedAt: 1,
            })),
          }
        : /^\/api\/sessions\/[ab]$/.test(path)
          ? {
              id: path.split("/").at(-1),
              model: "test",
              history: [
                { role: "user", content: `Stored ${path.split("/").at(-1)}` },
              ],
            }
          : path === "/api/models"
            ? {
                models: [
                  {
                    id: "test",
                    name: "Test",
                    lab: "Test",
                    provider: "ollama",
                    inputCapabilities: ["text"],
                  },
                ],
              }
            : path.endsWith("/health")
              ? { connected: true }
              : path.startsWith("/api/runs/active/")
                ? { active: false }
                : path === "/api/skills"
                  ? { skills: [] }
                  : path === "/api/settings/openrouter"
                    ? {
                        apiKeyConfigured: false,
                        enabledModels: [],
                        favoriteModels: [],
                        ignoredPublishers: [],
                      }
                    : {};
    await route.fulfill({ json });
  });
}

test("view navigation desktop preserves Back, Forward, reload, tabs and sidebar preference", async ({
  page,
}) => {
  await mockApp(page);
  await page.goto("/run/a");
  await page
    .getByRole("button", { name: /Conversation b/ })
    .first()
    .click();
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/run\/b$/);
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Chats" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ollama", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/ollama$/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Test connection", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.reload();
  await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
  for (const view of ["Customization", "Usage"]) {
    await page
      .getByRole("button", {
        name: view === "Usage" ? "Usage insights" : view,
        exact: true,
      })
      .click();
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: view === "Usage" ? "Usage insights" : view,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to chat" }).click();
    await expect(
      page.getByRole("complementary", { name: "Chats" }),
    ).toBeVisible();
  }
  expect(
    await page.evaluate(() => localStorage.getItem("euler:sidebarCollapsed")),
  ).not.toBe("true");
});

test("view navigation desktop keeps unsaved settings on Back and resumes approved departure", async ({
  page,
}) => {
  await mockApp(page);
  await page.goto("/run/a");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByPlaceholder("Enter your name").fill("Unsaved");
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page
    .getByRole("button", { name: "Keep editing", exact: true })
    .last()
    .click();
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue("Unsaved");
  await page.goBack();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/run\/a$/);
  await page.goForward();
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue("");
  await page.getByPlaceholder("Enter your name").fill("Saved");
  await page.goBack();
  await page.getByRole("button", { name: "Save & leave" }).click();
  await expect(page).toHaveURL(/\/run\/a$/);
  await page.goForward();
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue("Saved");
});

test("view navigation desktop opens fresh view links without replacing them with the saved chat", async ({
  page,
}) => {
  await mockApp(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("activeSessionId", "b"),
  );
  for (const [path, heading] of [
    ["/settings/openrouter", "Settings"],
    ["/customization", "Customization"],
    ["/usage", "Usage insights"],
  ]) {
    await page.goto(path!);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to chat" }).click();
    await expect(page).toHaveURL(/\/run\/b$/);
    await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
  }
});

test("view navigation desktop keeps settings open when Save and leave fails", async ({
  page,
}) => {
  await mockApp(page);
  await page.route("**/api/ollama/config", (route) =>
    route.fulfill({ status: 500, json: { error: "Unavailable" } }),
  );
  await page.goto("/run/a");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Ollama", exact: true }).click();
  await page.getByRole("textbox").fill("http://changed.test");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByRole("button", { name: "Save & leave" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/ollama$/);
  await page
    .getByRole("button", { name: "Keep editing", exact: true })
    .last()
    .click();
  await expect(page.getByText("Failed to save Ollama URL")).toBeVisible();
});

test("view navigation desktop remembers General after Choose models and preserves a collapsed sidebar", async ({
  page,
}) => {
  await mockApp(page);
  await page.goto("/run/a");
  await page.getByRole("button", { name: "Toggle chats" }).click();
  await expect(
    page.getByRole("button", { name: "Toggle chats" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Model: Test", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose models", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/openrouter$/);
  await expect(
    page.getByRole("heading", { name: /OpenRouter API key/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page.reload();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByText("Stored a", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Toggle chats" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(() => localStorage.getItem("euler:sidebarCollapsed")),
  ).toBe("true");
});

test("view navigation desktop stays in Settings when a pending new chat finishes", async ({
  page,
}) => {
  await mockApp(page);
  const created = Promise.withResolvers<void>();
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await created.promise;
    await route.fulfill({ json: { id: "b" } });
  });
  await page.goto("/run/a");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByPlaceholder("Enter your name").fill("Keep this draft");
  const loaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/sessions/b",
  );
  created.resolve();
  await loaded;
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue(
    "Keep this draft",
  );
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
});

test("view navigation desktop protects dirty settings after a markdown footnote history entry", async ({
  page,
}) => {
  await mockApp(page);
  await page.route("**/api/sessions/a", (route) =>
    route.fulfill({
      json: {
        id: "a",
        model: "test",
        history: [
          {
            role: "assistant",
            content: "A note[^1].\n\n[^1]: Footnote content.",
          },
        ],
      },
    }),
  );
  await page.goto("/run/a");
  await page.getByRole("link", { name: "1", exact: true }).click();
  await expect(page).toHaveURL(/#user-content-fn-1$/);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByPlaceholder("Enter your name").fill("Unsaved");
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page
    .getByRole("button", { name: "Keep editing", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Ollama", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/ollama$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page.goBack();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/run\/a#user-content-fn-1$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/general$/);
});

test("view navigation desktop restores the saved chat when loading Home", async ({
  page,
}) => {
  await mockApp(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("activeSessionId", "b"),
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/run\/b$/);
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
});
