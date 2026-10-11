import { expect, test } from "@playwright/test";
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

test("skills mobile: the list and an open skill take turns on screen", async ({
  page,
}) => {
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
