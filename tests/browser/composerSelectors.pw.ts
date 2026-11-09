import { expect, test } from "@playwright/test";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import {
  InputCapability,
  ModelProvider,
  ModelService,
  Model_Availability,
} from "../../src/gen/euler/v1/models_pb";
import {
  CatalogFreshness_Status,
  ProviderService,
} from "../../src/gen/euler/v1/providers_pb";
import { SessionService } from "../../src/gen/euler/v1/sessions_pb";
import {
  type ModelInit,
  at,
  mockApp,
  ollamaModel,
  openRouterModel,
} from "./appFixture";
import { mockRpc, on } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

const models: ModelInit[] = [
  ollamaModel("gemma4:e4b", {
    inputCapabilities: [InputCapability.TEXT, InputCapability.IMAGE],
    supportsTools: true,
  }),
  ...(
    [
      ["anthropic/claude-sonnet", "Claude Sonnet", "Anthropic"],
      ["anthropic/claude-opus", "Claude Opus", "Anthropic"],
      ["openai/gpt", "GPT", "OpenAI"],
    ] as const
  ).map(([route, name, lab]) =>
    openRouterModel(route, {
      name,
      lab,
      // Unverified routes carry placeholder capabilities.
      ...(route === "openai/gpt" && {
        availability: Model_Availability.UNVERIFIED,
      }),
    }),
  ),
];

