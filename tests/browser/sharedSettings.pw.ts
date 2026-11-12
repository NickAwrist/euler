import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import { type Page, expect, test } from "@playwright/test";
import {
  CatalogFreshness_Status,
  OllamaContextWindow,
  ProviderService,
} from "../../src/gen/euler/v1/providers_pb";
import type { UserPreferences } from "../../src/schemas/userPreferences";
import { mockRpc, on, rpcKey, rpcMethod, rpcRequest } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

test.use({
  viewport: { width: 1280, height: 900 },
  isMobile: false,
  hasTouch: false,
});

async function mockSettings(
  page: Page,
  writes: string[] = [],
  preferences?: Map<string, UserPreferences>,
) {
  page.on("request", (request) => {
    const method = rpcMethod(request);
    if (
      method?.parent.typeName === ProviderService.typeName &&
      method.idempotency !== MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS &&
      !method.name.startsWith("Test")
    )
      writes.push(rpcKey(request)!);
  });
  await mockRpc(
    page,
    [
      on(ProviderService.method.getOpenRouterCatalog, () => ({
        catalog: { freshness: { status: CatalogFreshness_Status.FRESH } },
      })),
      on(ProviderService.method.getComfyUiConfig, () => ({
        config: {
          host: "http://saved.comfy.test",
          effectiveHost: "http://saved.comfy.test",
        },
        image: {
          defaultModel: "saved.safetensors",
          defaultWidth: 1024,
          defaultHeight: 768,
          negativePrompt: "Keep this",
        },
      })),
      on(ProviderService.method.getOllamaConfig, () => ({
        config: {
          host: "http://saved.ollama.test",
          effectiveHost: "http://saved.ollama.test",
        },
      })),
    ],
    { empty: true },
  );
  await mockUserPreferences(page, preferences);
}

for (const screen of ["Settings", "Onboarding"] as const) {
  test(`settings save desktop: ${screen} ignores a connection result after its address changes`, async ({
    page,
  }) => {
    await mockSettings(page);
    let releaseOld: () => void = () => {};
    const oldPending = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    await mockRpc(page, [
      on(ProviderService.method.testOllamaHost, async ({ host }) => {
        const old = host === "http://old.ollama.test";
        if (old) {
          oldStarted();
          await oldPending;
        }
        return {
          result: {
            ok: true,
            version: old ? "old-version" : "current-version",
          },
        };
      }),
    ]);
    await page.goto(
      screen === "Settings" ? "/dev/settings" : "/dev/onboarding",
    );
    if (screen === "Settings") {
      await page.getByRole("button", { name: "Ollama", exact: true }).click();
    } else {
      for (let step = 0; step < 3; step++)
        await page.getByRole("button", { name: "Skip", exact: true }).click();
    }
    const address = page.locator("#ollamaUri");
    const testConnection = page.getByRole("button", {
      name: "Test connection",
      exact: true,
    });
    await expect(address).toBeEnabled();
    await address.fill("http://old.ollama.test");
    await testConnection.click();
    await started;
    await address.fill("http://current.ollama.test");
    await testConnection.click();
    const current = page.getByText(
      "Connected - Ollama version current-version",
      {
        exact: true,
      },
    );
    await expect(current).toBeVisible();
    const oldResponse = page.waitForResponse(
      (response) =>
        rpcRequest(response.request(), ProviderService.method.testOllamaHost)
          ?.host === "http://old.ollama.test",
    );
    releaseOld();
    await (await oldResponse).finished();
    await expect(current).toBeVisible();
    await expect(
      page.getByText("Connected - Ollama version old-version", { exact: true }),
    ).toBeHidden();
    await address.fill("http://untested.ollama.test");
    await expect(current).toBeHidden();
  });
}

test("settings save desktop: saving a user preference does not rewrite shared provider configurations", async ({
  page,
}) => {
  const writes: string[] = [];
  const preferences = new Map<string, UserPreferences>();
  await mockSettings(page, writes, preferences);
  await page.goto("/");
  for (let step = 0; step < 8; step++)
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page
    .getByRole("button", { name: "Toggle chats", exact: true })
    .waitFor();
  await page.goto("/settings/general");
  await page.getByText("Developer tools", { exact: true }).click();
  await page.getByRole("switch", { name: "Display debug button" }).click();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeHidden();
  expect(writes).toEqual([]);
  expect(
    [...preferences.values()].map((saved) => saved.settings.showDebugButton),
  ).toEqual([true]);
});

test("settings save desktop: the Ollama context window saves without rewriting the address", async ({
  page,
}) => {
  const writes: string[] = [];
  const saved: OllamaContextWindow[] = [];
  await mockSettings(page, writes);
  await mockRpc(page, [
    on(ProviderService.method.setOllamaContextWindow, ({ contextWindow }) => {
      saved.push(contextWindow);
      return { contextWindow };
    }),
  ]);
  await page.goto("/");
  for (let step = 0; step < 8; step++)
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page
    .getByRole("button", { name: "Toggle chats", exact: true })
    .waitFor();
  await page.goto("/settings/ollama");
  const contextWindow = page.getByLabel("Context window");
  await expect(contextWindow).toHaveValue("low");
  await contextWindow.selectOption({ label: "High - 256k" });
  const save = page.getByRole("button", { name: "Save settings", exact: true });
  await expect(page.locator("footer")).toContainText(
    "Unsaved changes in Ollama",
  );
  await save.click();
  await expect(save).toBeHidden();
  await expect(contextWindow).toHaveValue("high");
  expect(saved).toEqual([OllamaContextWindow.HIGH]);
  expect(writes).toEqual(["ProviderService/SetOllamaContextWindow"]);
});

test("settings save desktop: Show QR displays the saved user ID", async ({
  page,
}, testInfo) => {
  const user = "12345678-1234-4234-9234-123456789abc";
  await page.addInitScript((id) => {
    localStorage.setItem("euler:userUuid", id);
  }, user);
  await mockSettings(page);
  await page.goto("/dev/settings");
  // An unsaved draft is not what the phone should scan.
  await page.locator("#userUuid").fill("draft");
  await page.getByRole("button", { name: "Show QR", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "User ID" });
  const code = dialog.getByRole("img", { name: `QR code for ${user}` });
  await expect(code).toBeVisible();
  const box = (await code.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.height).toBeCloseTo(box.width, 1);
  await expect(dialog).toContainText(user);
  await dialog.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    ),
  );
  await page.screenshot({ path: testInfo.outputPath("user-id-qr.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show QR", exact: true }),
  ).toBeFocused();
});
