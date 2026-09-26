import { type Page, expect, test } from "@playwright/test";

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
  const created: Array<{ model?: string }> = [];
  let sessionModel: string | null = null;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/models")
      return route.fulfill({ json: { models: await catalog() } });
    if (path === "/api/sessions" && method === "POST") {
      const body = route.request().postDataJSON() as { model?: string };
      created.push(body);
      sessionModel = body.model ?? null;
      return route.fulfill({ json: { id: "new", createdAt: 1, updatedAt: 1 } });
    }
    if (path === "/api/sessions/new" && method === "PATCH") {
      sessionModel = (route.request().postDataJSON() as { model: string })
        .model;
    }
    const json =
      path === "/api/sessions"
        ? { sessions: [] }
        : path === "/api/sessions/new"
          ? { id: "new", model: sessionModel, history: [] }
          : path === "/api/temporary-sessions"
            ? { id: "temporary" }
            : path.startsWith("/api/runs/active/")
              ? { active: false }
              : path.endsWith("/health")
                ? { connected: true }
                : path === "/api/settings/environment"
                  ? {
                      ollamaHost: false,
                      comfyuiHost: false,
                      searxngHost: false,
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
  const deletedTemporarySessions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "DELETE" &&
      new URL(request.url()).pathname.startsWith("/api/temporary-sessions/")
    ) {
      deletedTemporarySessions.push(request.url());
    }
  });
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
  await expect.poll(() => created).toEqual([{ model: "local" }]);
  await expect(
    page.getByRole("button", { name: "Model: Local", exact: true }),
  ).toBeVisible();

  // A previous chat's model must not become the next ephemeral chat's default.
  await page.getByRole("button", { name: "Model: Local", exact: true }).click();
  await page.getByRole("tab", { name: "Test" }).click();
  await page
    .getByRole("button", { name: "Remote OpenRouter", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Model: Remote", exact: true }),
  ).toBeVisible();
  await page.getByTitle("Ephemeral chat - not saved").click();
  await expect(
    page.getByRole("button", { name: "Model: Local", exact: true }),
  ).toBeVisible();
  await page.getByPlaceholder("Send a message...").fill("Ephemeral draft");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page.goBack();
  await expect(page.getByText("Ephemeral", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Send a message...")).toHaveValue(
    "Ephemeral draft",
  );
  expect(deletedTemporarySessions).toEqual([]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Model: Local", exact: true }).click();
  await page.getByRole("tab", { name: "Test" }).click();
  await page.getByPlaceholder("Search models...").fill("Remote");
  await page
    .getByRole("button", { name: "Remote OpenRouter", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(page.getByText("Ephemeral", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Send a message...")).toHaveValue(
    "Ephemeral draft",
  );
  expect(deletedTemporarySessions).toEqual([]);
  await page
    .getByRole("button", { name: "New chat", exact: true })
    .first()
    .click();
  await expect
    .poll(() => created.at(-1))
    .toEqual({ model: "openrouter:test/remote" });
  await expect(
    page.getByRole("button", { name: "Model: Remote", exact: true }),
  ).toBeVisible();
});

test("model defaults desktop: a chat created during catalog loading resolves when models arrive", async ({
  page,
}) => {
  const pending = Promise.withResolvers<typeof models>();
  const created = await mockApp(
    page,
    "openrouter:test/remote",
    () => pending.promise,
  );
  try {
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
    await expect.poll(() => created).toEqual([{}]);
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
  } finally {
    pending.resolve(models);
  }
});

test("model defaults desktop: empty catalogs show no default and cannot send", async ({
  page,
}) => {
  const created = await mockApp(page, "removed", async () => []);
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
  await expect.poll(() => created).toEqual([{}]);
  await page.getByPlaceholder("Send a message...").fill("Hello");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
});
