import { expect, test } from "@playwright/test";

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
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/settings/environment") {
        await ownershipPending;
        return route.fulfill({
          status: failOwnership ? 500 : 200,
          json: failOwnership
            ? { error: { message: "Unavailable" } }
            : {
                ollamaHost: managed,
                comfyuiHost: managed,
                searxngHost: managed,
              },
        });
      }
      if (path === "/api/settings/openrouter") {
        return route.fulfill({
          json: { hasKey: true, environmentManaged: managed },
        });
      }
      if (route.request().method() !== "GET") writes.push(path);
      return route.fulfill({
        json: path.endsWith("/test")
          ? { ok: true, version: "test" }
          : {
              catalog: {
                status: "fresh",
                lastSuccessfulFetchAt: 1,
                error: null,
              },
              publishers: [],
            },
      });
    });
    await page.goto("/dev/settings");
    await page.getByRole("button", { name: "Ollama", exact: true }).click();
    await expect(page.locator("#ollamaUri")).toBeDisabled();
    await expect(
      page.getByText("Checking environment settings..."),
    ).toBeVisible();
    releaseOwnership();
    ownershipPending = null;

    for (const [tab, id, host] of [
      ["Ollama", "ollamaUri", "http://ollama.test"],
      ["Image Generation", "comfyUri", "http://comfyui.test"],
      ["Web Search", "searxngUri", "http://searxng.test"],
    ]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.locator(`#${id}`)).toBeDisabled();
      await expect(page.locator(`#${id}`)).toHaveValue(host!);
      await expect(
        page.getByText("Managed by the environment.", { exact: false }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Test connection" }).click();
      await expect(
        page.getByRole("button", { name: "Test connection" }),
      ).toBeEnabled();
      if (id === "comfyUri") {
        await expect(page.locator("#comfyNegative")).toBeEnabled();
        await page.locator("#comfyNegative").fill("Still editable");
        await expect(
          page.getByRole("button", { name: "Save settings" }),
        ).toBeEnabled();
      }
    }
    await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
    await expect(page.getByLabel("API key", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
      "••••••••",
    );
    await expect(page.getByRole("button", { name: "Remove key" })).toHaveCount(
      0,
    );
    await page.screenshot({
      path: testInfo.outputPath("environment-managed.png"),
    });
    expect(writes).toEqual([
      "/api/ollama/test",
      "/api/comfyui/test",
      "/api/searxng/test",
    ]);

    managed = false;
    await page.reload();
    for (const [tab, id] of [
      ["Ollama", "ollamaUri"],
      ["Image Generation", "comfyUri"],
      ["Web Search", "searxngUri"],
    ]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.locator(`#${id}`)).toBeEnabled();
    }
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
    ).toBeDisabled();
    expect(errors).toEqual([]);
    await page.close();
  });
}
