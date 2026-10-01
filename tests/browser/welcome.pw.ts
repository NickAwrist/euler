import { expect, test } from "@playwright/test";
import { mockUserPreferences } from "./userPreferencesFixture";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ json: { skills: [] } }),
  );
});

for (const device of ["desktop", "mobile"]) {
  test(`welcome ${device} keeps questions stable while typing and rotates without repeats`, async ({
    page,
  }) => {
    if (device === "desktop")
      await page.setViewportSize({ width: 1100, height: 760 });
    await mockUserPreferences(page);
    await page.goto("/dev/welcome");
    const heading = page.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("What are we working on today?");
    await page
      .getByPlaceholder("Send a message...")
      .fill("Help me understand this");
    await expect(heading).toHaveText("What are we working on today?");
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(heading).not.toHaveText("What are we working on today?");
    const next = await heading.textContent();
    await page.getByPlaceholder("Send a message...").fill("Another draft");
    await expect(heading).toHaveText(next!);
  });

  test(`welcome ${device} first-name styling and ephemeral notice`, async ({
    page,
  }, testInfo) => {
    if (device === "desktop")
      await page.setViewportSize({ width: 1100, height: 760 });
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "euler:welcomeQuestion",
        "What are we working on today?",
      );
      Math.random = () => 0;
    });
    await mockUserPreferences(page);
    await page.goto("/dev/welcome");
    const heading = page.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("What's on your mind, Nick?");
    await expect(heading).not.toContainText("Wrist");
    await expect(page.locator(".welcome-name")).toHaveCSS(
      "font-style",
      "italic",
    );
    await expect(page.locator(".welcome-name")).toHaveCSS("font-weight", "400");
    const titleBounds = await heading.boundingBox();
    const inputBounds = await page
      .getByPlaceholder("Send a message...")
      .boundingBox();
    expect(titleBounds!.y + titleBounds!.height).toBeLessThan(inputBounds!.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("name-italic.png"),
      animations: "disabled",
    });
    await mockUserPreferences(page);
    await page.goto("/dev/welcome?ephemeral=true&home=false");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "What's on your mind, Nick?",
    );
    await expect(
      page.getByText(
        "Nothing here is saved. Messages and files are deleted when you leave.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start an ephemeral chat" }),
    ).toHaveCount(0);
    await mockUserPreferences(page);
    await page.goto("/dev/welcome?name=");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "What's on your mind?",
    );
  });
}
