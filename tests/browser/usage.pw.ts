import { expect, test } from "@playwright/test";
import type { UsageDashboard, UsageGroup, UsageTotals } from "../../src/usage";

// Explicit API examples: aggregation and sorting are covered by backend tests.
const totals: UsageTotals = {
  calls: 24,
  tokens: 100000,
  input: 90000,
  output: 10000,
  cached: 70000,
  uncached: 20000,
  cost: 0.6,
  savings: 1.2,
  cacheHitRate: 77.78,
};
const names = [
  "openrouter:openai/gpt-5.4",
  "openrouter:anthropic/claude-sonnet-4.6",
  "openrouter:anthropic/claude-opus-4.6",
  "openrouter:google/gemini-3.1-pro",
  "openrouter:deepseek/deepseek-v3.2",
  "openrouter:qwen/qwen3.5",
  "openrouter:mistralai/mistral-large",
  "qwen3:8b",
];
const rows: UsageGroup[] = names.map((key) => ({
  ...totals,
  key,
  timestamp: 0,
  tokenShare: 12.5,
  ...(key === "qwen3:8b"
    ? {
        cost: 0,
        cached: null,
        uncached: null,
        savings: null,
        cacheHitRate: null,
      }
    : {}),
}));
const sample: UsageDashboard = {
  asOf: Date.UTC(2026, 8, 19),
  grouping: "model",
  totals: {
    calls: 192,
    tokens: 800000,
    input: 720000,
    output: 80000,
    cached: 490000,
    uncached: 140000,
    cost: 4.2,
    savings: 8.4,
    cacheHitRate: 77.78,
  },
  providers: [
    "openai",
    "anthropic",
    "google",
    "deepseek",
    "qwen",
    "mistralai",
    "ollama",
  ].map((key) => ({
    ...totals,
    key,
    modelCount: key === "anthropic" ? 2 : 1,
    ...(key === "anthropic"
      ? {
          calls: 48,
          tokens: 200000,
          input: 180000,
          output: 20000,
          cached: 140000,
          uncached: 40000,
          cost: 1.2,
          savings: 2.4,
        }
      : {}),
    ...(key === "ollama"
      ? {
          cost: 0,
          cached: null,
          uncached: null,
          savings: null,
          cacheHitRate: null,
        }
      : {}),
  })),
  chart: {
    intervalMs: 86400000,
    buckets: [
      Date.UTC(2026, 8, 17),
      Date.UTC(2026, 8, 18),
      Date.UTC(2026, 8, 19),
    ],
    series: names.map((model) => ({
      model,
      tokens: [20000, 50000, 30000],
      spend: model === "qwen3:8b" ? [0, 0, 0] : [0.1, 0.3, 0.2],
    })),
  },
  breakdown: { rows, page: 0, pageSize: 50, totalRows: 8 },
};
const filtered: UsageDashboard = {
  ...sample,
  totals: {
    ...totals,
    calls: 48,
    tokens: 200000,
    input: 180000,
    output: 20000,
    cached: 140000,
    uncached: 40000,
    cost: 1.2,
    savings: 2.4,
  },
  // Two buckets: tick labels must not repeat.
  chart: {
    ...sample.chart,
    buckets: sample.chart.buckets.slice(1),
    series: sample.chart.series.slice(1, 3).map((item) => ({
      ...item,
      tokens: item.tokens.slice(1),
      spend: item.spend.slice(1),
    })),
  },
  breakdown: {
    ...sample.breakdown,
    rows: rows.slice(1, 3).map((row) => ({ ...row, tokenShare: 50 })),
    totalRows: 2,
  },
};
const hourly: UsageDashboard = {
  ...sample,
  grouping: "hour",
  breakdown: {
    rows: [
      {
        ...totals,
        key: "hour-1",
        timestamp: Date.UTC(2026, 8, 18, 23),
        tokenShare: 12.5,
      },
    ],
    page: 0,
    pageSize: 1,
    totalRows: 2,
  },
};
const empty: UsageDashboard = {
  ...sample,
  totals: {
    calls: 0,
    tokens: 0,
    input: null,
    output: null,
    cached: null,
    uncached: null,
    cost: null,
    savings: null,
    cacheHitRate: null,
  },
  providers: [],
  chart: { ...sample.chart, series: [] },
  breakdown: { rows: [], page: 0, pageSize: 50, totalRows: 0 },
};

