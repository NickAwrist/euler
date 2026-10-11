import { type Page, expect, test } from "@playwright/test";
import type { SkillData } from "../../src/schemas/skills";
import { mockUserPreferences } from "./userPreferencesFixture";

const skill: SkillData = {
  id: "skill-1",
  name: "storytelling",
  description: "Write short stories.",
  instructions: `# Storytelling\n\n${"Use three acts.\n".repeat(40)}`,
  user_invocable: true,
  disable_model_invocation: false,
  created_at: 1,
  updated_at: 1,
};

async function openSkill(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await mockUserPreferences(page);
  await page.route("**/api/skills", (route) =>
    route.fulfill({ json: { skills: [skill] } }),
  );
  await page.goto("/customization");
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page.getByText("Select a skill")).toBeHidden();
  await page.getByRole("button", { name: /\$storytelling/ }).click();
}

const instructions = (page: Page) =>
  page.getByRole("textbox", { name: "Instructions" });

test("skills mobile: the list and an open skill take turns on screen", async ({
  page,
}) => {
  await openSkill(page);

  await expect(
    page.getByRole("button", { name: /\$storytelling/ }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Edit: $storytelling" }),
  ).toBeVisible();
  // Save stays reachable above long instructions.
  await expect(page.getByRole("button", { name: "Save" })).toBeInViewport();

  await page
    .getByRole("button", { name: "Skills", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: /\$storytelling/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Edit:/ })).toBeHidden();
});

test("skills mobile: going back asks before discarding edits", async ({
  page,
}) => {
  await openSkill(page);
  await instructions(page).fill("Open with dialogue.");
  const back = page.getByRole("button", { name: "Skills", exact: true }).last();

  await back.click();
  const dialog = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(
    dialog.getByRole("list", { name: "Changed settings" }),
  ).toHaveText("Instructions");
  await dialog
    .getByRole("button", { name: "Keep editing", exact: true })
    .last()
    .click();
  await expect(instructions(page)).toHaveValue("Open with dialogue.");

  await back.click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(
    page.getByRole("button", { name: /\$storytelling/ }),
  ).toBeVisible();
});

test("skills desktop: leaving from another tab offers to save skill edits", async ({
  page,
}) => {
  await openSkill(page);
  await instructions(page).fill("Open with dialogue.");
  let saved: unknown = null;
  await page.route("**/api/skills/skill-1", (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({
      json: { ...skill, instructions: "Open with dialogue." },
    });
  });

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "Back to chat" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave customization?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save & leave" }).click();

  await expect(page).not.toHaveURL(/\/customization$/);
  expect(saved).toMatchObject({ instructions: "Open with dialogue." });
});
