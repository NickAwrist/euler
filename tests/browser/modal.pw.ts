import { expect, test } from "@playwright/test";

test("modal desktop: showModal, escape dismissal, blocked dismissal while busy, backdrop clicks, and focus restoration", async ({
  page,
}) => {
  await page.goto("/dev/modal");

  const openStandardBtn = page.locator("#open-standard-btn");
  const openBusyBtn = page.locator("#open-busy-btn");
  const openFocusBtn = page.locator("#open-focus-btn");

  // 1. Standard modal opening via showModal()
  await openStandardBtn.click();
  const dialog = page.locator("dialog");
  await expect(dialog).toBeVisible();

  // Verify showModal() was used (dialog has open property and matches :modal)
  const isModal = await dialog.evaluate((el: HTMLDialogElement) =>
    el.matches(":modal"),
  );
  expect(isModal).toBe(true);

  // 2. Escape dismissal and focus restoration
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(openStandardBtn).toBeFocused();

  // 3. Backdrop click dismissal and focus restoration
  await openStandardBtn.click();
  await expect(dialog).toBeVisible();
  // Click on top-left backdrop outside the centered modal surface
  await dialog.click({ position: { x: 10, y: 10 } });
  await expect(dialog).not.toBeVisible();
  await expect(openStandardBtn).toBeFocused();

  // 4. Blocked dismissal while busy
  await openBusyBtn.click();
  const busyDialog = page.locator("dialog");
  await expect(busyDialog).toBeVisible();
  expect(
    await busyDialog.evaluate((el: HTMLDialogElement) => el.matches(":modal")),
  ).toBe(true);

  // Close button should be disabled
  const closeBusyBtn = page.getByRole("button", { name: "Close busy modal" });
  await expect(closeBusyBtn).toBeDisabled();

  // Escape must not dismiss while busy
  await page.keyboard.press("Escape");
  await expect(busyDialog).toBeVisible();

  // Backdrop clicks must not dismiss while busy
  await busyDialog.click({ position: { x: 10, y: 10 } });
  await expect(busyDialog).toBeVisible();

  // Uncheck busy state and verify dismissal now succeeds
  const busyCheckbox = page.getByRole("checkbox", {
    name: "Toggle busy state",
  });
  await busyCheckbox.uncheck();
  await expect(closeBusyBtn).toBeEnabled();

  // Dismissing after busy is cleared restores focus to the trigger button
  await page.keyboard.press("Escape");
  await expect(busyDialog).not.toBeVisible();
  await expect(openBusyBtn).toBeFocused();

  // 5. Initial focus and focus restoration
  await openFocusBtn.click();
  const focusDialog = page.locator("dialog");
  await expect(focusDialog).toBeVisible();
  const targetInput = page.getByPlaceholder("Target input");
  await expect(targetInput).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(focusDialog).not.toBeVisible();
  await expect(openFocusBtn).toBeFocused();
});
