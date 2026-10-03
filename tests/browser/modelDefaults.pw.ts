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

const models = [
  {
    id: "local",
    name: "Local",
    provider: "ollama",
    lab: "Ollama",
    inputCapabilities: ["text"],
  },
  {
    id: "openrouter:test/remote",
    name: "Remote",
    provider: "openrouter",
    lab: "Test",
    configured: true,
    inputCapabilities: ["text"],
  },
];

async function mockApp(
  page: Page,
  saved: string,
  catalog: () => Promise<typeof models>,
) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript((defaultModel) => {
    localStorage.setItem(
      "euler:userSettings",
      JSON.stringify({ defaultModel }),
    );
  }, saved);
  const created: Array<{ model?: string; ephemeral?: boolean }> = [];
  let sessionModel: string | null = null;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/models")
      return route.fulfill({ json: { models: await catalog() } });
    if (path === "/api/sessions" && method === "POST") {
      const body = route.request().postDataJSON() as {
        model?: string;
        ephemeral?: boolean;
      };
      created.push(body);
      if (body.ephemeral)
        return route.fulfill({
          json: { id: "ephemeral", expiresAt: Date.now() + 5.5 * 3_600_000 },
        });
      sessionModel = body.model ?? null;
      return route.fulfill({ json: { id: "new", expiresAt: null } });
    }
    if (path === "/api/sessions/new" && method === "PATCH") {
      sessionModel = (route.request().postDataJSON() as { model: string })
        .model;
    }
    const json =
      path === "/api/sessions"
        ? { sessions: [] }
        : path === "/api/sessions/new"
          ? { id: "new", model: sessionModel, history: [], expiresAt: null }
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
              : path === "/api/settings/environment"
                ? {
                    ollamaHost: false,
                    comfyuiHost: false,
                  }
                : {};
    return route.fulfill({ json });
  });
  return created;
}

test("model defaults desktop: unavailable preference matches settings, new chats and ephemeral chats", async ({
  page,
}) => {
  const created = await mockApp(page, "removed", async () => models);
  const deleted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE")
      deleted.push(new URL(request.url()).pathname);
  });
  await mockUserPreferences(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Model: Local", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved model removed is unavailable.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Model: Local", exact: true }),
  ).toBeVisible();
  // Home saves the chat on its first message, with the selected model.
  expect(created).toEqual([]);
  await page.getByPlaceholder("Send a message...").fill("Hello");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => created).toEqual([{ model: "local" }]);

  // A previous chat's model must not become the next ephemeral chat's default.
  await page.getByRole("button", { name: "Model: Local", exact: true }).click();
  await page.getByRole("tab", { name: "Test" }).click();
  await page
    .getByRole("button", { name: "Remote Chat only", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Model: Remote", exact: true }),
  ).toBeVisible();
  await page.getByTitle("Ephemeral chat - deleted automatically").click();
  await expect(
    page.getByRole("button", { name: "Model: Local", exact: true }),
  ).toBeVisible();
  expect(created.at(-1)).toEqual({ ephemeral: true });
  const badge = page.getByTitle(
    "Messages and files are deleted when this chat expires.",
  );
  await page.getByPlaceholder("Send a message...").fill("Ephemeral draft");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/run\/ephemeral$/);
  await expect(badge).toBeVisible();
  await expect(page.getByPlaceholder("Send a message...")).toHaveValue(
    "Ephemeral draft",
  );
  expect(deleted).not.toContain("/api/sessions/ephemeral");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Model: Local", exact: true }).click();
  await page.getByRole("tab", { name: "Test" }).click();
  await page.getByPlaceholder("Search models...").fill("Remote");
  await page
    .getByRole("button", { name: "Remote Chat only", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(badge).toBeVisible();
  await expect(page.getByPlaceholder("Send a message...")).toHaveValue(
    "Ephemeral draft",
  );
  expect(deleted).not.toContain("/api/sessions/ephemeral");
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Model: Remote", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(() => created.at(-1))
    .toEqual({ model: "openrouter:test/remote" });
});

