import { type Page, expect, test } from "@playwright/test";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import { PreferenceService } from "../../src/gen/euler/v1/preferences_pb";
import { ProviderService } from "../../src/gen/euler/v1/providers_pb";
import { SessionService } from "../../src/gen/euler/v1/sessions_pb";
import { UsageService } from "../../src/gen/euler/v1/usage_pb";
import { at, message, mockApp as mockChatApp } from "./appFixture";
import { RpcFailure, mockRpc, on, rpcKey } from "./rpcMock";
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
  await mockChatApp(page, {
    sessions: ["a", "b"].map((id) => ({
      id,
      preview: `Conversation ${id}`,
      updatedAt: at(1),
    })),
    chats: Object.fromEntries(
      ["a", "b"].map((id) => [
        id,
        { model: "test", history: [message("user", `Stored ${id}`)] },
      ]),
    ),
  });
  await mockRpc(page, [
    on(
      UsageService.method.getUsage,
      () => new RpcFailure("unavailable", "Usage unavailable"),
    ),
    on(
      ProviderService.method.getOpenRouterCatalog,
      () => new RpcFailure("unavailable", "Catalog unavailable"),
    ),
  ]);
}

/** The saved sidebar preference, read the way the app reads it. */
function savedSidebarCollapsed(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch(
      "/api/rpc/euler.v1.PreferenceService/GetPreferences",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    const { preferences } = await response.json();
    return String(preferences.layout?.sidebarCollapsed ?? false);
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
  expect(await savedSidebarCollapsed(page)).not.toBe("true");
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
  await expect(page).toHaveURL(/\/customization\/personalization$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/customization\/personalization$/);
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
  await mockRpc(page, [
    on(
      ProviderService.method.updateOllamaConfig,
      () => new RpcFailure("internal", "Unavailable", "INTERNAL_ERROR"),
    ),
  ]);
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
  expect(await savedSidebarCollapsed(page)).toBe("true");
});

