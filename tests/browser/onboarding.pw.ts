import type { MessageInitShape } from "@bufbuild/protobuf";
import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import { type Page, expect, test } from "@playwright/test";
import {
  InputCapability,
  ModelProvider,
  ModelService,
} from "../../src/gen/euler/v1/models_pb";
import {
  PreferenceService,
  type UpdatePreferencesRequestSchema,
} from "../../src/gen/euler/v1/preferences_pb";
import {
  ApiKeyProvider,
  CatalogFreshness_Status,
  ProviderService,
} from "../../src/gen/euler/v1/providers_pb";
import type { UserPreferences } from "../../src/schemas/userPreferences";
import {
  RpcFailure,
  type RpcMock,
  mockRpc,
  on,
  rpcKey,
  rpcMethod,
} from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

const chatGptStatus = (connected: boolean) => ({
  connected,
  email: connected ? "nick@example.com" : undefined,
  name: connected ? "Nick Example" : undefined,
  planEnabled: connected,
});

/** Reads not marked side-effect free: connection tests and the catalog refresh. */
const READ_ONLY = new Set([
  "ProviderService/TestOllamaHost",
  "ProviderService/TestComfyUiHost",
  "ProviderService/GetOpenRouterCatalog",
]);

/**
 * Serves a fresh server with per-user preferences in `preferences`, starting
 * from `initial`, and records every other write the setup makes. `mocks`
 * answer before the defaults.
 */
