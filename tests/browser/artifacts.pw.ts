import { expect, test } from "@playwright/test";
test("artifacts desktop content previews", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/artifacts");
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  const sidebar = page.getByRole("complementary", { name: "Artifacts" });
  await page.getByRole("button", { name: "empty", exact: true }).click();
  await expect(page.getByText("No files in this folder.")).toBeVisible();
  await page.getByRole("button", { name: "docs", exact: true }).click();
  await page.getByRole("button", { name: "readme.md", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace notes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show source", exact: true }).click();
  await expect(sidebar.locator("pre")).toContainText("# Workspace notes");
  await expect(sidebar.locator("code span[style]").first()).toBeVisible();
  await page.getByRole("button", { name: "Show rendered preview" }).click();
  const refreshPreview = page.getByRole("button", {
    name: "Refresh preview",
  });
  await refreshPreview.click();
  await expect(refreshPreview).toBeDisabled();
  await expect(refreshPreview).toHaveAttribute("aria-busy", "true");
  await expect(refreshPreview.locator("svg")).toHaveCSS(
    "animation-name",
    "spin",
  );
  await expect(refreshPreview).toBeEnabled();
  await page.getByRole("button", { name: "Back to files" }).click();
  // Opening and refreshing a file must preserve expanded folders.
  await expect(
    page.getByRole("button", { name: "readme.md", exact: true }),
  ).toBeVisible();
  const refreshFiles = page.getByRole("button", { name: "Refresh files" });
  await refreshFiles.click();
  await expect(refreshFiles).toBeDisabled();
  await expect(refreshFiles).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "readme.md", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "src", exact: true }).click();
  await page.getByRole("button", { name: "server.ts", exact: true }).click();
  await expect(sidebar.locator("pre")).toContainText(
    'import { serve } from "bun"',
  );
  await expect(sidebar.locator("code span[style]").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("source-preview.png") });
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "assets", exact: true }).click();
  await page.getByRole("button", { name: "latency.svg", exact: true }).click();
  const image = sidebar.getByRole("img", { name: "latency.svg" });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(640);
  await page.screenshot({ path: testInfo.outputPath("image-preview.png") });
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "the notes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace notes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "missing.md", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("File no longer exists");
});

test("artifacts desktop resizing, persistence and transitions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/artifacts");
  const sidebar = page.locator("#artifact-sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect
    .poll(async () => {
      const bounds = (await sidebar.boundingBox())!;
      return Math.round(bounds.x + bounds.width);
    })
    .toBe(1440);
  const handle = page.getByRole("separator", {
    name: "Resize artifact sidebar",
  });
  const initial = (await sidebar.boundingBox())!.width;
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 100, bounds.y + 100, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", `${initial + 100}px`);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(sidebar).toHaveCSS("width", `${initial + 116}px`);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(sidebar).toHaveAttribute("inert", "");
  await page.reload();
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await expect(sidebar).toHaveCSS("width", `${initial + 116}px`);
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(sidebar).toHaveCSS("width", "320px");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(sidebar).toHaveCSS("transition-property", "none");
});

