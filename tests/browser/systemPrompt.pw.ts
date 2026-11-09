import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import { expect, test } from "@playwright/test";
import { PreferenceService } from "../../src/gen/euler/v1/preferences_pb";
import { DEFAULT_SYSTEM_PROMPT } from "../../src/prompts/systemPrompt";
import type { UserPreferences } from "../../src/schemas/userPreferences";
import { RpcFailure, mockRpc, on, rpcKey, rpcMethod } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

const USER = "12345678-1234-4234-9234-123456789abc";

// These checks exercise returning users; first-visit setup has its own suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((user) => {
    localStorage.setItem("euler:userUuid", user);
  }, USER);
});

test("system prompt settings desktop: customize, save, and reset to default", async ({
  page,
}) => {
  await mockRpc(page, [], { empty: true });
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
    // Saving settings writes preferences and nothing else.
    const writes: string[] = [];
    page.on("request", (request) => {
      const method = rpcMethod(request);
      if (
        method?.methodKind === "unary" &&
        method.parent.typeName !== PreferenceService.typeName &&
        method.idempotency !== MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
      )
        writes.push(rpcKey(request)!);
    });
    const store = new Map<string, UserPreferences>();
    await mockRpc(page, [], { empty: true });
    await mockUserPreferences(page, store, {
      settings: { defaultModel: "saved-model", showDebugButton: true },
    });
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
    await page
      .getByRole("navigation", { name: "Customization sections" })
      .getByRole("button", { name: "Skills", exact: true })
      .click();
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
    await page
      .getByRole("navigation", { name: "Customization sections" })
      .getByRole("button", { name: "Skills", exact: true })
      .click();
    await expect(skillName).toHaveValue("draft-skill");
    await page
      .getByRole("button", { name: "Personalization", exact: true })
      .click();
    await save.click();
    await expect(save).toBeHidden();
    expect(store.get(USER)?.settings).toMatchObject({
      name: "Ada",
      defaultModel: "saved-model",
      showDebugButton: true,
    });
    expect(writes).toEqual([]);

    await name.fill("Unsaved");
    await mockRpc(page, [
      on(
        PreferenceService.method.updatePreferences,
        () =>
          new RpcFailure(
            "internal",
            "Could not save settings",
            "INTERNAL_ERROR",
          ),
      ),
    ]);
    await page.getByRole("button", { name: "Back to chat" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave customization?" });
    await dialog.getByRole("button", { name: "Save & leave" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not save settings",
    );
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/customization\/personalization$/);
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