async function routeApi(
  page: Page,
  mocks: RpcMock[] = [],
  preferences = new Map<string, UserPreferences>(),
  initial: MessageInitShape<typeof UpdatePreferencesRequestSchema> = {},
) {
  await mockRpc(
    page,
    [
      on(ProviderService.method.getOpenRouterCatalog, () => ({
        catalog: { status: CatalogFreshness_Status.FRESH },
        discoveredPublishers: {},
      })),
      on(PreferenceService.method.getEnvironment, () => ({
        ollamaHost: false,
        comfyuiHost: false,
      })),
      on(ProviderService.method.getChatGptStatus, () => ({
        status: chatGptStatus(false),
      })),
      on(ProviderService.method.getApiKey, () => ({
        state: { hasKey: false, environmentManaged: false },
      })),
      on(ProviderService.method.setApiKey, ({ apiKey }) => ({
        state: { hasKey: Boolean(apiKey), environmentManaged: false },
      })),
      on(ProviderService.method.testOllamaHost, () => ({
        result: { ok: true, version: "0.9.0" },
      })),
      on(ProviderService.method.testComfyUiHost, () => ({
        result: { ok: true, version: "0.9.0" },
      })),
      on(ProviderService.method.listComfyUiModels, () => ({
        models: ["flux.safetensors"],
      })),
      on(ProviderService.method.getOllamaConfig, () => ({
        config: { host: "" },
      })),
      on(ProviderService.method.updateOllamaConfig, ({ host }) => ({
        config: { host },
      })),
    ],
    { empty: true },
  );
  await mockUserPreferences(page, preferences, initial);
  // Registered last, so these answer before the defaults above.
  await mockRpc(page, mocks);
  const writes: { rpc: string; body: unknown }[] = [];
  page.on("request", (request) => {
    const key = rpcKey(request);
    const method = rpcMethod(request);
    if (
      !key ||
      !method ||
      method.methodKind !== "unary" ||
      method.idempotency === MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS ||
      READ_ONLY.has(key) ||
      key.startsWith("PreferenceService/")
    )
      return;
    writes.push({ rpc: key, body: request.postDataJSON() });
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
      [
        on(ProviderService.method.getApiKey, ({ provider }) =>
          provider === ApiKeyProvider.OPENROUTER
            ? { state: { hasKey: true, environmentManaged: false } }
            : undefined,
        ),
      ],
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
        page.getByRole("heading", { name: "ChatGPT", exact: true }),
      ).toBeFocused();
      await button(page, "Continue").click();
      await expect(
        page.getByRole("heading", { name: "Default model" }),
      ).toBeFocused();
      expect(writes).toEqual([
        {
          rpc: "ProviderService/UpdateOllamaConfig",
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
          rpc: "ProviderService/UpdateComfyUiConfig",
          body: {
            host: "http://comfy.test:8188",
            image: { defaultModel: "flux.safetensors" },
          },
        },
        {
          rpc: "ProviderService/SetApiKey",
          body: { provider: "API_KEY_PROVIDER_BRAVE", apiKey: "brave-secret" },
        },
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

for (const device of ["desktop", "mobile"] as const) {
  test(`onboarding ${device}: ChatGPT sign-in offers its models as the default`, async ({
    browser,
  }) => {
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:5199",
      viewport:
        device === "desktop"
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
    });
    const authorizationUrl = "https://auth.example.test/authorize?state=abc";
    let connected = false;
    await page
      .context()
      .route("https://auth.example.test/**", (route) =>
        route.fulfill({ body: "sign in" }),
      );
    await routeApi(page, [
      // The account is per user, so it must not need shared settings.
      on(
        PreferenceService.method.getEnvironment,
        () => new RpcFailure("unavailable", "Unavailable", "INTERNAL_ERROR"),
      ),
      on(ProviderService.method.startChatGptLogin, () => ({
        authorizationUrl,
      })),
      on(ProviderService.method.finishChatGptLogin, () => {
        connected = true;
        return { status: chatGptStatus(true) };
      }),
      on(ProviderService.method.getChatGptStatus, () => ({
        status: chatGptStatus(connected),
      })),
      on(ModelService.method.listModels, () => ({
        models: connected
          ? [
              {
                id: "chatgpt:gpt-5.5",
                name: "GPT-5.5",
                provider: ModelProvider.CHATGPT,
                lab: "OpenAI",
                configured: true,
                inputCapabilities: [InputCapability.TEXT],
              },
            ]
          : [],
      })),
    ]);
    try {
      await page.goto("/");
      for (let step = 0; step < 4; step++) await button(page, "Skip").click();
      await expect(
        page.getByRole("heading", { name: "ChatGPT", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByText("Shared with everyone on this Euler server."),
      ).toBeHidden();
      await expect(page.getByRole("alert")).toBeHidden();

      const popup = page.waitForEvent("popup");
      await button(page, "Sign in with ChatGPT").click();
      await popup;
      await page
        .getByLabel("Callback URL")
        .fill("http://127.0.0.1:1455/auth/callback?code=c&state=abc");
      await button(page, "Connect").click();
      await expect(page.getByText("Nick Example")).toBeVisible();
      await expect(page.getByText("nick@example.com")).toHaveCSS(
        "filter",
        "blur(5px)",
      );
      if (device === "desktop")
        await expect(progress(page)).toContainText("ChatGPT connected");

      await button(page, "Continue").click();
      await expect(
        page.getByRole("heading", { name: "Default model" }),
      ).toBeFocused();
      await expect(
        page.getByRole("button", { name: "Model: GPT-5.5" }),
      ).toBeVisible();

      // Going back reloads the saved account.
      await button(page, "Back").click();
      await expect(page.getByText("Nick Example")).toBeVisible();
      await expect(button(page, "Disconnect")).toBeVisible();
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
    [
      on(
        PreferenceService.method.updatePreferences,
        () =>
          new RpcFailure(
            "unavailable",
            "Settings are unavailable.",
            "INTERNAL_ERROR",
          ),
      ),
    ],
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
  expect(savedSettings(preferences)).toEqual([]);
});

test("onboarding desktop: skipped drafts are discarded and never reach later saves", async ({
  page,
}) => {
  const preferences = new Map<string, UserPreferences>();
  const writes = await routeApi(page, [], preferences, {
    settings: { defaultModel: "qwen3:8b" },
  });
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
  for (let step = 0; step < 8; step++) await button(page, "Skip").click();
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
    const writes = await routeApi(page, [
      on(PreferenceService.method.getEnvironment, () => ({
        ollamaHost: false,
        comfyuiHost: true,
      })),
      on(ProviderService.method.getOllamaConfig, () => ({
        config: { host: "http://saved-ollama:11434" },
      })),
      on(ProviderService.method.getComfyUiConfig, () => ({
        config: { host: "http://env-comfy:8188" },
        image: { defaultWidth: 1440, defaultHeight: 1440 },
      })),
    ]);
    await page.goto("/");
    for (let step = 0; step < 3; step++) await button(page, "Skip").click();
    await expect(page.getByLabel("Server URL")).toHaveValue(
      "http://saved-ollama:11434",
    );
    await expect(progress(page)).toContainText("Ollama configured");
    await button(page, "Continue").click();
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
    for (let step = 0; step < 8; step++) await button(page, "Skip").click();
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
