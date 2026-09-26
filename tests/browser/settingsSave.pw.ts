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

      await page.getByPlaceholder("Enter your name").fill("Ada");
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
        "NameGeneral",
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
      await expect(page.getByPlaceholder("Enter your name")).toHaveValue("");

      await page.getByRole("switch", { name: "Include current date" }).click();
      await save.click();
      await expect(save).toBeHidden();
      await expect(
        page.getByRole("switch", { name: "Include current date" }),
      ).not.toBeChecked();
    } finally {
      await page.close();
    }
  });
}
