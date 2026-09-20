import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
});

test("long thread skips history work during typing and streaming", async ({
  page,
}) => {
  await page.goto("/dev/long-thread");
  const reply = page.getByText("Streaming reply", { exact: true });
  await expect(reply).toBeVisible();
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
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Question 0", { exact: true })).toBeInViewport();
});