for (const size of ["desktop", "mobile"] as const) {
  test(`artifacts ${size} one stationary toggle animates both directions`, async ({
    page,
  }) => {
    await page.setViewportSize(
      size === "desktop"
        ? { width: 1440, height: 900 }
        : { width: 390, height: 844 },
    );
    await page.goto("/dev/artifacts");
    const toggle = page.getByRole("button", { name: "Toggle artifacts" });
    await expect(toggle).toBeVisible();
    await expect(
      page.locator('button[aria-controls="artifact-sidebar"]'),
    ).toHaveCount(1);
    const toggleX = (await toggle.boundingBox())!.x;
    for (const opening of [true, false]) {
      const frames = await page.evaluate(async () => {
        const sidebar = document.getElementById("artifact-sidebar")!;
        const toggle = document.querySelector<HTMLButtonElement>(
          'button[aria-controls="artifact-sidebar"]',
        )!;
        const frames: { x: number; scroll: number; toggleX: number }[] = [];
        const sample = () =>
          frames.push({
            x: sidebar.getBoundingClientRect().x,
            scroll: sidebar.parentElement!.scrollLeft,
            toggleX: toggle.getBoundingClientRect().x,
          });
        sample();
        toggle.click();
        const start = performance.now();
        while (performance.now() - start < 380) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          sample();
        }
        return frames;
      });
      const first = frames[0]!.x;
      const last = frames.at(-1)!.x;
      expect(opening ? first - last : last - first).toBeGreaterThan(300);
      // Validate rendered motion, not merely the presence of transition CSS.
      expect(
        frames.filter(
          (frame) =>
            frame.x > Math.min(first, last) + 5 &&
            frame.x < Math.max(first, last) - 5,
        ).length,
      ).toBeGreaterThan(2);
      expect(frames.every((frame) => frame.scroll === 0)).toBe(true);
      expect(
        frames.every((frame) => Math.abs(frame.toggleX - toggleX) < 1),
      ).toBe(true);
      await expect(toggle).toHaveAttribute("aria-expanded", String(opening));
    }
    // Opening from a chat link must not scroll the panel into view either.
    await page.getByRole("button", { name: "the notes", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Workspace notes" }),
    ).toBeVisible();
    expect(
      await page
        .locator("#artifact-sidebar")
        .evaluate((element) => element.parentElement!.scrollLeft),
    ).toBe(0);
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
}

for (const size of ["desktop", "mobile"] as const) {
  test(`artifacts ${size} header dividers stay aligned`, async ({
    page,
  }, testInfo) => {
    await page.goto("/dev/artifacts");
    const widths =
      size === "desktop" ? [901, 1024, 1319, 1320, 1440] : [390, 640, 641, 900];
    const toggle = page.getByRole("button", { name: "Toggle artifacts" });
    await toggle.click();
    const assertAlignment = async () => {
      const difference = await page.evaluate(() => {
        const chat = document.querySelector("main .workspace-header")!;
        const toolbar = [
          ...document.querySelectorAll("#artifact-sidebar .workspace-header"),
        ].find((element) => (element as HTMLElement).offsetHeight > 0)!;
        return Math.abs(
          chat.getBoundingClientRect().bottom -
            toolbar.getBoundingClientRect().bottom,
        );
      });
      expect(difference).toBeLessThan(0.5);
    };
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole("button", { name: "docs", exact: true }),
      ).toBeVisible();
      await assertAlignment();
    }
    await page.getByRole("button", { name: "docs", exact: true }).click();
    await page.getByRole("button", { name: "readme.md", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Workspace notes" }),
    ).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await assertAlignment();
    }
    await page.screenshot({
      path: testInfo.outputPath("header-alignment.png"),
    });
  });
}

test("artifacts desktop file cards preview and downloads are explicit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/artifacts");
  let downloads = 0;
  page.on("download", () => downloads++);
  await page
    .getByRole("button", { name: "Preview readme.md", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace notes" }),
  ).toBeVisible();
  expect(downloads).toBe(0);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download file", exact: true })
    .click();
  const downloaded = await pending;
  expect(downloaded.suggestedFilename()).toBe("readme.md");
  const { readFile } = await import("node:fs/promises");
  const content = await readFile((await downloaded.path())!, "utf8");
  expect(content).toContain("# Workspace notes");
  expect(content).toContain("**formatted text**");
  await expect(
    page.getByRole("heading", { name: "Workspace notes" }),
  ).toBeVisible();
  expect(downloads).toBe(1);
  await page.getByRole("button", { name: "Toggle artifacts" }).click();
  await page.getByRole("button", { name: "large.txt", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("1 MB");
  const largePending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download file", exact: true })
    .click();
  const large = await largePending;
  expect(large.suggestedFilename()).toBe("large.txt");
  expect((await readFile((await large.path())!)).length).toBe(1024 * 1024 + 1);
});
