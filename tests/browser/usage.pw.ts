import { expect, test } from "@playwright/test";
for (const mode of ["desktop", "mobile"]) {
  test(`usage ${mode}`, async ({ page }) => {
    await page.setViewportSize(
      mode === "desktop"
        ? { width: 1440, height: 1100 }
        : { width: 390, height: 844 },
    );
    await page.goto("/dev/usage");
    await expect(
      page.getByRole("heading", { name: "Usage insights" }),
    ).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(8);
    const anthropic = page
      .locator(".usage-legend")
      .getByRole("button", { name: /Anthropic/ });
    await expect(anthropic).toContainText("2 models");
    await anthropic.click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.locator("tbody")).toContainText(
      "anthropic/claude-sonnet-4.6",
    );
    await expect(page.locator("tbody")).toContainText(
      "anthropic/claude-opus-4.6",
    );
    await expect(page.locator(".usage-plot polyline")).toHaveCount(2);
    await expect(page.locator(".usage-plot polyline").nth(1)).toHaveAttribute(
      "stroke-dasharray",
      "6 4",
    );
    const openai = page
      .locator(".usage-legend")
      .getByRole("button", { name: /OpenAI/ });
    const google = page
      .locator(".usage-legend")
      .getByRole("button", { name: /Google/ });
    await openai.click({ modifiers: ["Shift"] });
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await expect(anthropic).toHaveAttribute("aria-pressed", "true");
    await expect(openai).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".usage-plot polyline")).toHaveCount(3);
    for (const range of ["30", "0", "7"]) {
      const previousTotal = await page.locator(".usage-big").textContent();
      await page.getByLabel("Date range").selectOption(range);
      await expect(page.locator(".usage-big")).not.toHaveText(previousTotal!);
      await expect(anthropic).toHaveAttribute("aria-pressed", "true");
      await expect(openai).toHaveAttribute("aria-pressed", "true");
      await expect(google).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("tbody tr")).toHaveCount(3);
      await expect(page.locator(".usage-plot polyline")).toHaveCount(3);
    }
    await google.click({ modifiers: ["Shift"] });
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await anthropic.click({ modifiers: ["Shift"] });
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(anthropic).toHaveAttribute("aria-pressed", "false");
    await openai.click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(google).toHaveAttribute("aria-pressed", "false");
    await openai.click();
    await expect(page.locator("tbody tr")).toHaveCount(8);
    await expect(openai).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".usage-plot polyline")).toHaveCount(8);
    await openai.click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await openai.click({ modifiers: ["Shift"] });
    await expect(page.locator("tbody tr")).toHaveCount(8);
    await expect(page.locator(".usage-more-models")).toBeVisible();
    await page.locator(".usage-legend").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(page.locator(".usage-more-models")).toHaveCount(0);
    await page.locator(".usage-legend").evaluate((node) => {
      node.scrollTop = 0;
    });
    const tokenTotal = await page.locator(".usage-big").textContent();
    const metricHighlight = page
      .getByRole("group", { name: "Chart metric" })
      .locator(".segmented-control-highlight");
    await metricHighlight.scrollIntoViewIfNeeded();
    const tokenHighlight = (await metricHighlight.boundingBox())!;
    await page
      .locator(".segmented-control")
      .getByRole("button", { name: "Spend", exact: true })
      .click();
    await expect
      .poll(async () => (await metricHighlight.boundingBox())!.x)
      .toBeCloseTo(tokenHighlight.x + tokenHighlight.width, 0);
    await expect(page.locator(".usage-big")).toHaveText(/^\$/);
    await expect(page.locator(".usage-big")).not.toHaveText(tokenTotal!);
    await expect(
      page.getByRole("button", { name: "Back to chat", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Hover over a point for details.", { exact: false }),
    ).toHaveCount(0);
    const spendHeader = page
      .getByRole("columnheader")
      .filter({ hasText: "Spend" });
    const columnPositions = () =>
      page.locator(".usage-sort-label").evaluateAll((nodes) =>
        nodes.map((node) => ({
          x:
            node.getBoundingClientRect().x -
            node.closest("table")!.getBoundingClientRect().x,
          width: node.getBoundingClientRect().width,
        })),
      );
    const initialPositions = await columnPositions();
    await spendHeader.getByRole("button").click();
    await expect.poll(columnPositions).toEqual(initialPositions);
    await expect(spendHeader.locator(".usage-sort-arrow")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, 0, 0)",
    );
    await expect(spendHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("tbody tr").first()).toContainText("qwen3:8b");
    await expect(
      page.locator("tbody tr").first().locator("td").nth(1),
    ).toHaveText("$0.00");
    await spendHeader.getByRole("button").click();
    await expect(spendHeader).toHaveAttribute("aria-sort", "descending");
    await expect(spendHeader.locator(".usage-sort-arrow")).toHaveCSS(
      "transform",
      "matrix(-1, 0, 0, -1, 0, 0)",
    );
    await expect.poll(columnPositions).toEqual(initialPositions);
    for (const name of [
      "Model",
      "Share of total tokens",
      "Tokens",
      "Cached input",
      "Cache savings",
    ]) {
      const header = page
        .getByRole("columnheader")
        .filter({ hasText: new RegExp(`^${name}`) });
      const before = await columnPositions();
      await header.getByRole("button").click();
      await expect.poll(columnPositions).toEqual(before);
      const firstDirection = name === "Model" ? "ascending" : "descending";
      await expect(header).toHaveAttribute("aria-sort", firstDirection);
      await header.getByRole("button").click();
      await expect(header).toHaveAttribute(
        "aria-sort",
        firstDirection === "ascending" ? "descending" : "ascending",
      );
    }
    await expect(
      page.locator('.usage-sort-indicator[data-active="true"]'),
    ).toHaveCount(1);
    if (mode === "desktop") {
      const before = await columnPositions();
      await spendHeader.getByRole("button").click({ modifiers: ["Shift"] });
      await expect.poll(columnPositions).toEqual(before);
      const tokensHeader = page
        .getByRole("columnheader")
        .filter({ hasText: /^Tokens/ });
      await tokensHeader.getByRole("button").click({ modifiers: ["Shift"] });
      await expect(spendHeader).toHaveAttribute("data-sort-priority", "2");
      await expect(tokensHeader).toHaveAttribute("data-sort-priority", "3");
      await expect(
        page.locator('.usage-sort-indicator[data-active="true"]'),
      ).toHaveCount(3);
      await tokensHeader.getByRole("button").click();
      await expect(tokensHeader).toHaveAttribute("data-sort-priority", "1");
      await expect(
        page.locator('.usage-sort-indicator[data-active="true"]'),
      ).toHaveCount(1);
    }
    const cursor = page.getByRole("slider", {
      name: "Inspect usage at a date",
    });
    await cursor.scrollIntoViewIfNeeded();
    const bounds = (await cursor.boundingBox())!;
    if (mode === "desktop")
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
    else
      await page.touchscreen.tap(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(page.getByRole("tooltip")).toContainText("openai/gpt-5.4");
    await expect(page.getByRole("tooltip")).toContainText("qwen3:8b");
    await expect(page.getByRole("tooltip")).toContainText("$");
    if (mode === "desktop") {
      const firstBox = (await page.getByRole("tooltip").boundingBox())!;
      await page.mouse.move(
        bounds.x + bounds.width / 2 + 8,
        bounds.y + bounds.height / 2 + 6,
      );
      await expect
        .poll(async () => (await page.getByRole("tooltip").boundingBox())!.x)
        .toBeCloseTo(firstBox.x + 8, 0);
      await expect
        .poll(async () => (await page.getByRole("tooltip").boundingBox())!.y)
        .toBeCloseTo(firstBox.y + 6, 0);
      const date = await page
        .getByRole("tooltip")
        .locator("strong")
        .textContent();
      await page.mouse.move(
        bounds.x + bounds.width * 0.9,
        bounds.y + bounds.height / 2,
      );
      await expect(page.getByRole("tooltip").locator("strong")).not.toHaveText(
        date!,
      );
      const box = (await page.getByRole("tooltip").boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(1440);
    }
    await cursor.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.screenshot({
      path: `.cache/usage-tooltip-${mode}.png`,
      fullPage: true,
    });
    await expect(page.locator(".usage-legend")).toHaveCSS(
      "scrollbar-width",
      "thin",
    );

    await expect(
      page.getByRole("heading", { name: "Daily spend" }),
    ).toBeVisible();
    const sortSnapshot = () =>
      page.locator("th[data-sort-priority]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          label: node.querySelector(".usage-sort-label")?.textContent,
          sort: node.getAttribute("aria-sort"),
          priority: node.getAttribute("data-sort-priority"),
        })),
      );
    const modelSort = await sortSnapshot();
    await page.getByRole("button", { name: /OpenAI/ }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    const highlight = page
      .getByRole("group", { name: "Breakdown grouping" })
      .locator(".segmented-control-highlight");
    await highlight.scrollIntoViewIfNeeded();
    const modelHighlight = (await highlight.boundingBox())!;
    await page
      .locator(".segmented-control")
      .getByRole("button", { name: "Hour", exact: true })
      .click();
    await expect
      .poll(async () => (await highlight.boundingBox())!.x)
      .toBeCloseTo(modelHighlight.x + modelHighlight.width, 0);
    await expect(page.locator("tbody tr")).toHaveCount(50);
    const firstHour = await page.locator("tbody tr").first().textContent();
    const totalBeforePage = await page.locator(".usage-big").textContent();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "Breakdown pages" }),
    ).toContainText("51–100");
    await expect(page.locator("tbody tr").first()).not.toHaveText(firstHour!);
    await expect(page.locator(".usage-big")).toHaveText(totalBeforePage!);
    await page
      .getByRole("columnheader")
      .filter({ hasText: "Spend" })
      .getByRole("button")
      .click();
    await expect(
      page.getByRole("navigation", { name: "Breakdown pages" }),
    ).toContainText("1–50");
    await page
      .locator(".segmented-control")
      .getByRole("button", { name: "Model", exact: true })
      .click();
    await expect.poll(sortSnapshot).toEqual(modelSort);
    await page
      .getByRole("button", { name: /OpenAI/ })
      .click({ modifiers: ["Shift"] });
    await expect(page.locator("tbody tr")).toHaveCount(8);
    const summaryBefore = await page
      .locator(".usage-totals strong")
      .allTextContents();
    const callsBefore = await page.locator(".usage-muted").textContent();
    const legendBefore = await page
      .locator(".usage-legend small")
      .first()
      .textContent();
    await page.getByLabel("Date range").selectOption("1");
    for (let i = 0; i < 5; i++)
      await expect(page.locator(".usage-totals strong").nth(i)).not.toHaveText(
        summaryBefore[i]!,
      );
    await expect(page.locator(".usage-muted")).not.toHaveText(callsBefore!);
    await expect(page.locator(".usage-legend small").first()).not.toHaveText(
      legendBefore!,
    );
    await expect(
      page.getByRole("heading", { name: "Hourly spend" }),
    ).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(8);
    await page.screenshot({ path: `.cache/usage-${mode}.png`, fullPage: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .locator(".segmented-control")
      .getByRole("button", { name: "Hour", exact: true })
      .click();
    const hourHeader = page
      .getByRole("columnheader")
      .filter({ hasText: /^Hour/ });
    await expect(
      page.getByRole("columnheader").filter({ hasText: "Spend" }),
    ).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator("th[data-sort-priority]")).toHaveCount(1);
    await hourHeader.getByRole("button").click();
    await expect(hourHeader).toHaveAttribute("aria-sort", "ascending");
    await page
      .locator(".segmented-control")
      .getByRole("button", { name: "Model", exact: true })
      .click();
    await page
      .locator(".segmented-control")
      .getByRole("button", { name: "Hour", exact: true })
      .click();
    await expect(hourHeader).toHaveAttribute("aria-sort", "ascending");
    const dayTotal = await page.locator(".usage-big").textContent();
    await page.getByLabel("Date range").selectOption("0");
    await expect(
      page.getByRole("heading", { name: "Spend over time" }),
    ).toBeVisible();
    await expect(page.locator(".usage-big")).not.toHaveText(dayTotal!);
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await expect(
      page
        .getByRole("columnheader")
        .filter({ hasText: "Share of total tokens" })
        .getByRole("button"),
    ).toHaveAttribute("title", /selected date range and provider filter/);
    await page.getByRole("button", { name: "Toggle empty fixture" }).click();
    await expect(page.getByText("No usage recorded yet")).toBeVisible();
  });
}
