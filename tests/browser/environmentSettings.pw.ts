import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import { expect, test } from "@playwright/test";
import { PreferenceService } from "../../src/gen/euler/v1/preferences_pb";
import {
  CatalogFreshness_Status,
  ProviderService,
} from "../../src/gen/euler/v1/providers_pb";
import { at } from "./appFixture";
import { RpcFailure, mockRpc, on, rpcKey, rpcMethod } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

for (const device of ["desktop", "mobile"] as const) {
  test(`environment settings ${device}: locked fields, editable defaults and loading failure`, async ({
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
    let managed = true;
    let failOwnership = false;
    let releaseOwnership: () => void = () => {};
    let ownershipPending: Promise<void> | null = new Promise((resolve) => {
      releaseOwnership = resolve;
    });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const method = rpcMethod(request);
      if (
        method &&
        method.idempotency !== MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
      )
        writes.push(rpcKey(request)!);
    });
    const hostTest = { result: { ok: true, version: "test" } };
    await mockRpc(
      page,
      [
        on(PreferenceService.method.getEnvironment, async () => {
          await ownershipPending;
          return failOwnership
            ? new RpcFailure("internal", "Unavailable", "INTERNAL_ERROR")
            : { ollamaHost: managed };
        }),
        on(ProviderService.method.getApiKey, () => ({
          state: { hasKey: true, environmentManaged: managed },
        })),
        on(ProviderService.method.testOllamaHost, () => hostTest),
        on(ProviderService.method.getModelCatalog, () => ({
          catalog: {
            freshness: {
              status: CatalogFreshness_Status.FRESH,
              lastSuccessfulFetchAt: at(1),
            },
          },
        })),
      ],
      { empty: true },
    );
    await mockUserPreferences(page);
    await page.goto("/dev/settings");
    await page.getByRole("button", { name: "Ollama", exact: true }).click();
    await expect(page.locator("#ollamaUri")).toBeDisabled();
    await expect(
      page.getByText("Checking environment settings..."),
    ).toBeVisible();
    releaseOwnership();
    ownershipPending = null;

    await expect(page.locator("#ollamaUri")).toBeDisabled();
    await expect(page.locator("#ollamaUri")).toHaveValue("http://ollama.test");
    await expect(
      page.getByText("Managed by the environment.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(
      page.getByRole("button", { name: "Test connection" }),
    ).toBeEnabled();
    await expect(page.locator("#ollamaContextWindow")).toBeEnabled();
    await page.locator("#ollamaContextWindow").selectOption("high");
    await expect(
      page.getByRole("button", { name: "Save settings" }),
    ).toBeEnabled();
    for (const tab of ["OpenRouter", "Vercel AI Gateway", "Web Search"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.getByLabel("API key", { exact: true })).toBeDisabled();
      await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
        "••••••••",
      );
      await expect(
        page.getByRole("button", { name: "Remove key" }),
      ).toHaveCount(0);
    }
    await page.screenshot({
      path: testInfo.outputPath("environment-managed.png"),
    });
    expect(writes).toEqual(["ProviderService/TestOllamaHost"]);

    managed = false;
    await page.reload();
    await page.getByRole("button", { name: "Ollama", exact: true }).click();
    await expect(page.locator("#ollamaUri")).toBeEnabled();
    await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
    await page.getByRole("button", { name: "Update key" }).click();
    await expect(page.getByLabel("API key", { exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Remove key" }),
    ).toBeEnabled();

    failOwnership = true;
    await page.reload();
    await page.getByRole("button", { name: "Ollama", exact: true }).click();
    await expect(
      page.getByText("Could not load environment settings.", { exact: false }),
    ).toBeVisible();
    await expect(page.locator("#ollamaUri")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save settings" }),
    ).toBeHidden();
    expect(errors).toEqual([]);
    await page.close();
  });
}
