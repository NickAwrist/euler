import { expect, test } from "@playwright/test";
import { mockUserPreferences } from "./userPreferencesFixture";

test.use({
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
});

test("long thread skips history work during typing and streaming", async ({
  page,
}) => {
  await mockUserPreferences(page);
  await page.goto("/dev/long-thread");
  const reply = page.getByText("Streaming reply", { exact: true });
  await expect(reply).toBeVisible();
  // Only messages near the viewport are mounted.
  await expect(page.getByText("Question 0", { exact: true })).toHaveCount(0);
  const clearReads = () =>
    page.evaluate(() => performance.clearMarks("history-read"));
  const readCount = () =>
    page.evaluate(() => performance.getEntriesByName("history-read").length);

  await clearReads();
  await page
    .getByRole("textbox", { name: "Composer" })
    .pressSequentially("Typing in a long thread", { delay: 10 });
  expect.soft(await readCount()).toBe(0);

  await page.getByRole("button", { name: "Toggle busy" }).click();
  await clearReads();
  for (let index = 0; index < 10; index++) {
    await page.getByRole("button", { name: "Stream token" }).click();
  }
  await expect(
    page.getByText("More streamed text.", { exact: true }),
  ).toHaveCount(10);
  expect.soft(await readCount()).toBe(0);

  await page.getByRole("button", { name: "Toggle busy" }).click();
  await clearReads();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(
    page.getByText("More streamed text.", { exact: true }),
  ).toHaveCount(10);
  // Appending traverses keys, but must not re-render existing message bodies.
  expect(await readCount()).toBeLessThanOrEqual(600);
  await expect(
    page.getByText("More streamed text.", { exact: true }).last(),
  ).toBeInViewport();

  await page.mouse.move(600, 300);
  await page.mouse.wheel(0, -1_000_000);
  await page.getByText("Question 0", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Question 0", { exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Stream token" }).click();
  await expect(page.getByText("Question 0", { exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Edit first message" }).click();
  const editor = page.locator("textarea");
  await expect(editor).toHaveValue("Question 0");
  await editor.fill("Draft edit");
  await page.getByRole("button", { name: "Stream token" }).click();
  await expect(editor).toHaveValue("Draft edit");
  // The open editor stays mounted while it is scrolled out of the window.
  await page.mouse.move(600, 300);
  await page.mouse.wheel(0, 1_000_000);
  await expect(reply).toBeInViewport();
  await expect(editor).toHaveValue("Draft edit");
  await page.mouse.wheel(0, -1_000_000);
  await expect(editor).toBeInViewport();
  await expect(editor).toHaveValue("Draft edit");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Question 0", { exact: true })).toBeInViewport();

  await page.getByRole("button", { name: "Previous version" }).click();
  const earlierReply = page.getByText("Earlier reply version", { exact: true });
  await expect(earlierReply).toBeVisible();
  const message = earlierReply.locator(
    "xpath=ancestor::div[contains(@class, 'group/msg')]",
  );
  await message.getByRole("button", { name: "Thoughts", exact: true }).click();
  await expect(
    message.getByRole("button", { name: "Thoughts", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Refresh history" }).click();
  await page.mouse.move(600, 300);
  await page.mouse.wheel(0, 1_000_000);
  await expect(reply).toBeInViewport();
  await expect(earlierReply).toHaveCount(0);
  await page.mouse.wheel(0, -1_000_000);
  await expect(earlierReply).toBeVisible();
  await expect(
    message.getByRole("button", { name: "Thoughts", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});
