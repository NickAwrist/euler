import { expect, test } from "@playwright/test";

for (const device of ["desktop", "mobile"] as const) {
  test(`model preferences ${device}: catalog states, mutations, favorites and keyboard controls`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      viewport:
        device === "desktop"
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
      isMobile: device === "mobile",
      hasTouch: device === "mobile",
    });
    let enabled = false;
    let favorite = false;
    let localFavorite = false;
    let subscribed = false;
    let failMutation = false;
    let holdWrites: Promise<void> | null = null;
    let status: "fresh" | "stale" | "unavailable" = "fresh";
    let available = true;
    let tracked = false;
    const catalog = () => ({
      status,
      lastSuccessfulFetchAt: status === "unavailable" ? null : 1789170000000,
      error: status === "fresh" ? null : "Refresh failed",
    });
    const publisher = () => ({
      id: "openai",
      name: "OpenAI",
      subscribed,
      subscribedAt: subscribed ? 101 : null,
      enabledCount: Number(enabled),
      recentCount: status === "unavailable" ? null : 1,
    });
    let catalogReads = 0;
    const snapshot = () => ({
      catalog: catalog(),
      publishers: [publisher()],
      modelsByPublisher: {
        openai: [
          {
            route: "openai/test",
            name: "Test",
            publisherId: "openai",
            created: 1789170000,
            enabled,
            favorite,
            supportsTools: true,
            availability:
              status === "unavailable"
                ? "unverified"
                : available
                  ? "available"
                  : "unavailable",
            isNew: true,
            contextLength: 128000,
            promptPricePerMillion: 0,
            completionPricePerMillion: 2,
            inputCapabilities: ["text", "image"],
          },
        ],
      },
      discoveredPublishers:
        status === "unavailable"
          ? null
          : [{ id: "example", name: "Example", tracked }],
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path === "/api/settings/openrouter/catalog") {
        catalogReads++;
        return route.fulfill({ json: snapshot() });
      }
      if (method !== "GET" && method !== "HEAD") {
        await holdWrites;
        if (failMutation)
          return route.fulfill({
            status: 500,
            json: { error: { message: "Preference could not be saved" } },
          });
        const body = route.request().postDataJSON();
        if (path.endsWith("/favorite")) {
          if (body.provider === "ollama") localFavorite = body.favorite;
          else favorite = body.favorite;
        }
        if (path.endsWith("/openrouter/models")) enabled = body.enabled;
        if (path.endsWith("/subscription")) subscribed = body.subscribed;
        if (path.endsWith("/publishers")) tracked = true;
        return route.fulfill({
          json: path.endsWith("/refresh") ? snapshot() : { ok: true },
        });
      }
      const json =
        path === "/api/models"
          ? {
              models: [
                {
                  id: "local-model",
                  name: "Local",
                  provider: "ollama",
                  lab: "Ollama",
                  favorite: localFavorite,
                  inputCapabilities: ["text"],
                },
                ...(enabled && available
                  ? [
                      {
                        id: "openrouter:openai/test",
                        route: "openai/test",
                        name: "Test",
                        provider: "openrouter",
                        lab: "OpenAI",
                        publisherId: "openai",
                        favorite,
                        configured: true,
                        inputCapabilities: ["text", "image"],
                        supportsTools: true,
                      },
                    ]
                  : []),
              ],
            }
          : path.endsWith("/catalog/publishers")
            ? {
                catalog: catalog(),
                publishers:
                  status === "unavailable"
                    ? null
                    : [{ id: "example", name: "Example", tracked }],
              }
            : path.endsWith("/publishers/openai/models")
              ? {
                  catalog: catalog(),
                  models: [
                    {
                      route: "openai/test",
                      name: "Test",
                      publisherId: "openai",
                      created: 1789170000,
                      enabled,
                      favorite,
                      supportsTools: true,
                      availability:
                        status === "unavailable"
                          ? "unverified"
                          : available
                            ? "available"
                            : "unavailable",
                      isNew: true,
                      contextLength: 128000,
                      promptPricePerMillion: 0,
                      completionPricePerMillion: 2,
                      inputCapabilities: ["text", "image"],
                    },
                  ],
                }
              : path.endsWith("/publishers")
                ? { catalog: catalog(), publishers: [publisher()] }
                : path.endsWith("/openrouter")
                  ? { hasKey: true }
                  : path.endsWith("/health")
                    ? { connected: true }
                    : {};
      await route.fulfill({ json });
    });
    try {
      await page.goto("http://127.0.0.1:5199/dev/models");
      await expect(page.getByText("Configured", { exact: true })).toBeVisible();
      const card = page.getByRole("button", { name: /^OpenAI/ });
      await card.waitFor();
      const readsBeforeOpening = catalogReads;
      await expect(card.getByText("New", { exact: true })).toBeVisible();
      await expect(card).not.toContainText("1 new");
      await card.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "OpenAI" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/Input: \$0/)).toBeVisible();
      await expect(dialog.getByText(/Added to OpenRouter:/)).toBeVisible();
      const enable = dialog.getByRole("switch", { name: "Enable Test" });
      let releaseWrites!: () => void;
      holdWrites = new Promise<void>((resolve) => {
        releaseWrites = resolve;
      });
      await dialog
        .getByRole("button", { name: "Favorite Test", exact: true })
        .click();
      // Only the pending control is locked; a different preference remains usable.
      await expect(enable).toBeEnabled();
      await enable.focus();
      await page.keyboard.press("Space");
      await expect(enable).toBeChecked();
      await expect(
        dialog.getByRole("switch", { name: "Auto-enable new models" }),
      ).toBeEnabled();
      releaseWrites();
      holdWrites = null;
      await expect(
        dialog.getByRole("button", { name: "Unfavorite Test", exact: true }),
      ).toBeEnabled();
      await expect(enable).toBeChecked();
      await dialog
        .getByRole("switch", { name: "Auto-enable new models" })
        .click();
      await expect.poll(() => subscribed).toBe(true);
      expect(catalogReads).toBe(readsBeforeOpening);
      await expect(
        dialog.getByRole("button", { name: "Refresh catalog" }),
      ).toHaveCount(0);
      await dialog.getByRole("searchbox").fill("no match");
      await expect(
        dialog.getByText("No matching interactive models."),
      ).toBeVisible();
      await dialog.getByRole("searchbox").fill("");
      failMutation = true;
      await enable.click();
      await expect(dialog.getByRole("alert")).toHaveText(
        "Couldn't save change. Try again.",
      );
      await expect(enable).toBeChecked();
      await dialog
        .getByRole("button", { name: "Dismiss notification" })
        .click();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      failMutation = false;
      status = "stale";
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Refresh catalog", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Refresh catalog", exact: true }),
      ).toBeEnabled();
      await card.click();
      await expect(
        dialog.getByText(/Showing the last known catalog/),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("publisher-stale.png"),
      });
      status = "unavailable";
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Refresh catalog", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Refresh catalog", exact: true }),
      ).toBeEnabled();
      await card.click();
      await expect(
        dialog.getByText("Availability unverified", { exact: true }),
      ).toBeVisible();
      await enable.click();
      await expect(enable).not.toBeChecked();
      await expect(enable).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Unfavorite Test", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(card).toBeFocused();
      await expect(card).toContainText("Recent count unavailable");

      const trigger = page.getByRole("button", { name: /^Model:/ });
      await trigger.click();
      const picker = page.getByRole("dialog", { name: "Choose model" });
      await picker.getByRole("tab", { name: "Favorites", exact: true }).click();
      await expect(
        picker.getByText("Favorite enabled models to find them here."),
      ).toBeVisible();
      await picker.getByRole("tab", { name: "Ollama", exact: true }).click();
      await picker
        .getByRole("button", { name: "Favorite Local", exact: true })
        .click();
      await expect(
        picker.getByRole("button", { name: "Unfavorite Local", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByLabel("Selected model", { exact: true }),
      ).toHaveText("local-model");
      await picker.getByRole("tab", { name: "Favorites", exact: true }).click();
      await expect(
        picker.getByRole("button", { name: "Local Ollama", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");

      status = "fresh";
      await page
        .getByRole("button", { name: "Refresh catalog", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Refresh catalog", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Add publisher", exact: true })
        .click();
      const add = page.getByRole("dialog", { name: "Add publisher" });
      await add.getByRole("searchbox").fill("example");
      await add
        .getByRole("button", { name: "Example Add", exact: true })
        .click();
      await expect(
        add.getByRole("button", { name: "Example Added", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");

      available = false;
      enabled = true;
      await page
        .getByRole("button", { name: "Refresh catalog", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Refresh catalog", exact: true }),
      ).toBeEnabled();
      await card.click();
      await expect(
        dialog.getByText("Unavailable", { exact: true }),
      ).toBeVisible();
      await enable.click();
      await expect(enable).toBeDisabled();
      await page.mouse.click(4, 4);
      await expect(dialog).not.toBeVisible();
      await expect(card).toBeFocused();
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}

for (const device of ["desktop", "mobile"] as const) {
  test(`model preferences ${device}: stable publisher order, model slug and refresh spinner`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      viewport:
        device === "desktop"
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
      isMobile: device === "mobile",
      hasTouch: device === "mobile",
    });
    try {
      await page.goto("/dev/model-playground");
      const settings = page.getByRole("region", {
        name: "OpenRouter settings",
      });
      const cards = settings.getByRole("button", { name: /, \d+ enabled/ });
      const expectAlphabetical = async () => {
        const names = await cards.locator("span.block").allTextContents();
        expect(names.length).toBeGreaterThan(1);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      };
      await expect(cards.first()).toBeVisible();
      await expectAlphabetical();
      await settings
        .getByRole("button", { name: "Add publisher", exact: true })
        .click();
      const add = page.getByRole("dialog", { name: "Add publisher" });
      const slug = add.getByLabel("Add model by slug");
      await slug.fill("cohere/not-a-model");
      await add.getByRole("button", { name: "Add model", exact: true }).click();
      await expect(add.getByRole("alert")).toContainText("not available");
      await slug.fill("cohere/demo-command");
      await add.getByRole("button", { name: "Add model", exact: true }).click();
      await expect(slug).toHaveValue("");
      await page.keyboard.press("Escape");
      await expectAlphabetical();
      const cohere = settings.getByRole("button", {
        name: /^Cohere, 1 enabled/,
      });
      await cohere.click();
      const publisher = page.getByRole("dialog", { name: "Cohere" });
      await expect(
        publisher.getByRole("switch", { name: "Enable Command · Demo" }),
      ).toBeChecked();
      await publisher.getByRole("button", { name: "Remove publisher" }).click();
      await expect(publisher).not.toBeVisible();
      await expectAlphabetical();
      await page
        .getByRole("button", { name: "Slow requests", exact: true })
        .click();
      const refresh = settings.getByRole("button", {
        name: "Refresh catalog",
        exact: true,
      });
      await expect(cards.first()).toBeVisible();
      await refresh.click();
      await expect(refresh).toBeDisabled();
      await expect(refresh).toHaveCSS("opacity", "0.45");
      await expect(refresh).toHaveAttribute("aria-busy", "true");
      await expect(refresh.locator("svg")).toHaveCSS("animation-name", "spin");
      await expect(refresh).toBeEnabled();
      await expectAlphabetical();
      await page.screenshot({ path: testInfo.outputPath("catalog.png") });
      await settings.getByRole("button", { name: /^OpenAI,/ }).click();
      const openai = page.getByRole("dialog", { name: "OpenAI" });
      await expect(openai.locator("article h3")).toHaveText([
        "Retired model · Demo",
        "Reasoning · Demo",
        "Mini · Demo",
      ]);
      await openai
        .getByRole("button", { name: "Favorite Mini · Demo", exact: true })
        .click();
      await expect(openai.locator("article h3")).toHaveText([
        "Retired model · Demo",
        "Mini · Demo",
        "Reasoning · Demo",
      ]);
      await page.screenshot({
        path: testInfo.outputPath("publisher-models.png"),
      });
      await page.keyboard.press("Escape");
      await expect(settings.getByLabel("API key", { exact: true })).toHaveCount(
        0,
      );
      await settings
        .getByRole("button", { name: "Update key", exact: true })
        .click();
      const keyInput = settings.getByLabel("API key", { exact: true });
      await keyInput.fill("discard-this-key");
      await settings
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(keyInput).toHaveCount(0);
      await settings
        .getByRole("button", { name: "Update key", exact: true })
        .click();
      await expect(keyInput).toHaveValue("");
      await settings
        .getByRole("button", { name: "Remove key", exact: true })
        .click();
      await expect(
        settings.getByText("Not configured", { exact: true }),
      ).toBeVisible();
      await expect(cards).toHaveCount(0);
      await expect(refresh).toHaveCount(0);
      await expect(
        settings.getByRole("button", { name: "Add publisher", exact: true }),
      ).toHaveCount(0);
      await keyInput.fill("demo-test-key");
      await settings
        .getByRole("button", { name: "Save key", exact: true })
        .click();
      await expect(
        settings.getByText("Configured", { exact: true }),
      ).toBeVisible();
      await expect(keyInput).toHaveCount(0);
      await expect(cards.first()).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("configured-key.png"),
      });
    } finally {
      await page.close();
    }
  });
}

for (const device of ["desktop", "mobile"] as const) {
  test(`model preferences ${device}: long catalog keeps dialog controls clear of scrolling lists`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      viewport:
        device === "desktop"
          ? { width: 1280, height: 800 }
          : { width: 390, height: 844 },
      isMobile: device === "mobile",
      hasTouch: device === "mobile",
    });
    try {
      await page.goto("/dev/model-playground");
      await page
        .getByRole("button", { name: "Large catalog", exact: true })
        .click();
      const settings = page.getByRole("region", {
        name: "OpenRouter settings",
      });
      await settings.getByRole("button", { name: /^Anthropic,/ }).click();
      for (const name of ["Anthropic", "Add publisher"]) {
        const dialog = page.getByRole("dialog", { name, exact: true });
        await expect(dialog).toBeVisible();
        await dialog.evaluate(async (element) => {
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished),
          );
        });
        const search = dialog.getByRole("searchbox");
        const controls = search.locator("..");
        const list = controls.locator("xpath=following-sibling::div[1]");
        const first =
          name === "Anthropic"
            ? list.locator("article").first()
            : list.getByRole("button").first();
        await expect(first).toBeVisible();
        const controlBounds = await controls.boundingBox();
        const searchBounds = await search.boundingBox();
        const firstBounds = await first.boundingBox();
        expect(controlBounds).not.toBeNull();
        expect(searchBounds).not.toBeNull();
        expect(firstBounds).not.toBeNull();
        expect(searchBounds!.y + searchBounds!.height).toBeLessThanOrEqual(
          controlBounds!.y + controlBounds!.height,
        );
        expect(firstBounds!.y).toBeGreaterThanOrEqual(
          controlBounds!.y + controlBounds!.height,
        );
        if (name === "Anthropic") {
          const footerBounds = await dialog.locator("footer").boundingBox();
          const listBounds = await list.boundingBox();
          expect(listBounds!.y + listBounds!.height).toBeLessThanOrEqual(
            footerBounds!.y,
          );
        }
        expect(
          await list.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        ).toBe(true);
        await list.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(
          await list.evaluate((element) => element.scrollTop),
        ).toBeGreaterThan(0);
        expect(await search.boundingBox()).toEqual(searchBounds);
        await page.screenshot({
          path: testInfo.outputPath(`${name}-scrolled.png`),
        });
        await search.fill(name === "Anthropic" ? "demo-sonnet" : "cohere");
        await expect(
          name === "Anthropic"
            ? list.locator("article")
            : list.getByRole("button"),
        ).toHaveCount(1);
        await page.screenshot({
          path: testInfo.outputPath(`${name}-filtered.png`),
        });
        await page.keyboard.press("Escape");
        if (name === "Anthropic") {
          await settings
            .getByRole("button", { name: "Add publisher", exact: true })
            .click();
        }
      }
    } finally {
      await page.close();
    }
  });
}