for (const device of ["desktop", "mobile"] as const) {
  test(`composer selectors ${device}: provider selection, search, and composer state`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:5199",
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let sessionModel = "openrouter:anthropic/claude-sonnet";
    let catalog = models;
    let sessionReads = 0;
    const runs: { model: string; content: string }[] = [];
    await mockApp(page, {
      sessions: [
        {
          id: "selector",
          preview: "Selector test",
          createdAt: at(1),
          updatedAt: at(1),
        },
      ],
    });
    await mockRpc(page, [
      on(ModelService.method.listModels, () => ({ models: catalog })),
      on(SessionService.method.getSession, ({ id }) => {
        if (id !== "selector") return undefined;
        sessionReads++;
        return { session: { id, model: sessionModel } };
      }),
      on(SessionService.method.updateSession, ({ model }) => {
        if (model) sessionModel = model;
        return {};
      }),
      on(AgentService.method.sendMessage, ({ settings, content }) => {
        runs.push({ model: settings?.model ?? "", content });
        return { messageId: BigInt(runs.length), queued: false };
      }),
      on(ProviderService.method.getApiKey, () => ({
        state: { hasKey: true, environmentManaged: false },
      })),
      on(ProviderService.method.getOpenRouterCatalog, () => ({
        catalog: {
          freshness: {
            status: CatalogFreshness_Status.FRESH,
            lastSuccessfulFetchAt: at(Date.now()),
          },
        },
      })),
    ]);
    // Exercise icon failure without depending on an external service.
    await page.route("https://openrouter.ai/**", (route) => route.abort());
    try {
      await mockUserPreferences(page);
      await page.goto("/run/selector");
      const model = page.getByRole("button", { name: /^Model:/ });
      const input = page.getByPlaceholder("Send a message...");
      await input.fill("Keep this draft");
      const modelBounds = await model.boundingBox();
      const inputBounds = await input.boundingBox();
      expect(modelBounds!.y).toBeGreaterThan(
        inputBounds!.y + inputBounds!.height,
      );
      if (device === "mobile") await model.tap();
      else {
        await page.keyboard.press("Control+m");
      }
      const menu = page.getByRole("dialog", { name: "Choose model" });
      await expect(menu).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Anthropic" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        menu.getByRole("button", { name: "Claude Sonnet Chat only" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        menu.getByRole("button", {
          name: "GPT Availability unverified",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(menu).toHaveCSS("opacity", "1");
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(8);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width - 8,
      );
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(modelBounds!.y);
      await page.screenshot({
        path: testInfo.outputPath(`${device}-model-menu.png`),
      });
      await menu.getByRole("searchbox").fill("OPUS");
      await expect(
        menu.getByRole("button", { name: "Claude Sonnet Chat only" }),
      ).toHaveCount(0);
      await menu.getByRole("button", { name: "Claude Opus Chat only" }).click();
      await expect(menu).not.toBeVisible();
      await expect(model).toHaveAccessibleName("Model: Claude Opus");
      await expect(input).toHaveValue("Keep this draft");
      await model.click();
      await page.getByRole("tab", { name: "OpenAI" }).click();
      await expect(menu.getByRole("searchbox")).toHaveValue("");
      await menu
        .getByRole("button", {
          name: "GPT Availability unverified",
          exact: true,
        })
        .click();
      await expect(model).toHaveAccessibleName("Model: GPT");
      await expect(
        page.getByRole("button", {
          name: "The selected model does not accept images",
        }),
      ).toBeDisabled();
      expect(runs).toHaveLength(0);
      await model.click();
      await page.keyboard.press("Escape");
      await expect(menu).not.toBeVisible();
      await expect(model).toBeFocused();
      await model.click();
      // Click the right gutter; the chat list may overlay the left one.
      const main = page.locator("main");
      const { width } = (await main.boundingBox())!;
      await main.click({ position: { x: width - 50, y: 50 } });
      await expect(menu).not.toBeVisible();
      await expect.poll(() => sessionModel).toBe("openrouter:openai/gpt");
      await model.click();
      await page.getByRole("tab", { name: "Ollama" }).click();
      await menu.getByRole("searchbox").fill("no-such-model");
      await expect(menu.getByText("No matching models")).toBeVisible();
      await menu.getByRole("searchbox").fill("gemma");
      if (device === "desktop") {
        await page.keyboard.press("ArrowDown");
        await expect(
          menu.getByRole("button", { name: "gemma4:e4b Vision Tools" }),
        ).toBeFocused();
        await menu.getByRole("searchbox").press("Enter");
      } else {
        await expect(menu.getByRole("img", { name: "Vision" })).toBeVisible();
        await menu
          .getByRole("button", { name: "gemma4:e4b Vision Tools" })
          .tap();
      }
      await expect(model).toHaveAccessibleName("Model: gemma4:e4b");
      await expect(model.locator('img[src="/icons/ollama.svg"]')).toBeVisible();
      await expect
        .poll(() =>
          model
            .locator("img")
            .evaluate(
              (image) =>
                image instanceof HTMLImageElement && image.naturalWidth > 0,
            ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${device}-ollama-composer.png`),
      });
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Send message" }).click();
      await expect.poll(() => runs.length).toBe(1);
      expect(runs[0]).toMatchObject({
        model: "gemma4:e4b",
        content: "Keep this draft",
      });
      await expect(input).toHaveValue("");
      // Keyboard behavior follows the device's pointer, not the layout width.
      await page.setViewportSize({
        width: device === "desktop" ? 600 : 1024,
        height: 800,
      });
      await input.fill("Draft after submission");
      await input.press(device === "mobile" ? "Enter" : "Shift+Enter");
      await expect(input).toHaveValue("Draft after submission\n");
      await input.press("Shift+Enter");
      await input.press("a");
      await expect(input).toHaveValue("Draft after submission\n\na");
      expect(runs).toHaveLength(1);
      await input.dispatchEvent("keydown", {
        key: "Enter",
        isComposing: true,
      });
      await input.dispatchEvent("keydown", {
        key: "Enter",
        repeat: true,
      });
      await input.dispatchEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        isComposing: true,
      });
      await input.dispatchEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        repeat: true,
      });
      await expect(input).toHaveValue("Draft after submission\n\na");
      expect(runs).toHaveLength(1);
      await input.press(device === "mobile" ? "Control+Enter" : "Enter");
      await expect.poll(() => runs.length).toBe(2);
      expect(runs[1]?.content).toBe("Draft after submission\n\na");
      await expect(input).toHaveValue("");
      await page.setViewportSize({
        width: device === "desktop" ? 1280 : 390,
        height: device === "desktop" ? 800 : 844,
      });
      await input.fill("Send with Command");
      await input.press("Meta+Enter");
      await expect.poll(() => runs.length).toBe(3);
      expect(runs[2]?.content).toBe("Send with Command");
      await expect(input).toHaveValue("");

      // A refreshed catalog must not silently replace the selected model.
      catalog = models.filter(
        (entry) => entry.provider === ModelProvider.OPENROUTER,
      );
      await page.evaluate(() =>
        window.dispatchEvent(new Event("model-preferences-changed")),
      );
      await expect(model).toHaveAccessibleName(
        "Model: gemma4:e4b (unavailable)",
      );
      await input.fill("Explicit replacement required");
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeDisabled();
      expect(sessionModel).toBe("gemma4:e4b");

      sessionModel = "missing-model";
      catalog = [];
      await page.reload();
      await expect(model).toBeEnabled();
      await expect(model).toHaveAccessibleName(
        "Model: missing-model (unavailable)",
      );
      await input.fill("Keep this unsent draft");
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeDisabled();
      if (device === "desktop") await input.press("Enter");
      await input.press("Control+Enter");
      await input.press("Meta+Enter");
      await expect(input).toHaveValue("Keep this unsent draft");
      expect(runs).toHaveLength(3);

      const readsBeforeSettings = sessionReads;
      await model.click();
      await menu.getByRole("button", { name: "Choose models" }).click();
      await expect(
        page.getByRole("heading", { name: "Publishers", exact: true }),
      ).toBeVisible();
      expect(sessionReads).toBe(readsBeforeSettings);
      await page.getByRole("button", { name: "Back to chat" }).click();
      await expect(input).toHaveValue("Keep this unsent draft");
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}
