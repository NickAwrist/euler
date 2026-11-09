import { type Page, expect, test } from "@playwright/test";
import {
  type SkillFields,
  type SkillSchema,
  SkillService,
} from "../../src/gen/euler/v1/skills_pb";
import { type Init, at } from "./appFixture";
import { mockRpc, on } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

const skill: Init<typeof SkillSchema> = {
  id: "skill-1",
  name: "storytelling",
  description: "Write short stories.",
  instructions: `# Storytelling\n\n${"Use three acts.\n".repeat(40)}`,
  userInvocable: true,
  disableModelInvocation: false,
  createdAt: at(1),
  updatedAt: at(1),
};

async function openSkill(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "euler:userUuid",
      "12345678-1234-4234-9234-123456789abc",
    );
  });
  await mockRpc(
    page,
    [on(SkillService.method.listSkills, () => ({ skills: [skill] }))],
    { empty: true },
  );
  await mockUserPreferences(page);
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
  let saved: SkillFields | undefined;
  await mockRpc(page, [
    on(SkillService.method.updateSkill, (request) => {
      saved = request.skill;
      return {
        skill: { ...skill, ...request.skill, id: request.id },
      };
    }),
  ]);

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "Back to chat" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave customization?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save & leave" }).click();

  await expect(page).not.toHaveURL(/\/customization$/);
  expect(saved).toMatchObject({ instructions: "Open with dialogue." });
});
