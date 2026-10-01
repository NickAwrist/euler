import { expect, test } from "bun:test";
import {
  legacyImagePreferencesSchema,
  legacyUserPreferencesSchema,
} from "../../src/schemas/legacyUserPreferences";

test("migration preserves valid settings when neighboring legacy fields are invalid", () => {
  const migrated = legacyUserPreferencesSchema.parse({
    settings: { defaultModel: "saved-model", name: "Nick", systemPrompt: 42 },
    appearance: { theme: "nord", font: false },
    layout: {
      sidebarCollapsed: true,
      artifactWidth: 800,
      artifactState: "invalid",
    },
  });
  expect(migrated.settings).toMatchObject({
    defaultModel: "saved-model",
    name: "Nick",
    systemPrompt: null,
  });
  expect(migrated.appearance).toMatchObject({ theme: "nord", font: "default" });
  expect(migrated.layout).toMatchObject({
    sidebarCollapsed: true,
    artifactWidth: 800,
    artifactState: { open: false, workspace: "", path: null },
  });
});
test("out-of-range legacy image dimensions fall back without losing the model or prompt", () => {
  expect(
    legacyImagePreferencesSchema.parse({
      defaultModel: "image-model",
      defaultWidth: 20000,
      defaultHeight: 512,
      negativePrompt: "blurry",
    }),
  ).toEqual({
    defaultModel: "image-model",
    defaultWidth: 1440,
    defaultHeight: 512,
    negativePrompt: "blurry",
  });
});
