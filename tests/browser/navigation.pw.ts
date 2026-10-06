import { type Page, expect, test } from "@playwright/test";
import { mockUserPreferences } from "./userPreferencesFixture";

// These checks exercise returning users; first-visit setup has its own suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
});

async function mockApp(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/settings/environment") {
      await route.fulfill({
        json: {
          ollamaHost: false,
          comfyuiHost: false,
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
              expiresAt: null,
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
              : path.endsWith("/runtime")
                ? {
                    agents: [],
                    activation: null,
                    queued: [],
                    held: false,
                    sequence: 0,
                    history: [
                      {
                        role: "user",
                        content: `Stored ${path.split("/").at(-2)}`,
                      },
                    ],
                  }
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
  await mockUserPreferences(page);
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
  await expect(page.getByText("Default Model", { exact: true })).toBeVisible();
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
    await page.evaluate(async () =>
      String(
        (await (await fetch("/api/settings/user")).json()).layout
          .sidebarCollapsed,
      ),
    ),
  ).not.toBe("true");
});

test("view navigation desktop keeps unsaved customization on Back and resumes approved departure", async ({
  page,
}) => {
  await mockApp(page);
  await mockUserPreferences(page);
  await page.goto("/run/a");
  await page
    .getByRole("button", { name: "Customization", exact: true })
    .click();
  await page.getByPlaceholder("Enter your name").fill("Unsaved");
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/customization$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/customization$/);
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
    await mockUserPreferences(page);
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
    route.fulfill({
      status: 500,
      json: { error: { code: "INTERNAL_ERROR", message: "Unavailable" } },
    }),
  );
  await mockUserPreferences(page);
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
  // The server's reason is shown; "Failed to save Ollama URL" is only the fallback.
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
});

test("view navigation desktop remembers General after Choose models and preserves a collapsed sidebar", async ({
  page,
}) => {
  await mockApp(page);
  await mockUserPreferences(page);
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
  await expect(page.getByText("Default Model", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByText("Stored a", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Toggle chats" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(async () =>
      String(
        (await (await fetch("/api/settings/user")).json()).layout
          .sidebarCollapsed,
      ),
    ),
  ).toBe("true");
});

test("view navigation desktop stays in Customization when a chat sent from Home is saved", async ({
  page,
}) => {
  await mockApp(page);
  await page.route("**/api/sessions/b/runtime", (route) =>
    route.fulfill({
      json: {
        sequence: Date.now(),
        agents: [],
        activation: null,
        queued: [],
        held: false,
        history: [{ role: "user", content: "Stored b" }],
      },
    }),
  );
  const created = Promise.withResolvers<void>();
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await created.promise;
    await route.fulfill({ json: { id: "b", expiresAt: null } });
  });
  await mockUserPreferences(page);
  await page.goto("/");
  await page.getByPlaceholder("Send a message...").fill("First message");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("button", { name: "Customization", exact: true })
    .click();
  await page.getByPlaceholder("Enter your name").fill("Keep this draft");
  const started = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/sessions/b/messages",
  );
  created.resolve();
  await started;
  await expect(page).toHaveURL(/\/customization$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue(
    "Keep this draft",
  );
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
});

