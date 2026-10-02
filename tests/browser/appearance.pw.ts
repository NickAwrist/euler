import { expect, test } from "@playwright/test";

const apiFixture = (url: string) =>
  url.endsWith("/api/settings/environment")
    ? { ollamaHost: false, comfyuiHost: false, searxngHost: false }
    : {};

// These checks exercise returning users; first-visit setup has its own suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
});

for (const device of ["desktop", "mobile"] as const) {
  test(`settings save ${device}: appearance previews stay local until saved and drafts survive tab changes`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:5199",
      viewport:
        device === "desktop"
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({ json: apiFixture(route.request().url()) }),
    );
    try {
      await page.goto("/dev/settings");
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      const preview = page.getByRole("region", { name: "Response preview" });
      const font = page.getByLabel("Font style", { exact: true });
      const codeFont = page.getByLabel("Code block font", { exact: true });
      const save = page.getByRole("button", {
        name: "Save settings",
        exact: true,
      });
      const originalFont = await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).fontFamily);
      await expect(save).toBeHidden();
      await page.getByText("Nord", { exact: true }).click();
      await font.selectOption("serif");
      await codeFont.selectOption("jetbrains-mono");
      await page.getByLabel("Chat width", { exact: true }).selectOption("wide");
      await page.getByLabel("Sidebar animation", { exact: true }).fill("150");
      await expect(page.locator("html")).toHaveCSS("--chat-width", "768px");
      await expect(preview).toHaveCount(1);
      await expect(preview.locator(".markdown-code-block")).toHaveCount(1);
      await expect(preview.locator("p").first()).toHaveCSS(
        "font-family",
        /Source Serif 4/,
      );
      await expect(preview.locator("pre code")).toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      await expect(preview).toHaveCSS("background-color", "rgb(46, 52, 64)");
      await expect(page.locator("body")).toHaveCSS("font-family", originalFont);
      await expect(page.locator("html")).toHaveAttribute(
        "data-font",
        "default",
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-code-font",
        "default",
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        "default",
      );
      expect(
        await page.evaluate(() => localStorage.getItem("euler:appearance")),
      ).toBeNull();
      await expect(page.locator("footer")).toContainText(
        "Unsaved changes in Appearance",
      );
      await page.getByRole("button", { name: "General", exact: true }).click();
      await page.getByText("Developer tools", { exact: true }).click();
      await page.getByRole("switch", { name: "Display debug button" }).click();
      await expect(page.locator("footer")).toContainText(
        "Unsaved changes in General, Appearance",
      );
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await expect(font).toHaveValue("serif");
      await expect(codeFont).toHaveValue("jetbrains-mono");
      await page
        .getByLabel("Chat width", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`chat-width-settings-${device}.png`),
      });
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`appearance-draft-${device}.png`),
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await save.click();
      await expect(save).toBeHidden();
      await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
      await expect(page.locator("html")).toHaveAttribute(
        "data-code-font",
        "jetbrains-mono",
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", "nord");
      await expect(page.locator("html")).toHaveCSS("--chat-width", "1152px");
      await expect(page.locator("html")).toHaveCSS(
        "--sidebar-duration",
        "150ms",
      );
      await page.reload();
      await expect(page.locator("html")).toHaveCSS("--chat-width", "1152px");
      await expect(page.locator("body")).toHaveCSS(
        "font-family",
        /Source Serif 4/,
      );
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await page.getByLabel("Chat width", { exact: true }).selectOption("full");
      await font.selectOption("default");
      await codeFont.selectOption("default");
      await expect(preview.locator("p").first()).toHaveCSS(
        "font-family",
        originalFont,
      );
      await expect(preview.locator("pre code")).not.toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      await expect(page.locator("body")).toHaveCSS(
        "font-family",
        /Source Serif 4/,
      );
      await page
        .locator("footer")
        .getByRole("button", { name: "Discard", exact: true })
        .click();
      const discard = page.getByRole("dialog", { name: "Discard changes?" });
      await expect(
        discard.getByRole("list", { name: "Changed settings" }),
      ).toContainText("Font style");
      await discard
        .getByRole("button", { name: "Discard changes", exact: true })
        .click();
      await expect(font).toHaveValue("serif");
      await expect(codeFont).toHaveValue("jetbrains-mono");
      await expect(page.getByLabel("Chat width", { exact: true })).toHaveValue(
        "wide",
      );
      await expect(save).toBeHidden();
    } finally {
      await page.close();
    }
  });
}

test("settings save desktop: each font renders in the shared preview without applying globally", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ json: apiFixture(route.request().url()) }),
  );
  await page.goto("/dev/settings");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const preview = page.getByRole("region", { name: "Response preview" });
  for (const [value, family] of [
    ["geist", "Geist"],
    ["source-sans", "Source Sans 3"],
    ["atkinson", "Atkinson Hyperlegible Next"],
    ["opendyslexic", "OpenDyslexic"],
  ] as const) {
    await page.getByLabel("Font style", { exact: true }).selectOption(value);
    await expect(preview.locator("p").first()).toHaveCSS(
      "font-family",
      new RegExp(family),
    );
    expect(
      await page.evaluate(
        async (name) => (await document.fonts.load(`16px "${name}"`)).length,
        family,
      ),
    ).toBeGreaterThan(0);
    await expect(page.locator("html")).toHaveAttribute("data-font", "default");
  }
  for (const [value, family] of [
    ["geist-mono", "Geist Mono"],
    ["jetbrains-mono", "JetBrains Mono"],
    ["source-code", "Source Code Pro"],
  ] as const) {
    await page
      .getByLabel("Code block font", { exact: true })
      .selectOption(value);
    await expect(preview.locator("pre code")).toHaveCSS(
      "font-family",
      new RegExp(family),
    );
    expect(
      await page.evaluate(
        async (name) => (await document.fonts.load(`16px "${name}"`)).length,
        family,
      ),
    ).toBeGreaterThan(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-code-font",
      "default",
    );
  }
  await page.getByLabel("Font style", { exact: true }).selectOption("default");
  await page
    .getByLabel("Code block font", { exact: true })
    .selectOption("default");
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeHidden();
});

test("settings save desktop: invalid preferences fall back and failed saves retain drafts without applying", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ json: apiFixture(route.request().url()) }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:appearance",
      JSON.stringify({ font: "invalid", theme: {}, codeFont: false }),
    );
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.goto("/dev/settings");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Font style", { exact: true }).selectOption("serif");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByText("Could not save appearance in this browser.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-font", "default");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
  await expect(page.locator("html")).toHaveAttribute(
    "data-code-font",
    "default",
  );
  await expect(page.getByLabel("Font style", { exact: true })).toHaveValue(
    "serif",
  );
  await expect(page.locator("footer")).toContainText(
    "Unsaved changes in Appearance",
  );
});