test("view navigation desktop stays in Customization when a chat sent from Home is saved", async ({
  page,
}) => {
  await mockApp(page);
  const created = Promise.withResolvers<void>();
  await mockRpc(page, [
    on(AgentService.method.getRuntime, ({ sessionId }) =>
      sessionId === "b"
        ? {
            sequence: BigInt(Date.now()),
            history: [message("user", "Stored b")],
          }
        : undefined,
    ),
    on(SessionService.method.createSession, async () => {
      await created.promise;
      return { id: "b" };
    }),
  ]);
  await mockUserPreferences(page);
  await page.goto("/");
  await page.getByPlaceholder("Send a message...").fill("First message");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("button", { name: "Customization", exact: true })
    .click();
  await page.getByPlaceholder("Enter your name").fill("Keep this draft");
  const started = page.waitForRequest(
    (request) =>
      rpcKey(request) === "AgentService/SendMessage" &&
      request.postDataJSON().sessionId === "b",
  );
  created.resolve();
  await started;
  await expect(page).toHaveURL(/\/customization\/personalization$/);
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
  await mockRpc(page, [
    on(SessionService.method.deleteSession, ({ id }) => {
      deleted.push(id);
      return {};
    }),
    on(SessionService.method.getSession, ({ id }) =>
      id === "b" ? { session: { id: "b", model: "test" } } : undefined,
    ),
    on(AgentService.method.getRuntime, ({ sessionId }) =>
      sessionId === "b" ? {} : undefined,
    ),
  ]);
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
  const footnote = [
    message("assistant", "A note[^1].\n\n[^1]: Footnote content."),
  ];
  await mockRpc(page, [
    on(SessionService.method.getSession, ({ id }) =>
      id === "a"
        ? { session: { id: "a", model: "test", history: footnote } }
        : undefined,
    ),
    on(AgentService.method.getRuntime, ({ sessionId }) =>
      sessionId === "a" ? { history: footnote } : undefined,
    ),
  ]);
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
  let history: ReturnType<typeof message>[] = [];
  await mockRpc(page, [
    on(SessionService.method.createSession, ({ ephemeral }) => {
      created.push({ ephemeral });
      return { id: "e", expiresAt: at(expiresAt) };
    }),
    on(SessionService.method.listSessions, () => ({
      sessions: [
        ...(created.length
          ? [
              {
                id: "e",
                preview: history[0]?.content ?? "",
                updatedAt: at(now),
                expiresAt: at(expiresAt),
              },
            ]
          : []),
        ...["a", "b"].map((id) => ({
          id,
          preview: `Conversation ${id}`,
          updatedAt: at(1),
        })),
      ],
    })),
    on(SessionService.method.deleteSession, ({ id }) => {
      if (id !== "e") return undefined;
      deleted.push(id);
      return {};
    }),
    on(AgentService.method.sendMessage, ({ sessionId, content }) => {
      if (sessionId !== "e") return undefined;
      history = [
        message("user", content),
        message("assistant", "Ephemeral reply"),
      ];
      return {};
    }),
    on(SessionService.method.getSession, ({ id }) =>
      id === "e"
        ? {
            session: {
              id: "e",
              model: "test",
              history,
              expiresAt: at(expiresAt),
            },
          }
        : undefined,
    ),
    on(AgentService.method.getRuntime, ({ sessionId }) =>
      sessionId === "e" ? { history, sequence: BigInt(Date.now()) } : undefined,
    ),
  ]);
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
    await expect(page).toHaveURL(/\/customization\/personalization$/);
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

test("view navigation desktop opens customization subroutes and restores them on reload", async ({
  page,
}) => {
  await mockApp(page);
  await mockUserPreferences(page);
  for (const [tab, label] of [
    ["personalization", "Personalization"],
    ["skills", "Skills"],
    ["tools", "Tools"],
  ]) {
    await page.goto(`/customization/${tab}`);
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Customization", exact: true }),
    ).toBeVisible();
  }
  for (const path of ["/customization", "/customization/unknown"]) {
    await page.goto(path);
    await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Personalization", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("view navigation desktop preserves customization drafts across tab history and guards departure", async ({
  page,
}) => {
  await mockApp(page);
  await mockUserPreferences(page);
  await page.goto("/run/a");
  await page
    .getByRole("button", { name: "Customization", exact: true })
    .click();
  await page.getByPlaceholder("Enter your name").fill("Keep this draft");
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page).toHaveURL(/\/customization\/skills$/);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page).toHaveURL(/\/customization\/tools$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Skills", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue(
    "Keep this draft",
  );
  await page.goForward();
  await expect(page).toHaveURL(/\/customization\/skills$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(
    page.getByRole("dialog", { name: "Leave customization?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep editing", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/customization\/skills$/);
  await page
    .getByRole("button", { name: "Personalization", exact: true })
    .click();
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue(
    "Keep this draft",
  );
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByRole("button", { name: "Save & leave", exact: true }).click();
  await expect(page).toHaveURL(/\/run\/a$/);
  await page.goto("/customization");
  await page.getByPlaceholder("Enter your name").fill("Root draft");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page).toHaveURL(/\/customization\/tools$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/customization$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue(
    "Root draft",
  );
});

test("view navigation desktop returns to a failed customization draft when leaving another tab", async ({
  page,
}) => {
  await mockApp(page);
  await mockUserPreferences(page);
  await page.goto("/customization/personalization");
  await page.getByPlaceholder("Enter your name").fill("Unsaved");
  await page
    .getByRole("navigation", { name: "Customization sections" })
    .getByRole("button", { name: "Tools", exact: true })
    .click();
  await expect(page).toHaveURL(/\/customization\/tools$/);
  await mockRpc(page, [
    on(
      PreferenceService.method.updatePreferences,
      () => new RpcFailure("unavailable", "Save unavailable", "INTERNAL_ERROR"),
    ),
  ]);
  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByRole("button", { name: "Save & leave", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/customization\/personalization$/);
  await expect(page.getByRole("alert")).toHaveText("Save unavailable");
  await expect(page.getByPlaceholder("Enter your name")).toHaveValue("Unsaved");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(
    page.getByRole("dialog", { name: "Leave customization?" }),
  ).toBeVisible();
});