test("view navigation desktop deletes an empty chat left with Back", async ({
  page,
}) => {
  await mockApp(page);
  const deleted: string[] = [];
  await page.route(/\/api\/sessions\/b(?:\/runtime)?$/, (route) => {
    if (route.request().method() === "DELETE") {
      deleted.push(route.request().url());
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        id: "b",
        model: "test",
        history: [],
        agents: [],
        activation: null,
        queued: [],
        held: false,
        sequence: 0,
      },
    });
  });
  await mockUserPreferences(page);
  await page.goto("/run/a");
  await page.getByRole("button", { name: /Conversation b/ }).click();
  await expect(
    page.getByRole("heading", { name: "What are we working on today?" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Stored a", { exact: true })).toBeVisible();
  await expect.poll(() => deleted.length).toBe(1);
});

test("view navigation desktop protects dirty settings after a markdown footnote history entry", async ({
  page,
}) => {
  await mockApp(page);
  await page.route(/\/api\/sessions\/a(?:\/runtime)?$/, (route) =>
    route.fulfill({
      json: {
        id: "a",
        agents: [],
        activation: null,
        queued: [],
        held: false,
        sequence: 0,
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
  await mockUserPreferences(page);
  await page.goto("/run/a");
  await page.getByRole("link", { name: "1", exact: true }).click();
  await expect(page).toHaveURL(/#user-content-fn-1$/);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Developer tools", { exact: true }).click();
  await page.getByRole("switch", { name: "Display debug button" }).click();
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
  await mockUserPreferences(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/run\/b$/);
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
});

test("view navigation desktop keeps an ephemeral chat at its URL and counts down its expiry", async ({
  page,
}) => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();
  // Just over an hour, so it counts down in minutes once the hour is up.
  const expiresAt = now + 60 * 60_000 + 30_000;
  await page.clock.install({ time: now });
  await mockApp(page);
  const created: unknown[] = [];
  const deleted: string[] = [];
  let history: { role: string; content: string }[] = [];
  await page.route("**/api/sessions", (route) => {
    if (route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: "e", expiresAt } });
    }
    return route.fulfill({
      json: {
        sessions: [
          ...(created.length
            ? [
                {
                  id: "e",
                  preview: history[0]?.content ?? "",
                  createdAt: now,
                  updatedAt: now,
                  expiresAt,
                },
              ]
            : []),
          ...["a", "b"].map((id) => ({
            id,
            preview: `Conversation ${id}`,
            createdAt: 1,
            updatedAt: 1,
            expiresAt: null,
          })),
        ],
      },
    });
  });
  await page.route(/\/api\/sessions\/e(?:\/\w+)?$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "DELETE") {
      deleted.push(path);
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/messages"))
      history = [
        { role: "user", content: route.request().postDataJSON().content },
        { role: "assistant", content: "Ephemeral reply" },
      ];
    return route.fulfill({
      json: {
        id: "e",
        model: "test",
        history,
        expiresAt,
        sequence: Date.now(),
        agents: [],
        activation: null,
        queued: [],
        held: false,
      },
    });
  });
  const badge = page.getByTitle(
    "Messages and files are deleted when this chat expires.",
  );
  const listedExpiry = page.locator("#app-sidebar").getByText(/^Expires in/);

  await mockUserPreferences(page);
  await page.goto("/run/a");
  await expect(badge).toHaveCount(0);
  await page.getByTitle("Ephemeral chat - deleted automatically").click();
  await expect(page).toHaveURL(/\/run\/e$/);
  expect(created).toEqual([{ ephemeral: true }]);
  await expect(badge).toContainText("Expires in 1h");
  // Only the ephemeral chat lists an expiry.
  await expect(listedExpiry).toHaveText(["Expires in 1h"]);
  await page.getByPlaceholder("Send a message...").fill("Keep me");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Ephemeral reply")).toBeVisible();

  // Both displays change the moment the hour is up, not a minute after
  // each one mounted.
  await page.clock.fastForward("00:31");
  await expect(badge).toContainText("Expires in 59m");
  await expect(listedExpiry).toHaveText(["Expires in 59m"]);

  // It is saved until it expires, so leaving neither asks nor deletes it.
  await page.getByRole("button", { name: /Conversation b/ }).click();
  await expect(page.getByText("Stored b", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/run\/e$/);
  await expect(page.getByText("Ephemeral reply")).toBeVisible();
  await expect(badge).toContainText("Expires in 59m");
  await page.reload();
  await expect(page.getByText("Ephemeral reply")).toBeVisible();
  await expect(badge).toBeVisible();
  expect(deleted).toEqual([]);
});

test("view navigation desktop expires customization approval when a later guard cancels", async ({
  page,
}) => {
  await mockApp(page);
  await mockUserPreferences(page);
  await page.goto("/run/a");
  await page
    .getByRole("button", { name: "Customization", exact: true })
    .click();
  await page.getByPlaceholder("Enter your name").fill("Unsaved");
  // A second owner of unsaved state can reject an otherwise approved exit.
  await page.evaluate(async () => {
    const modulePath = "/ui/lib/navigation.ts";
    const { addNavigationGuard } = await import(modulePath);
    addNavigationGuard(async () => false);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goBack();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/customization$/);
    await expect(page.getByPlaceholder("Enter your name")).toHaveValue(
      "Unsaved",
    );
  }
});

test("view navigation desktop guards unsaved appearance and applies it only on Save and leave", async ({
  page,
}) => {
  await mockApp(page);
  await mockUserPreferences(page);
  await page.goto("/settings/appearance");
  await page.getByLabel("Font style", { exact: true }).selectOption("serif");
  await page.getByRole("button", { name: "Back to chat" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave settings?" });
  await expect(
    dialog.getByRole("list", { name: "Changed settings" }),
  ).toContainText("Font style");
  await expect(page.locator("html")).toHaveAttribute("data-font", "default");
  await dialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).not.toHaveURL(/settings/);
  await expect(page.locator("html")).toHaveAttribute("data-font", "default");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByLabel("Font style", { exact: true })).toHaveValue(
    "default",
  );
  await page.getByLabel("Font style", { exact: true }).selectOption("geist");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await dialog
    .getByRole("button", { name: "Save & leave", exact: true })
    .click();
  await expect(page).not.toHaveURL(/settings/);
  await expect(page.locator("html")).toHaveAttribute("data-font", "geist");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-font", "geist");
});
