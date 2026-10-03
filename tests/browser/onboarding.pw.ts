import { type Page, expect, test } from "@playwright/test";
import type { UserPreferences } from "../../src/schemas/userPreferences";
import { mockUserPreferences } from "./userPreferencesFixture";

type Fulfill = { status?: number; json: unknown };
type Respond = (path: string, method: string, body: unknown) => Fulfill | null;

const comfyDefaults = {
  host: "",
  defaultModel: "",
  defaultWidth: 1440,
  defaultHeight: 1440,
  negativePrompt: "",
};

function defaultApi(path: string, body: unknown): unknown {
  const sent = (body ?? {}) as Record<string, unknown>;
  if (path.endsWith("/catalog"))
    return {
      publishers: [],
      modelsByPublisher: {},
      discoveredPublishers: [],
      catalog: { status: "fresh", fetchedAt: null, error: null },
    };
  if (path === "/api/models") return { models: [] };
  if (path === "/api/sessions") return { sessions: [] };
  if (path === "/api/settings/environment")
    return { ollamaHost: false, comfyuiHost: false };
  if (path === "/api/settings/openrouter" || path === "/api/settings/brave")
    return { hasKey: Boolean(sent.apiKey), environmentManaged: false };
  if (path.endsWith("/test")) return { ok: true, version: "0.9.0" };
  if (path === "/api/comfyui/models") return { models: ["flux.safetensors"] };
  if (path.endsWith("/config")) return { host: "", ...sent };
  return { connected: false };
}

/**
 * Serves a fresh server with per-user preferences in `preferences`, and records
 * every other write the setup makes.
 */
async function routeApi(
  page: Page,
  respond: Respond = () => null,
  preferences = new Map<string, UserPreferences>(),
) {
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    return route.fulfill({ json: defaultApi(path, request.postDataJSON()) });
  });
  await mockUserPreferences(page, preferences);
  // Registered last, so it sees each request before the handlers above.
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON() as unknown;
    if (
      request.method() !== "GET" &&
      !path.endsWith("/test") &&
      path !== "/api/settings/user"
    )
      writes.push({ path, body });
    const response = respond(path, request.method(), body);
    return response ? route.fulfill(response) : route.fallback();
  });
  return writes;
}

const savedSettings = (preferences: Map<string, UserPreferences>) =>
  [...preferences.values()].map((saved) => saved.settings);

async function expectSecretNotStored(page: Page, secret: string) {
  const stored = await page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => storage.getItem(key) ?? ""),
    ),
  );
  expect(stored.some((value) => value.includes(secret))).toBe(false);
}

const progress = (page: Page) =>
  page.getByRole("list", { name: "Setup progress" });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

