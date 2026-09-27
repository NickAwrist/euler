import { expect, test } from "@playwright/test";

test("session loading: interrupted agents show their reason and fixed model", async ({
  page,
}, testInfo) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Fixture: no backend" } },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/agents");
  const interrupted = page.getByRole("button", { name: /^Research/ });
  await expect(interrupted).toContainText("Interrupted");
  await expect(interrupted).toContainText("openai/gpt-5.6-terra");
  await expect(
    interrupted.locator('img[src="/icons/providers/openai.svg"]'),
  ).toBeVisible();
  await expect(
    interrupted.getByRole("img", { name: /Interrupted by server restart/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: /^Long research/ })
      .getByRole("img", { name: /Interrupted/ }),
  ).toHaveCount(0);
  await interrupted.click();
  const trace = page.getByRole("dialog", { name: "Research" });
  await expect(
    trace.getByText(
      "Interrupted by server restart. Ready for new instructions.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    trace.getByText("openai/gpt-5.6-terra", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ended 1" }).click();
  const failed = page.getByRole("button", { name: /^Local analysis/ });
  await expect(
    failed.getByRole("img", { name: "Model unavailable" }),
  ).toBeVisible();
  await expect(failed.locator('img[src="/icons/ollama.svg"]')).toBeVisible();
  await expect(failed).toContainText("qwen3:8b");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("agent-status-narrow.png"),
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("agent-status-desktop.png"),
  });
  await page.getByRole("button", { name: "Dismiss Research" }).click();
  await expect(page.getByRole("button", { name: /^Research/ })).toContainText(
    "Done",
  );
  await expect(
    page.getByRole("img", { name: /Interrupted by server restart/ }),
  ).toHaveCount(0);
});
