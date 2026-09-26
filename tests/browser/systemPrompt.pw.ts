import { expect, test } from "@playwright/test";
import { DEFAULT_SYSTEM_PROMPT } from "../../src/prompts/systemPrompt";

test("system prompt settings desktop: customize, save, and reset to default", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: { ollamaHost: false, comfyuiHost: false, searxngHost: false },
    }),
  );
  await page.goto("/dev/settings");

  const prompt = page.getByLabel("System Prompt");
  const reset = page.getByRole("button", { name: "Reset to default" });
  const save = page.getByRole("button", { name: "Save settings" });
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
