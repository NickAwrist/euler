import { expect, test } from "@playwright/test";
import {
  CatalogFreshness_Status,
  ProviderService,
} from "../../src/gen/euler/v1/providers_pb";
import { at } from "./appFixture";
import { RpcFailure, mockRpc, on } from "./rpcMock";
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
    await mockRpc(
      page,
      [
        on(ProviderService.method.getOpenRouterBalance, () => {
          reads++;
          if (fail)
            return new RpcFailure("internal", "Failed", "INTERNAL_ERROR");
          return {
            accountBalance: accountBalance ?? undefined,
            keyLimit: keyLimit ?? undefined,
            keyRemaining: keyLimit === null ? undefined : 7.5,
            keyLimitReset: "monthly",
            keyUsage: 32.5,
          };
        }),
        on(ProviderService.method.getApiKey, () => ({
          state: { hasKey, environmentManaged: false },
        })),
        on(ProviderService.method.setApiKey, ({ apiKey }) => {
          hasKey = Boolean(apiKey);
          return { state: { hasKey, environmentManaged: false } };
        }),
        on(ProviderService.method.getOpenRouterCatalog, () => ({
          catalog: {
            freshness: {
              status: CatalogFreshness_Status.FRESH,
              lastSuccessfulFetchAt: at(Date.now()),
            },
          },
        })),
      ],
      { empty: true },
    );
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
