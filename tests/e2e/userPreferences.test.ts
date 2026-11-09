import { expect, test } from "bun:test";
import { getDb } from "../../src/db/connection";
import { createSchema } from "../../src/db/schema";
import { setOllamaHost } from "../../src/db/settings";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../../src/db/userPreferences";
import { ModelProvider } from "../../src/gen/euler/v1/models_pb";
import { Appearance_Theme } from "../../src/gen/euler/v1/preferences_pb";
import { preferences as toProto } from "../../src/rpc/preferences";
import { userPreferencesSchema } from "../../src/schemas/userPreferences";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";

const other = "22222222-2222-4222-8222-222222222222";
test("preferences require identity, isolate users, preserve unrelated fields, and reject invalid writes", async () => {
  const mine = rpc().preferences;
  const theirs = rpc(other).preferences;
  expect(await rpcCode(rpc(null).preferences.getPreferences({}))).toBe(
    Code.InvalidArgument,
  );
  // A user who never saved preferences gets the defaults.
  expect((await mine.getPreferences({})).preferences).toEqual(
    toProto(userPreferencesSchema.parse({})),
  );
  await mine.updatePreferences({
    settings: { defaultModel: "model-a", name: "Nick" },
    appearance: { theme: Appearance_Theme.NORD },
    layout: { sidebarCollapsed: true },
  });
  await mine.updatePreferences({ settings: { showDebugButton: true } });
  const saved = (await mine.getPreferences({})).preferences;
  expect(saved?.settings).toMatchObject({
    defaultModel: "model-a",
    name: "Nick",
    showDebugButton: true,
  });
  expect(saved?.appearance?.theme).toBe(Appearance_Theme.NORD);
  expect(saved?.layout?.sidebarCollapsed).toBe(true);
  expect(
    (await theirs.getPreferences({})).preferences?.settings?.defaultModel,
  ).toBe("");
  await theirs.updatePreferences({ settings: { defaultModel: "model-b" } });
  expect(getUserPreferences(TEST_USER_ID)?.settings.defaultModel).toBe(
    "model-a",
  );
  expect(getUserPreferences(other)?.settings.defaultModel).toBe("model-b");
  // Clearing the system prompt returns to the default one.
  await mine.updatePreferences({ settings: { systemPrompt: "Be brief." } });
  expect(getUserPreferences(TEST_USER_ID)?.settings.systemPrompt).toBe(
    "Be brief.",
  );
  await mine.updatePreferences({ settings: { systemPrompt: "" } });
  expect(getUserPreferences(TEST_USER_ID)?.settings.systemPrompt).toBeNull();
  for (const patch of [
    { appearance: { theme: 99 as Appearance_Theme } },
    { image: { defaultWidth: 0 } },
    { layout: { artifactWidth: 100 } },
    { appearance: { sidebarAnimationMs: 601 } },
    { settings: { name: "n".repeat(1001) } },
  ])
    expect(await rpcCode(mine.updatePreferences(patch))).toBe(
      Code.InvalidArgument,
    );
  expect(getUserPreferences(TEST_USER_ID)?.settings.defaultModel).toBe(
    "model-a",
  );
});

test("startup schema creation preserves saved preferences", () => {
  updateUserPreferences(TEST_USER_ID, {
    settings: { defaultModel: "persisted" },
  });
  // Re-running startup schema creation must preserve saved preferences.
  createSchema(getDb());
  expect(getUserPreferences(TEST_USER_ID)?.settings.defaultModel).toBe(
    "persisted",
  );
});

test("image defaults and model favorites are scoped to the requesting user", async () => {
  setOllamaHost("http://ollama.test");
  for (const [owner, model] of [
    [TEST_USER_ID, "image-a"],
    [other, "image-b"],
  ] as const) {
    const saved = await rpc(owner).providers.updateComfyUiConfig({
      image: { defaultModel: model, defaultWidth: 512, defaultHeight: 768 },
    });
    expect(saved.image?.defaultModel).toBe(model);
  }
  const partial = await rpc().providers.updateComfyUiConfig({
    image: { negativePrompt: "blurry" },
  });
  expect(partial.image).toMatchObject({
    defaultModel: "image-a",
    defaultWidth: 512,
    defaultHeight: 768,
    negativePrompt: "blurry",
  });
  await rpc().models.setFavorite({
    provider: ModelProvider.OLLAMA,
    modelId: "llama3:latest",
    favorite: true,
  });
  for (const [owner, expected] of [
    [TEST_USER_ID, true],
    [other, false],
  ] as const) {
    const { models } = await rpc(owner).models.listModels({});
    expect(models.find((model) => model.id === "llama3:latest")?.favorite).toBe(
      expected,
    );
  }
  expect(
    await rpcCode(
      rpc().models.setFavorite({
        provider: ModelProvider.OPENROUTER,
        modelId: "openrouter:openai/gpt",
        favorite: true,
      }),
    ),
  ).toBe(Code.InvalidArgument);
});