for (const device of ["desktop", "mobile"] as const) {
  test(`onboarding ${device}: optional steps, shared service forms and completion`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:5199",
      viewport:
        device === "desktop"
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
    });
    const preferences = new Map<string, UserPreferences>();
    const writes = await routeApi(
      page,
      (path, method) =>
        path === "/api/settings/openrouter" && method === "GET"
          ? { json: { hasKey: true, environmentManaged: false } }
          : null,
      preferences,
    );
    try {
      await page.goto("/dev/onboarding");
      await page.getByLabel("Name (optional)").fill("Nick");
      await page.getByLabel("Location (optional)").fill("Seattle");
      await page
        .getByLabel("Preferred response formats")
        .fill("Keep it concise and use practical examples.");
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${device}-personalization.png`),
      });
      await button(page, "Continue").click();
      await expect(
        page.getByRole("heading", { name: "Appearance" }),
      ).toBeFocused();
      await page.getByText("Nord", { exact: true }).click();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${device}-appearance.png`),
      });
      await button(page, "Continue").click();
      await expect(
        page.getByRole("heading", { name: "Cloud models" }),
      ).toBeFocused();
      await expect(page.getByText("Choose which models appear")).toBeVisible();
      await button(page, "Continue").click();

      // Typing only configures Ollama; a passing test is what connects it.
      // Mobile keeps the step list in a menu, covered by its own test.
      await page.getByLabel("Server URL").fill("http://ollama.test:11434");
      if (device === "desktop")
        await expect(progress(page)).toContainText(
          "OpenRouter configured, Ollama configured",
        );
      await button(page, "Test connection").click();
      await expect(
        page.getByText("Connected - Ollama version 0.9.0"),
      ).toBeVisible();
      if (device === "desktop")
        await expect(progress(page)).toContainText("Ollama connected");
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${device}-providers.png`),
      });
      await button(page, "Continue").click();
      await expect(
        page.getByRole("heading", { name: "Default model" }),
      ).toBeFocused();
      expect(writes).toEqual([
        {
          path: "/api/ollama/config",
          body: { host: "http://ollama.test:11434" },
        },
      ]);
      await button(page, "Continue").click();

      await page.getByLabel("Server URL").fill("http://comfy.test:8188");
      await button(page, "Test connection").click();
      await page
        .getByLabel("Default Checkpoint Model")
        .selectOption("flux.safetensors");
      await button(page, "Continue").click();
      await page.getByLabel("API key", { exact: true }).fill("brave-secret");
      await button(page, "Save key").click();
      await expect(page.getByText("Configured", { exact: true })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`${device}-extras.png`),
      });
      await page.getByRole("button", { name: "Finish setup" }).click();
      await expect(page.getByText("Setup complete")).toBeVisible();
      expect(writes.slice(1)).toEqual([
        {
          path: "/api/comfyui/config",
          body: {
            host: "http://comfy.test:8188",
            defaultModel: "flux.safetensors",
          },
        },
        { path: "/api/settings/brave", body: { apiKey: "brave-secret" } },
      ]);
      expect(savedSettings(preferences)).toEqual([
        expect.objectContaining({ name: "Nick", location: "Seattle" }),
      ]);
      await expectSecretNotStored(page, "brave-secret");
    } finally {
      await page.close();
    }
  });
}

test("onboarding desktop: a failed save keeps the step and its draft", async ({
  page,
}) => {
  const preferences = new Map<string, UserPreferences>();
  await routeApi(
    page,
    (path, method) =>
      path === "/api/settings/user" && method === "PATCH"
        ? {
            status: 503,
            json: {
              error: {
                code: "INTERNAL_ERROR",
                message: "Settings are unavailable.",
              },
            },
          }
        : null,
    preferences,
  );
  await page.goto("/dev/onboarding");
  await page.getByLabel("Name (optional)").fill("Unsaved");
  await button(page, "Continue").click();
  await expect(page.getByRole("alert")).toContainText(
    "Settings are unavailable.",
  );
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByLabel("Name (optional)")).toHaveValue("Unsaved");
  expect(savedSettings(preferences)).toEqual([
    expect.objectContaining({ name: "" }),
  ]);
});

test("onboarding desktop: skipped drafts are discarded and never reach later saves", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("euler:userSettings"))
      localStorage.setItem(
        "euler:userSettings",
        JSON.stringify({ defaultModel: "qwen3:8b" }),
      );
  });
  const preferences = new Map<string, UserPreferences>();
  const writes = await routeApi(page, undefined, preferences);
  await page.goto("/dev/onboarding");
  await page.getByLabel("Name (optional)").fill("Leaked");
  await button(page, "Skip").click();
  await button(page, "Back").click();
  await expect(page.getByLabel("Name (optional)")).toHaveValue("");
  await button(page, "Skip").click();
  await button(page, "Skip").click();
  await button(page, "Skip").click();

  await page.getByLabel("Server URL").fill("http://draft-only:11434");
  await button(page, "Skip").click();
  await button(page, "Back").click();
  await expect(page.getByLabel("Server URL")).toHaveValue("");
  await button(page, "Skip").click();

  // A later save must carry only its own step.
  await page.getByRole("button", { name: "Reset default model" }).click();
  await button(page, "Continue").click();
  await expect(
    page.getByRole("heading", { name: "Image generation" }),
  ).toBeFocused();
  expect(savedSettings(preferences)).toEqual([
    expect.objectContaining({ defaultModel: "", name: "" }),
  ]);
  await page.getByLabel("Server URL").fill("http://draft-only:8188");
  await button(page, "Skip").click();
  await page.getByLabel("API key", { exact: true }).fill("skipped-secret");
  await button(page, "Skip").click();
  await expect(page.getByText("Setup complete")).toBeVisible();
  expect(writes).toEqual([]);
  await expectSecretNotStored(page, "skipped-secret");
});

test("onboarding desktop: new UUID enters setup and finishing opens the app without a reload", async ({
  page,
}) => {
  await routeApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  // A full reload repaints a blank page before the app returns.
  await page.evaluate(() => {
    document.documentElement.dataset.setupPage = "kept";
  });
  for (let step = 0; step < 7; step++) await button(page, "Skip").click();
  await expect(button(page, "Toggle chats")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-setup-page", "kept");
  await page.reload();
  await expect(button(page, "Toggle chats")).toBeVisible();
  await expect(page.getByRole("heading", { name: "About you" })).toBeHidden();
});

test.describe("onboarding desktop layout", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    isMobile: false,
    hasTouch: false,
  });

  test("onboarding desktop: saved and environment-managed services are not rewritten", async ({
    page,
  }) => {
    const writes = await routeApi(page, (path, method) => {
      if (method !== "GET") return null;
      if (path === "/api/settings/environment")
        return {
          json: { ollamaHost: false, comfyuiHost: true },
        };
      if (path === "/api/ollama/config")
        return { json: { host: "http://saved-ollama:11434" } };
      if (path === "/api/comfyui/config")
        return { json: { ...comfyDefaults, host: "http://env-comfy:8188" } };
      return null;
    });
    await page.goto("/");
    for (let step = 0; step < 3; step++) await button(page, "Skip").click();
    await expect(page.getByLabel("Server URL")).toHaveValue(
      "http://saved-ollama:11434",
    );
    await expect(progress(page)).toContainText("Ollama configured");
    await button(page, "Continue").click();
    await button(page, "Continue").click();
    await expect(page.getByLabel("Server URL")).toBeDisabled();
    await expect(page.getByLabel("Server URL")).toHaveValue(
      "http://env-comfy:8188",
    );
    await expect(page.getByText("Managed by the environment.")).toBeVisible();
    await expect(progress(page)).toContainText("ComfyUI configured");
    await button(page, "Continue").click();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(button(page, "Toggle chats")).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("onboarding desktop: sidebar returns to earlier steps and actions stay in place", async ({
    page,
  }) => {
    await routeApi(page);
    await page.goto("/");
    const current = progress(page).locator('[aria-current="step"]');
    await expect(current).toContainText("About you");
    const back = button(page, "Back");
    await expect(back).toBeDisabled();
    const backBox = await back.boundingBox();
    // Only earlier steps can be revisited from the sidebar.
    await expect(progress(page).getByRole("button")).toHaveCount(0);
    await button(page, "Continue").click();
    await expect(
      page.getByRole("heading", { name: "Appearance" }),
    ).toBeFocused();
    // Appearance is much taller than About you; the actions must not move.
    expect(await back.boundingBox()).toEqual(backBox);
    await expect(button(page, "Continue")).toBeInViewport();
    await button(page, "Skip").click();
    // A section lists its steps only while one of them is current.
    await expect(current).toContainText("Cloud models");
    await expect(progress(page)).toContainText("Local models");
    await button(page, "Skip").click();
    await progress(page).getByRole("button", { name: "Cloud models" }).click();
    await expect(
      page.getByRole("heading", { name: "Cloud models" }),
    ).toBeFocused();
    await progress(page).getByRole("button", { name: "About you" }).click();
    await expect(
      page.getByRole("heading", { name: "About you" }),
    ).toBeFocused();
    await expect(progress(page)).not.toContainText("Local models");
    for (let step = 0; step < 7; step++) await button(page, "Skip").click();
    await expect(button(page, "Toggle chats")).toBeVisible();
  });
});

test("onboarding mobile: step menu returns to earlier steps and actions stay pinned", async ({
  page,
}) => {
  await routeApi(page);
  await page.goto("/");
  const menu = page.getByRole("button", { name: /^Setup steps/ });
  await expect(menu).toHaveAccessibleName("Setup steps, 1 of 5");
  await expect(progress(page)).toBeHidden();
  const continueButton = button(page, "Continue");
  const continueBox = await continueButton.boundingBox();
  for (let step = 0; step < 3; step++) await button(page, "Skip").click();
  await expect(
    page.getByRole("heading", { name: "Local models" }),
  ).toBeFocused();
  await expect(menu).toHaveAccessibleName("Setup steps, 3 of 5");
  expect(await continueButton.boundingBox()).toEqual(continueBox);

  await menu.click();
  await expect(progress(page).locator('[aria-current="step"]')).toContainText(
    "Local models",
  );
  await progress(page).getByRole("button", { name: "Appearance" }).click();
  await expect(progress(page)).toBeHidden();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeFocused();
  await expect(menu).toHaveAccessibleName("Setup steps, 2 of 5");
});