test("model defaults desktop: the Home composer resolves its model when the catalog arrives", async ({
  page,
}) => {
  const pending = Promise.withResolvers<typeof models>();
  const created = await mockApp(
    page,
    "openrouter:test/remote",
    () => pending.promise,
  );
  try {
    await mockUserPreferences(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByText("Loading models...", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to chat" }).click();
    await page
      .getByRole("button", { name: "New chat", exact: true })
      .first()
      .click();
    await page.getByPlaceholder("Send a message...").fill("Hello");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    pending.resolve(models);
    await expect(
      page.getByRole("button", { name: "Model: Remote", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeEnabled();
    expect(created).toEqual([]);
  } finally {
    pending.resolve(models);
  }
});

test("model defaults desktop: empty catalogs show no default and cannot send", async ({
  page,
}) => {
  const created = await mockApp(page, "removed", async () => []);
  await mockUserPreferences(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("No models available.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Model: No models found", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .first()
    .click();
  await page.getByPlaceholder("Send a message...").fill("Hello");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  expect(created).toEqual([]);
});

test("model defaults desktop: reset icon clears and saves the explicit preference", async ({
  page,
}) => {
  await mockApp(page, "openrouter:test/remote", async () => models);
  await mockUserPreferences(page);
  await page.goto("/settings/general");
  await expect(
    page.getByText("New chats will use this model.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Use first available model",
      exact: true,
    }),
  ).toHaveCount(0);
  const reset = page.getByRole("button", {
    name: "Reset default model",
    exact: true,
  });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Model: Local", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      async () =>
        (await (await fetch("/api/settings/user")).json()).settings
          .defaultModel,
    ),
  ).toBe("");
});

test("model defaults desktop: two devices share preferences only for the same user", async ({
  browser,
}) => {
  const store = new Map<
    string,
    import("../../src/schemas/userPreferences").UserPreferences
  >();
  const first = await browser.newPage();
  const second = await browser.newPage();
  const other = await browser.newPage();
  const sameUser = "11111111-1111-4111-8111-111111111111";
  try {
    for (const [page, user] of [
      [first, sameUser],
      [second, sameUser],
      [other, "22222222-2222-4222-8222-222222222222"],
    ] as const) {
      await mockApp(page, "local", async () => models);
      await page.addInitScript(
        (user) => localStorage.setItem("euler:userUuid", user),
        user,
      );
      await mockUserPreferences(page, store);
    }
    await first.goto("/settings/general");
    await first
      .getByRole("button", { name: "Model: Local", exact: true })
      .click();
    await first.getByRole("tab", { name: "Test" }).click();
    await first
      .getByRole("button", { name: "Remote Chat only", exact: true })
      .click();
    await first
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await first.getByText("Nord", { exact: true }).click();
    await first
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      first.getByRole("button", { name: "Save settings", exact: true }),
    ).toBeHidden();
    // The second browser starts with stale local settings; the server wins.
    await second.goto("/settings/general");
    await expect(
      second.getByRole("button", { name: "Model: Remote", exact: true }),
    ).toBeVisible();
    await expect(second.locator("html")).toHaveAttribute("data-theme", "nord");
    await other.goto("/settings/general");
    await expect(
      other.getByRole("button", { name: "Model: Local", exact: true }),
    ).toBeVisible();
    await expect(other.locator("html")).toHaveAttribute(
      "data-theme",
      "default",
    );
  } finally {
    await Promise.all([first.close(), second.close(), other.close()]);
  }
});

test("model defaults desktop: stale device saves preserve another device's changed fields", async ({
  browser,
}) => {
  const store = new Map<
    string,
    import("../../src/schemas/userPreferences").UserPreferences
  >();
  const first = await browser.newPage();
  const second = await browser.newPage();
  const other = await browser.newPage();
  const sameUser = "11111111-1111-4111-8111-111111111111";
  try {
    for (const [page, user] of [
      [first, sameUser],
      [second, sameUser],
      [other, "22222222-2222-4222-8222-222222222222"],
    ] as const) {
      await mockApp(page, "local", async () => models);
      await page.addInitScript(
        (user) => localStorage.setItem("euler:userUuid", user),
        user,
      );
      await mockUserPreferences(page, store);
    }
    await second.goto("/settings/general");
    await expect(
      second.getByRole("button", { name: "Model: Local", exact: true }),
    ).toBeVisible();
    await first.goto("/settings/general");
    await first
      .getByRole("button", { name: "Model: Local", exact: true })
      .click();
    await first.getByRole("tab", { name: "Test" }).click();
    await first
      .getByRole("button", { name: "Remote Chat only", exact: true })
      .click();
    await first
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await first.getByText("Nord", { exact: true }).click();
    await first
      .getByRole("button", { name: "Image Generation", exact: true })
      .click();
    await first.getByLabel("Negative Prompt").fill("device-one");
    await first
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      first.getByRole("button", { name: "Save settings", exact: true }),
    ).toBeHidden();
    await second.getByText("Developer tools", { exact: true }).click();
    await second.getByRole("switch", { name: "Display debug button" }).click();
    await second
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await second
      .getByLabel("Font style", { exact: true })
      .selectOption("serif");
    await second
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      second.getByRole("button", { name: "Save settings", exact: true }),
    ).toBeHidden();
    await second.getByRole("button", { name: "General", exact: true }).click();
    await expect(
      second.getByRole("button", { name: "Model: Remote", exact: true }),
    ).toBeVisible();
    await expect(second.locator("html")).toHaveAttribute("data-theme", "nord");
    expect(store.get(sameUser)?.image.negativePrompt).toBe("device-one");
    expect(store.get(sameUser)?.settings.showDebugButton).toBe(true);
    expect(store.get(sameUser)?.appearance.font).toBe("serif");
    await other.goto("/settings/general");
    await expect(
      other.getByRole("button", { name: "Model: Local", exact: true }),
    ).toBeVisible();
    await expect(other.locator("html")).toHaveAttribute(
      "data-theme",
      "default",
    );
  } finally {
    await Promise.all([first.close(), second.close(), other.close()]);
  }
});
