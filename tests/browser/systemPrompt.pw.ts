import { expect, test } from "@playwright/test";

// These checks exercise returning users; first-visit setup has its own suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
});
import { DEFAULT_SYSTEM_PROMPT } from "../../src/prompts/systemPrompt";
import { mockUserPreferences } from "./userPreferencesFixture";

test("system prompt settings desktop: customize, save, and reset to default", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: { ollamaHost: false, comfyuiHost: false },
    }),
  );
  await mockUserPreferences(page);
  await page.goto("/customization");

  const prompt = page.getByLabel("System Prompt");
  const reset = page.getByRole("button", { name: "Reset to default" });
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(prompt).toHaveValue(DEFAULT_SYSTEM_PROMPT);
  await expect(reset).toBeDisabled();
  await expect(save).toBeHidden();

  await prompt.fill("Be terse.");
  await expect(reset).toBeEnabled();
  await save.click();
  await expect(save).toBeHidden();
  await expect(prompt).toHaveValue("Be terse.");

  await page.getByRole("button", { name: "{{OS}}" }).click();
  await expect(prompt).toHaveValue("Be terse.{{OS}}");

  await reset.click();
  await expect(prompt).toHaveValue(DEFAULT_SYSTEM_PROMPT);
  await expect(reset).toBeDisabled();
  await expect(save).toBeEnabled();
});

for (const device of ["desktop", "mobile"] as const) {
  test(`settings save ${device}: customization layout, tab drafts, and server failures`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(
      device === "desktop"
        ? { width: 1280, height: 900 }
        : { width: 390, height: 844 },
    );
    await page.addInitScript(() =>
      localStorage.setItem(
        "euler:userSettings",
        JSON.stringify({ defaultModel: "saved-model", showDebugButton: true }),
      ),
    );
    const writes: string[] = [];
    await page.route("**/api/**", (route) => {
      if (route.request().method() === "PUT")
        writes.push(route.request().url());
      return route.fulfill({ json: { skills: [] } });
    });
    await mockUserPreferences(page);
    await page.goto("/customization");
    const prompt = page.getByLabel("System Prompt");
    const name = page.getByPlaceholder("Enter your name");
    const save = page.getByRole("button", {
      name: "Save changes",
      exact: true,
    });
    expect((await prompt.boundingBox())!.y).toBeLessThan(
      (await name.boundingBox())!.y,
    );
    await page.screenshot({
      path: testInfo.outputPath(`${device}-customization.png`),
    });
    await name.fill("Ada");
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await expect(
      page.getByText("No skills yet.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New", exact: true }).click();
    const skillName = page.getByPlaceholder("release-notes");
    await skillName.fill("draft-skill");
    await expect(save).toBeVisible();
    await page
      .getByRole("button", { name: "Personalization", exact: true })
      .click();
    await expect(name).toHaveValue("Ada");
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await expect(skillName).toHaveValue("draft-skill");
    await page
      .getByRole("button", { name: "Personalization", exact: true })
      .click();
    await save.click();
    await expect(save).toBeHidden();
    expect(
      await page.evaluate(
        async () => (await (await fetch("/api/settings/user")).json()).settings,
      ),
    ).toMatchObject({
      name: "Ada",
      defaultModel: "saved-model",
      showDebugButton: true,
    });
    expect(writes).toEqual([]);

    await name.fill("Unsaved");
    await page.route("**/api/settings/user", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 503,
            json: { error: { message: "Could not save settings" } },
          })
        : route.fallback(),
    );
    await page.getByRole("button", { name: "Back to chat" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave customization?" });
    await dialog.getByRole("button", { name: "Save & leave" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not save settings",
    );
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/customization$/);
    await dialog
      .getByRole("button", { name: "Keep editing", exact: true })
      .last()
      .click();
    await page
      .locator("footer")
      .getByRole("button", { name: "Discard", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(name).toHaveValue("Ada");
    await expect(save).toBeHidden();
  });
}