for (const mode of ["desktop", "mobile"]) {
  test(`usage ${mode}`, async ({ page }) => {
    await page.setViewportSize(
      mode === "desktop"
        ? { width: 1440, height: 1100 }
        : { width: 390, height: 844 },
    );
    let response = sample;
    let params = new URLSearchParams();
    await page.route("**/api/usage?*", async (route) => {
      params = new URL(route.request().url()).searchParams;
      await route.fulfill({
        json: { ...response, asOf: Number(params.get("asOf")) },
      });
    });
    const sorting = () => JSON.parse(params.get("sorting") ?? "[]") as unknown;
    await page.goto("/dev/usage");
    await expect(
      page.getByRole("heading", { name: "Usage insights" }),
    ).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(8);
    expect(params.get("days")).toBe("7");
    const initialCutoff = params.get("asOf");
    expect(Number(initialCutoff)).toBeGreaterThan(0);
    const anthropic = page
      .locator(".usage-legend")
      .getByRole("button", { name: /Anthropic/ });
    const openai = page
      .locator(".usage-legend")
      .getByRole("button", { name: /OpenAI/ });
    await expect(anthropic).toContainText("2 models");
    response = filtered;
    await anthropic.click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    expect(params.getAll("providers")).toEqual(["anthropic"]);
    expect(params.get("asOf")).toBe(initialCutoff);
    await expect(
      page.getByRole("list", { name: "Models" }).getByRole("listitem"),
    ).toHaveText(["anthropic/claude-sonnet-4.6", "anthropic/claude-opus-4.6"]);
    await expect(page.locator(".usage-plot polyline")).toHaveCount(0);
    expect(
      await page
        .locator(".usage-plot rect")
        .evaluateAll((nodes) => [
          ...new Set(nodes.map((node) => node.getAttribute("fill"))),
        ]),
    ).toEqual(["#3987e5", "#d95926"]);
    await expect(page.locator(".usage-plot svg > text")).toHaveText([
      /Sep 1[78]/,
      /Sep 1[89]/,
    ]);
    await openai.click({ modifiers: ["Shift"] });
    await expect
      .poll(() => params.getAll("providers"))
      .toEqual(["anthropic", "openai"]);
    await expect(anthropic).toHaveAttribute("aria-pressed", "true");
    await expect(openai).toHaveAttribute("aria-pressed", "true");
    for (const range of ["30", "0", "7"]) {
      await page.getByLabel("Date range").selectOption(range);
      await expect.poll(() => params.get("days")).toBe(range);
      expect(params.getAll("providers")).toEqual(["anthropic", "openai"]);
      expect(params.get("page")).toBe("0");
    }
    await anthropic.click({ modifiers: ["Shift"] });
    await expect.poll(() => params.getAll("providers")).toEqual(["openai"]);
    response = sample;
    await openai.click();
    await expect(page.locator("tbody tr")).toHaveCount(8);
    expect(params.getAll("providers")).toEqual([]);
    await expect(page.locator(".usage-more-models")).toBeVisible();
    await page.locator(".usage-legend").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(page.locator(".usage-more-models")).toHaveCount(0);
    await page.locator(".usage-legend").evaluate((node) => {
      node.scrollTop = 0;
    });

    const highlight = page
      .getByRole("group", { name: "Chart metric" })
      .locator(".segmented-control-highlight");
    await highlight.scrollIntoViewIfNeeded();
    const tokenHighlight = (await highlight.boundingBox())!;
    await page
      .getByRole("group", { name: "Chart metric" })
      .getByRole("button", { name: "Spend", exact: true })
      .click();
    await expect
      .poll(async () => (await highlight.boundingBox())!.x)
      .toBeCloseTo(tokenHighlight.x + tokenHighlight.width, 0);
    await expect(page.locator(".usage-big")).toHaveText("$4.20");

    const columnPositions = () =>
      page.locator(".usage-sort-label").evaluateAll((nodes) =>
        nodes.map((node) => ({
          x:
            node.getBoundingClientRect().x -
            node.closest("table")!.getBoundingClientRect().x,
          width: node.getBoundingClientRect().width,
        })),
      );
    for (const [name, column] of [
      ["Spend", "spend"],
      ["Model", "name"],
      ["Share of total tokens", "share"],
      ["Tokens", "tokens"],
      ["Cached input", "cached"],
      ["Cache savings", "savings"],
    ] as const) {
      const header = page
        .getByRole("columnheader")
        .filter({ hasText: new RegExp(`^${name}`) });
      const positions = await columnPositions();
      const firstDirection =
        column === "name" || column === "spend" ? "ascending" : "descending";
      await header.getByRole("button").click();
      await expect
        .poll(sorting)
        .toEqual([{ column, direction: firstDirection }]);
      await expect(header).toHaveAttribute("aria-sort", firstDirection);
      await expect.poll(columnPositions).toEqual(positions);
      await header.getByRole("button").click();
      const direction =
        firstDirection === "ascending" ? "descending" : "ascending";
      await expect.poll(sorting).toEqual([{ column, direction }]);
      await expect(header).toHaveAttribute("aria-sort", direction);
      await expect.poll(columnPositions).toEqual(positions);
    }
    const spendHeader = page
      .getByRole("columnheader")
      .filter({ hasText: /^Spend/ });
    await spendHeader.getByRole("button").click({ modifiers: ["Shift"] });
    await expect.poll(sorting).toEqual([
      { column: "savings", direction: "ascending" },
      { column: "spend", direction: "descending" },
    ]);
    await expect(spendHeader).toHaveAttribute("data-sort-priority", "2");
    const modelSort = sorting();

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
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("openai/gpt-5.4");
    await expect(tooltip).toContainText("qwen3:8b");
    await expect(tooltip).toContainText("$0.30");
    if (mode === "desktop") {
      const firstBox = (await tooltip.boundingBox())!;
      await page.mouse.move(
        bounds.x + bounds.width / 2 + 8,
        bounds.y + bounds.height / 2 + 6,
      );
      await expect
        .poll(async () => (await tooltip.boundingBox())!.x)
        .toBeCloseTo(firstBox.x + 8, 0);
      await expect
        .poll(async () => (await tooltip.boundingBox())!.y)
        .toBeCloseTo(firstBox.y + 6, 0);
    }
    await cursor.focus();
    await page.keyboard.press("End");
    await expect(tooltip).toContainText("$0.20");
    await page.screenshot({
      path: `.cache/usage-tooltip-${mode}.png`,
      fullPage: true,
    });

    response = hourly;
    const grouping = page.getByRole("group", { name: "Breakdown grouping" });
    await grouping.getByRole("button", { name: "Hour", exact: true }).click();
    await expect.poll(() => params.get("grouping")).toBe("hour");
    await expect
      .poll(sorting)
      .toEqual([{ column: "name", direction: "descending" }]);
    const navigation = page.getByRole("navigation", {
      name: "Breakdown pages",
    });
    await expect(navigation).toContainText("1–1 of 2");
    response = {
      ...hourly,
      breakdown: {
        ...hourly.breakdown,
        page: 1,
        rows: [
          {
            ...hourly.breakdown.rows[0]!,
            key: "hour-2",
            timestamp: Date.UTC(2026, 8, 18, 22),
          },
        ],
      },
    };
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(navigation).toContainText("2–2 of 2");
    expect(params.get("page")).toBe("1");
    await expect(page.locator(".usage-big")).toHaveText("$4.20");
    response = hourly;
    await spendHeader.getByRole("button").click();
    await expect.poll(() => params.get("page")).toBe("0");
    await expect
      .poll(sorting)
      .toEqual([{ column: "spend", direction: "descending" }]);
    response = sample;
    await grouping.getByRole("button", { name: "Model", exact: true }).click();
    await expect.poll(sorting).toEqual(modelSort);
    await expect(page.locator("tbody tr")).toHaveCount(8);
    response = {
      ...sample,
      chart: {
        ...sample.chart,
        intervalMs: 3600000,
        buckets: [18, 19, 20, 21, 22, 23].map((hour) =>
          Date.UTC(2026, 8, 18, hour),
        ),
        series: sample.chart.series.map((item) => ({
          ...item,
          tokens: [...item.tokens, ...item.tokens],
          spend: [...item.spend, ...item.spend],
        })),
      },
    };
    await page.getByLabel("Date range").selectOption("1");
    await expect.poll(() => params.get("days")).toBe("1");
    await expect(
      page.getByRole("heading", { name: "Hourly spend" }),
    ).toBeVisible();
    await expect(page.locator(".usage-plot polyline")).toHaveCount(8);
    await page.screenshot({ path: `.cache/usage-${mode}.png`, fullPage: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const previousCutoff = params.get("asOf");
    response = empty;
    await page.getByRole("button", { name: "Refresh usage" }).click();
    await expect(page.getByText("No usage recorded yet")).toBeVisible();
    await expect(page.getByRole("region", { name: "Totals" })).toHaveCount(0);
    expect(Number(params.get("asOf"))).toBeGreaterThan(Number(previousCutoff));
  });
}
