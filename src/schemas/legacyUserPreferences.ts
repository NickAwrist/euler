import { z } from "zod";
import {
  imagePreferencesSchema,
  userPreferencesSchema,
} from "./userPreferences";

// Old browser values and global image defaults had weaker validation. Recover
// each field independently so one invalid value cannot erase the other fields.
export const legacyUserPreferencesSchema = z.object({
  settings: z
    .object({
      systemPrompt: userPreferencesSchema.shape.settings
        .unwrap()
        .shape.systemPrompt.catch(null),
      name: userPreferencesSchema.shape.settings.unwrap().shape.name.catch(""),
      preferredFormats: userPreferencesSchema.shape.settings
        .unwrap()
        .shape.preferredFormats.catch(""),
      location: userPreferencesSchema.shape.settings
        .unwrap()
        .shape.location.catch(""),
      defaultModel: userPreferencesSchema.shape.settings
        .unwrap()
        .shape.defaultModel.catch(""),
      includeCurrentDate: userPreferencesSchema.shape.settings
        .unwrap()
        .shape.includeCurrentDate.catch(true),
      showDebugButton: userPreferencesSchema.shape.settings
        .unwrap()
        .shape.showDebugButton.catch(false),
    })
    .catch(() => userPreferencesSchema.parse({}).settings),
  appearance: userPreferencesSchema.shape.appearance.catch(
    () => userPreferencesSchema.parse({}).appearance,
  ),
  layout: z
    .object({
      sidebarCollapsed: userPreferencesSchema.shape.layout
        .unwrap()
        .shape.sidebarCollapsed.catch(false),
      artifactWidth: userPreferencesSchema.shape.layout
        .unwrap()
        .shape.artifactWidth.catch(null),
      artifactState: userPreferencesSchema.shape.layout
        .unwrap()
        .shape.artifactState.catch({ open: false, workspace: "", path: null }),
    })
    .catch(() => userPreferencesSchema.parse({}).layout),
});
export const legacyImagePreferencesSchema = z.object({
  defaultModel: imagePreferencesSchema.shape.defaultModel.catch(""),
  defaultWidth: imagePreferencesSchema.shape.defaultWidth.catch(1440),
  defaultHeight: imagePreferencesSchema.shape.defaultHeight.catch(1440),
  negativePrompt: imagePreferencesSchema.shape.negativePrompt.catch(
    () => imagePreferencesSchema.parse({}).negativePrompt,
  ),
});
