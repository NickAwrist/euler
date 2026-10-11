import { expect, test } from "@playwright/test";
import { mockUserPreferences } from "./userPreferencesFixture";

for (const device of ["desktop", "mobile"] as const) {
  test(`settings save ${device}: OpenRouter balance refresh and key changes`, async ({
    browser,
  }) => {
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:5199",
      viewport:
        device === "desktop"
          ? { width: 1280, height: 800 }
          : { width: 390, height: 844 },
    });
    let hasKey = true;
    let fail = false;
    let accountBalance: number | null = 18.75;
    let keyLimit: number | null = 20;
    let reads = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/settings/openrouter/balance") {
        reads++;
        return route.fulfill(
          fail
            ? {
                status: 500,
                json: { error: { code: "INTERNAL_ERROR", message: "Failed" } },
              }
            : {
                json: {
                  accountBalance,
                  keyLimit,
                  keyRemaining: keyLimit === null ? null : 7.5,
                  keyLimitReset: "monthly",
                  keyUsage: 32.5,
                },
              },
        );
      }
      if (path === "/api/settings/openrouter") {
        if (route.request().method() === "PUT")
          hasKey = Boolean(route.request().postDataJSON().apiKey);
        return route.fulfill({ json: { hasKey, environmentManaged: false } });
      }
      if (path === "/api/settings/openrouter/catalog")
        return route.fulfill({
          json: {
            catalog: {
              status: "fresh",
              lastSuccessfulFetchAt: Date.now(),
              error: null,
            },
            publishers: [],
            modelsByPublisher: {},
            discoveredPublishers: [],
          },
        });
      return route.fulfill({ json: { ollamaHost: false, comfyuiHost: false } });
    });
    try {
      await mockUserPreferences(page);
      await page.goto("/dev/settings");
      await page
        .getByRole("button", { name: "OpenRouter", exact: true })
        .click();
      const card = page.getByRole("region", { name: "OpenRouter credits" });
      await expect(card).toContainText("$18.75");
      await expect(card).toContainText("$7.50");
      await expect(card).toContainText("$32.50");
      fail = true;
      await card.getByRole("button", { name: "Refresh balance" }).click();
      await expect(card.getByRole("alert")).toContainText("Could not load");
      await expect(card).not.toContainText("$18.75");
      fail = false;
      accountBalance = null;
      keyLimit = null;
      await card.getByRole("button", { name: "Refresh balance" }).click();
      await expect(card).toContainText("Unavailable for this key");
      await expect(card).toContainText("No spending limit");
      accountBalance = 42;
      await page.getByRole("button", { name: "Update key" }).click();
      await page.getByLabel("API key", { exact: true }).fill("replacement-key");
      await page.getByRole("button", { name: "Save key", exact: true }).click();
      await expect(card).toContainText("$42.00");
      const readsBeforeRemoval = reads;
      await page.getByRole("button", { name: "Update key" }).click();
      await page.getByRole("button", { name: "Remove key" }).click();
      await expect(card).toBeHidden();
      expect(reads).toBe(readsBeforeRemoval);
    } finally {
      await page.close();
    }
  });
}
