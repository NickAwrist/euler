import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Page, expect } from "@playwright/test";

/** Write a design screenshot only when UPDATE_DESIGN_MOCKS=1. */
export async function captureMock(page: Page, design: string, name: string) {
  if (process.env.UPDATE_DESIGN_MOCKS !== "1") return;
  const dir = fileURLToPath(
    new URL(`../../../docs/design/${design}/`, import.meta.url),
  );
  await expect(
    page.getByRole("navigation", { name: "Mock scenarios" }),
  ).toBeVisible();
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${dir}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

/** Assert every scene fits a phone-width viewport without horizontal scroll. */
export async function expectScenesFitMobile(
  page: Page,
  route: string,
  scenes: readonly string[],
) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scene of scenes) {
    await page.goto(`${route}?scene=${scene}`);
    await expect(
      page.getByRole("navigation", { name: "Mock scenarios" }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, scene).toBe(false);
  }
}
