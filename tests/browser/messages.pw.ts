import { type Locator, type Page, expect, test } from "@playwright/test";

test("mobile message actions and code layout", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dev/messages");
  const lastReply = page.getByRole("region", {
    name: "Message 7",
    exact: true,
  });
  await lastReply.getByRole("button", { name: "More message actions" }).tap();
  const lastSheet = page.getByRole("dialog", {
    name: "Message actions",
    exact: true,
  });
  await expect(
    lastSheet.getByRole("button", { name: "View trace" }),
  ).toHaveCount(0);
  await lastSheet
    .getByRole("button", { name: "Copy message", exact: true })
    .tap();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Unlabeled code\nwith two lines",
  );
  await expect(lastSheet).not.toBeVisible();
  const firstReply = page.getByRole("region", {
    name: "Message 2",
    exact: true,
  });
  const shortCode = firstReply.locator(".markdown-code-block");
  await expect(shortCode).toBeVisible();
  await expect(shortCode.locator("code .line")).toBeVisible();
  expect((await shortCode.boundingBox())?.height).toBeLessThan(55);
  const copy = firstReply.getByRole("button", {
    name: "Copy code",
    exact: true,
  });
  await copy.tap();
  await expect(
    firstReply.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "hello world",
  );
  await expect(
    firstReply.getByRole("button", { name: "Copy message", exact: true }),
  ).toHaveCount(0);
  await firstReply.getByRole("button", { name: "More message actions" }).tap();
  await page
    .getByRole("dialog", { name: "Message actions", exact: true })
    .getByRole("button", { name: "Copy message", exact: true })
    .tap();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "```text\nhello world\n```",
  );

  const longCode = page
    .getByRole("region", { name: "Message 6", exact: true })
    .locator("pre");
  expect(
    await longCode.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-conversation.png"),
    fullPage: true,
  });

  await firstReply.getByRole("button", { name: "More message actions" }).tap();
  const sheet = page.getByRole("dialog", {
    name: "Message actions",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Copy message", exact: true }),
  ).toHaveCSS("outline-style", "none");
  await expect(sheet).toHaveCSS("opacity", "1");
  const bounds = await sheet.boundingBox();
  expect(bounds?.width).toBeLessThan(260);
  const trigger = await firstReply
    .getByRole("button", { name: "More message actions" })
    .boundingBox();
  if (!bounds || !trigger) throw new Error("Missing menu or trigger");
  expect(trigger.y - (bounds.y + bounds.height)).toBeCloseTo(6, 0);
  expect(bounds.x).toBeLessThanOrEqual(trigger.x + trigger.width);
  expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(trigger.x);
  await page.screenshot({ path: testInfo.outputPath("mobile-actions.png") });
  await sheet.getByRole("button", { name: "View trace" }).tap();
  await expect(page.getByLabel("Execution metrics")).toBeVisible();
  await page.getByRole("button", { name: "Close steps viewer" }).tap();

  const user = page.getByRole("region", { name: "Message 1", exact: true });
  await holdMessage(page, user.locator(".user-message-hold"));
  await expect(
    sheet.getByRole("button", { name: "Copy message", exact: true }),
  ).toHaveCSS("outline-style", "none");
  await page.screenshot({
    path: testInfo.outputPath("user-message-actions.png"),
  });
  await sheet.getByRole("button", { name: "Edit message" }).tap();
  await expect(user.getByRole("textbox")).toBeFocused();
  await user.getByRole("textbox").fill("Edited greeting");
  await user
    .getByRole("button", {
      name: "Save edits and retry; later messages will be deleted",
    })
    .tap();
  await page.getByRole("button", { name: "Continue", exact: true }).tap();
  await expect(user).toContainText("Edited greeting");
  await expect(page.getByRole("region")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("sheet dismissal, busy actions, and retry confirmation", async ({
  page,
}) => {
  await page.goto("/dev/messages");
  const more = page
    .getByRole("region", { name: "Message 2", exact: true })
    .getByRole("button", { name: "More message actions" });
  const userBubble = page
    .getByRole("region", { name: "Message 1", exact: true })
    .locator(".user-message-hold");
  await more.tap();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  const menu = page.getByRole("dialog", {
    name: "Message actions",
    exact: true,
  });
  for (const point of [
    { x: 5, y: 100 },
    { x: 385, y: 100 },
    { x: 200, y: 650 },
  ]) {
    await more.tap();
    await expect(menu).toBeVisible();
    await page.touchscreen.tap(point.x, point.y);
    await expect(menu).not.toBeVisible();
    await holdMessage(page, userBubble);
    await page.touchscreen.tap(point.x, point.y);
    await expect(menu).not.toBeVisible();
  }
  await more.tap();
  // A pointer press must dismiss even when the browser never emits a click.
  await menu.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 5,
    clientY: 100,
    bubbles: true,
  });
  await expect(menu).not.toBeVisible();
  await page.getByRole("checkbox", { name: "Simulate busy" }).check();
  await holdMessage(page, userBubble);
  await expect(
    page.getByRole("button", { name: "Edit message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Retry from here", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Simulate busy" }).uncheck();
  await holdMessage(page, userBubble);
  await page
    .getByRole("button", { name: "Retry from here", exact: true })
    .tap();
  await expect(
    page.getByRole("heading", { name: "Retry from here?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(page.getByRole("region")).toHaveCount(7);
  await page.clock.install();
  for (const cancelEvent of ["pointermove", "pointercancel", "pointerup"]) {
    await userBubble.dispatchEvent("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      clientX: 50,
      clientY: 50,
    });
    await userBubble.dispatchEvent(cancelEvent, {
      pointerType: "touch",
      isPrimary: true,
      clientX: 90,
      clientY: 90,
    });
    await page.clock.fastForward(600);
    await expect(
      page.getByRole("dialog", { name: "Message actions", exact: true }),
    ).not.toBeVisible();
  }
});

test("desktop hover and keyboard access", async ({ browser }, testInfo) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  await page.goto("http://127.0.0.1:5199/dev/messages");
  const user = page.getByRole("region", { name: "Message 1", exact: true });
  await user.hover();
  await expect(user.locator(".message-actions")).toHaveCSS("opacity", "1");
  await expect(
    user.getByRole("button", { name: "More message actions" }),
  ).toHaveCount(0);
  for (const name of ["Copy message", "Edit message", "Retry from here"]) {
    await expect(user.getByRole("button", { name, exact: true })).toBeVisible();
  }
  const reply = page.getByRole("region", { name: "Message 2", exact: true });
  await reply.hover();
  await expect(
    reply.getByRole("button", { name: "Copy message", exact: true }),
  ).toHaveCount(1);
  await expect(
    reply.getByRole("button", { name: "More message actions" }),
  ).toHaveCount(0);
  await reply.getByRole("button", { name: "View trace" }).click();
  await expect(page.getByLabel("Execution metrics")).toBeVisible();
  await page.getByRole("button", { name: "Close steps viewer" }).click();
  await page.mouse.move(0, 0);
  const edit = user.getByRole("button", { name: "Edit message", exact: true });
  await edit.focus();
  await expect(user.locator(".message-actions")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(user.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Simulate busy" }).check();
  await expect(edit).toBeDisabled();
  await expect(
    user.getByRole("button", { name: "Retry from here", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    user.getByRole("button", { name: "More message actions" }),
  ).toBeVisible();
  await expect(edit).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("desktop-conversation.png"),
    fullPage: true,
  });
  await page.close();
});

async function holdMessage(page: Page, bubble: Locator) {
  await bubble.scrollIntoViewIfNeeded();
  const bounds = await bubble.boundingBox();
  if (!bounds) throw new Error("Missing user bubble");
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      ],
    });
    await expect(
      page.getByRole("dialog", { name: "Message actions", exact: true }),
    ).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}
