import { expect, test } from "@playwright/test";

for (const device of ["desktop", "mobile"] as const) {
  test(`settings save ${device}: visible controls, dirty tabs, and discard warning`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:5199",
      viewport:
        device === "desktop"
          ? { width: 1280, height: 800 }
          : { width: 390, height: 844 },
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json: { ollamaHost: false, comfyuiHost: false, searxngHost: false },
      }),
    );
    try {
      await page.goto("/dev/settings");
      const save = page.getByRole("button", { name: "Save settings" });
      const footer = page.locator("footer");
      await expect(save).toBeHidden();

      if (device === "mobile") {
        const general = await page
          .getByRole("button", { name: "General", exact: true })
          .boundingBox();
        for (const name of ["Image Generation", "Web Search"]) {
          const tab = page.getByRole("button", { name, exact: true });
          await expect(tab).toBeInViewport({ ratio: 1 });
          expect((await tab.boundingBox())!.height).toBe(general!.height);
        }
      }

      await page.getByText("Developer tools", { exact: true }).click();
      await page.getByRole("switch", { name: "Display debug button" }).click();
      await expect(save).toBeInViewport();
      await expect(footer).toContainText("Unsaved changes in General");

      await page
        .getByRole("button", { name: "Image Generation", exact: true })
        .click();
      await page.getByLabel("Negative Prompt").fill("blurry");
      await expect(footer).toContainText(
        "Unsaved changes in General, Image Generation",
      );
      await page.screenshot({
        path: testInfo.outputPath(`${device}-settings-dirty.png`),
      });

      await footer.getByRole("button", { name: "Discard" }).click();
      const dialog = page.getByRole("dialog", { name: "Discard changes?" });
      const changes = dialog.getByRole("list", { name: "Changed settings" });
      await expect(changes.getByRole("listitem")).toHaveText([
        "Display debug buttonGeneral",
        "Negative promptImage Generation",
      ]);
      await expect(
        dialog.getByRole("button", { name: "Save & leave" }),
      ).toHaveCount(0);
      await dialog.evaluate((element) =>
        Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished),
        ),
      );
      await page.screenshot({
        path: testInfo.outputPath(`${device}-settings-discard.png`),
      });
      await dialog.getByRole("button", { name: "Keep editing" }).last().click();
      await expect(page.getByLabel("Negative Prompt")).toHaveValue("blurry");

      await footer.getByRole("button", { name: "Discard" }).click();
      await dialog.getByRole("button", { name: "Discard changes" }).click();
      await expect(dialog).toBeHidden();
      await expect(save).toBeHidden();
      await expect(page.getByLabel("Negative Prompt")).toHaveValue("");
      await page.getByRole("button", { name: "General", exact: true }).click();
      await page.getByText("Developer tools", { exact: true }).click();
      await expect(
        page.getByRole("switch", { name: "Display debug button" }),
      ).not.toBeChecked();

      // The visible label toggles the switch.
      await page.locator("label[for=showDebugButton]").click();
      await save.click();
      await expect(save).toBeHidden();
      await expect(
        page.getByRole("switch", { name: "Display debug button" }),
      ).toBeChecked();
    } finally {
      await page.close();
    }
  });
}

test("settings save desktop: Brave key saves from the shared form without browser storage", async ({
  page,
}) => {
  const saves: unknown[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/settings/brave" && request.method() === "PUT") {
      saves.push(request.postDataJSON());
      return route.fulfill({ json: { ok: true, hasKey: true } });
    }
    return route.fulfill({
      json:
        path === "/api/settings/brave"
          ? { hasKey: false, environmentManaged: false }
          : { ollamaHost: false, comfyuiHost: false, searxngHost: false },
    });
  });
  await page.goto("/dev/settings");
  await page.getByRole("button", { name: "Web Search", exact: true }).click();
  const key = page.getByLabel("API key", { exact: true });
  await key.fill("brave-secret");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByLabel("API key · Configured")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Remove key" })).toBeVisible();
  // Saving immediately keeps the key out of the Settings unsaved-changes footer.
  await expect(
    page.getByRole("button", { name: "Save settings" }),
  ).toBeHidden();
  expect(saves).toEqual([{ apiKey: "brave-secret" }]);
  const stored = await page.evaluate(() =>
    Object.keys(localStorage).map((name) => localStorage.getItem(name)),
  );
  expect(stored.some((value) => value?.includes("brave-secret"))).toBe(false);
});
