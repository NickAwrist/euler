import { expect, test } from "@playwright/test";
import type { ModelOption } from "../../ui/types";

const models: ModelOption[] = [
  {
    id: "gemma4:e4b",
    name: "gemma4:e4b",
    lab: "Ollama",
    provider: "ollama",
    inputCapabilities: ["text"],
  },
  ...(
    [
      ["anthropic/claude-sonnet", "Claude Sonnet", "Anthropic"],
      ["anthropic/claude-opus", "Claude Opus", "Anthropic"],
      ["openai/gpt", "GPT", "OpenAI"],
    ] as const
  ).map(
    ([route, name, lab]): ModelOption => ({
      id: `openrouter:${route}`,
      route,
      name,
      lab,
      provider: "openrouter",
      configured: true,
      inputCapabilities: ["text"],
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let sessionModel = "openrouter:anthropic/claude-sonnet";
    let catalog = models;
    let sessionReads = 0;
    const runs: { model: string; agentName: string; message: string }[] = [];
    const finishRun = Promise.withResolvers<void>();
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (
        path === "/api/sessions/selector" &&
        route.request().method() === "GET"
      )
        sessionReads++;
      if (path === "/api/settings/openrouter")
        return route.fulfill({ json: { hasKey: true } });
      if (path === "/api/settings/openrouter/catalog")
        return route.fulfill({
          json: {
            publishers: [],
            modelsByPublisher: {},
            discoveredPublishers: [],
            catalog: {
              status: "fresh",
              lastSuccessfulFetchAt: Date.now(),
              error: null,
            },
          },
        });
      if (path === "/api/runs" && route.request().method() === "POST") {
        runs.push(route.request().postDataJSON());
        await finishRun.promise;
        await route.fulfill({
          contentType: "text/event-stream",
          body: 'data: {"type":"run_done"}\n\n',
        });
        return;
      }
      if (
        path === "/api/sessions/selector" &&
        route.request().method() === "PATCH"
      ) {
        const patch = route.request().postDataJSON() as { model?: string };
        if (patch.model) sessionModel = patch.model;
      }
      const json =
        path === "/api/models"
          ? { models: catalog }
          : path === "/api/sessions/selector"
            ? { id: "selector", model: sessionModel, history: [] }
            : path === "/api/sessions"
              ? {
                  sessions: [
                    {
                      id: "selector",
                      preview: "Selector test",
                      createdAt: 1,
                      updatedAt: 1,
                    },
                  ],
                }
              : path === "/api/agents"
                ? {
                    agents: ["General", "Engineer"].map((name) => ({
                      id: name,
                      name,
                      description: "",
                      system_prompt: "",
                      is_default: 0,
                      tools: [],
                      skill_ids: [],
                      delegate_agent_ids: [],
                      created_at: 1,
                      updated_at: 1,
                    })),
                  }
                : path === "/api/settings/default-run-agent"
                  ? { agentName: "General" }
                  : path.startsWith("/api/runs/active/")
                    ? { active: false }
                    : path.endsWith("/health")
                      ? { connected: true }
                      : {};
      await route.fulfill({ json });
    });
    // Exercise icon failure without depending on an external service.
    await page.route("https://openrouter.ai/**", (route) => route.abort());
    try {
      await page.goto("/run/selector");
      const model = page.getByRole("button", { name: /^Model:/ });
      const agent = page.getByRole("combobox", { name: "Agent", exact: true });
      const input = page.getByPlaceholder("Send a message...");
      await input.fill("Keep this draft");
      const modelBounds = await model.boundingBox();
      const inputBounds = await input.boundingBox();
      const agentBounds = await agent.boundingBox();
      expect(modelBounds!.y).toBeGreaterThan(
        inputBounds!.y + inputBounds!.height,
      );
      expect(agentBounds!.x).toBeGreaterThan(
        modelBounds!.x + modelBounds!.width,
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
        menu.getByRole("button", { name: "Claude Sonnet OpenRouter" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        menu.getByRole("button", { name: "GPT OpenRouter" }),
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
        menu.getByRole("button", { name: "Claude Sonnet OpenRouter" }),
      ).toHaveCount(0);
      await menu
        .getByRole("button", { name: "Claude Opus OpenRouter" })
        .click();
      await expect(menu).not.toBeVisible();
      await expect(model).toHaveAccessibleName("Model: Claude Opus");
      await expect(input).toHaveValue("Keep this draft");
      await model.click();
      await page.getByRole("tab", { name: "OpenAI" }).click();
      await expect(menu.getByRole("searchbox")).toHaveValue("");
      await menu.getByRole("button", { name: "GPT OpenRouter" }).click();
      await expect(model).toHaveAccessibleName("Model: GPT");
      await agent.selectOption("Engineer");
      await expect(agent).toHaveValue("Engineer");
      expect(runs).toHaveLength(0);
      await model.click();
      await page.keyboard.press("Escape");
      await expect(menu).not.toBeVisible();
      await expect(model).toBeFocused();
      await model.click();
      await page.mouse.click(200, 200);
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
          menu.getByRole("button", { name: "gemma4:e4b Ollama" }),
        ).toBeFocused();
        await page.keyboard.press("Enter");
      } else {
        await menu.getByRole("button", { name: "gemma4:e4b Ollama" }).tap();
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
        agentName: "Engineer",
        message: "Keep this draft",
      });
      await expect(model).toBeDisabled();
      await expect(agent).toBeDisabled();
      await page.getByRole("button", { name: "Stop generation" }).click();
      await expect(model).toBeEnabled();
      finishRun.resolve();

      // A refreshed catalog must not silently replace the selected model.
      catalog = models.filter((entry) => entry.provider === "openrouter");
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
      await input.press("Enter");
      await expect(input).toHaveValue("Keep this unsent draft");
      expect(runs).toHaveLength(1);

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
      finishRun.resolve();
      await page.close();
    }
  });
}
