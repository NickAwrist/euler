import { type Page, expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1280, height: 900 },
  isMobile: false,
  hasTouch: false,
});

function mockSettings(page: Page, writes: string[] = []) {
  return page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PUT") writes.push(path);
    return route.fulfill({
      json: path.endsWith("/environment")
        ? { ollamaHost: false, comfyuiHost: false, searxngHost: false }
        : path.endsWith("/openrouter") || path.endsWith("/brave")
          ? { hasKey: false, environmentManaged: false }
          : path.endsWith("/catalog")
            ? {
                publishers: [],
                modelsByPublisher: {},
                discoveredPublishers: [],
                catalog: { status: "fresh", fetchedAt: null, error: null },
              }
            : path.endsWith("/comfyui/config")
              ? {
                  host: "http://saved.comfy.test",
                  defaultModel: "saved.safetensors",
                  defaultWidth: 1024,
                  defaultHeight: 768,
                  negativePrompt: "Keep this",
                }
              : path.endsWith("/config")
                ? { host: "http://saved.ollama.test" }
                : path === "/api/sessions"
                  ? { sessions: [] }
                  : path.endsWith("/models")
                    ? { models: [] }
                    : { connected: false },
    });
  });
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
    await page.route("**/api/ollama/test", async (route) => {
      const body: unknown = route.request().postDataJSON();
      const old =
        typeof body === "object" &&
        body !== null &&
        "host" in body &&
        body.host === "http://old.ollama.test";
      if (old) {
        oldStarted();
        await oldPending;
      }
      await route.fulfill({
        json: { ok: true, version: old ? "old-version" : "current-version" },
      });
    });
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
        response.url().endsWith("/api/ollama/test") &&
        response.request().postData()?.includes("old.ollama.test") === true,
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
  await mockSettings(page, writes);
  await page.goto("/");
  for (let step = 0; step < 7; step++)
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
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("euler:userSettings") ?? "{}")
          .showDebugButton,
    ),
  ).toBe(true);
});
