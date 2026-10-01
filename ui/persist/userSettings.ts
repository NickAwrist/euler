import type { z } from "zod";
import type { RunMetadataSchema } from "../../src/schemas/run";
import type { UserSettings } from "../../src/schemas/userPreferences";
import { getUserPreferences, updateUserPreferences } from "./userPreferences";
export type { UserSettings } from "../../src/schemas/userPreferences";

export function loadUserSettings(): UserSettings {
  return getUserPreferences().settings;
}
export async function updateUserSettings(
  updates: Partial<UserSettings>,
): Promise<UserSettings> {
  return (await updateUserPreferences({ settings: updates })).settings;
}

export function buildRunMetadata(
  settings: UserSettings,
): z.infer<typeof RunMetadataSchema> {
  return {
    systemPrompt: settings.systemPrompt?.trim() || undefined,
    name: settings.name.trim() || undefined,
    location: settings.location.trim() || undefined,
    preferredFormats: settings.preferredFormats.trim() || undefined,
    includeCurrentDate: settings.includeCurrentDate,
  };
}
