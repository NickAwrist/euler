import type { MessageInitShape } from "@bufbuild/protobuf";
import type { RunMetadataSchema } from "../../src/gen/euler/v1/agent_pb";
import type { UserSettings } from "../../src/gen/euler/v1/preferences_pb";
import { getUserPreferences, updateUserPreferences } from "./userPreferences";
export type { UserSettings };

export function loadUserSettings(): UserSettings {
  return getUserPreferences().settings!;
}
export async function updateUserSettings(
  updates: Partial<UserSettings>,
): Promise<UserSettings> {
  const { $typeName: _type, $unknown: _unknown, ...settings } = updates;
  // Clearing the prompt follows the default again, which the patch spells "".
  if ("systemPrompt" in settings && settings.systemPrompt === undefined)
    settings.systemPrompt = "";
  return (await updateUserPreferences({ settings })).settings!;
}

export function buildRunMetadata(
  settings: UserSettings,
): MessageInitShape<typeof RunMetadataSchema> {
  return {
    systemPrompt: settings.systemPrompt?.trim() || undefined,
    name: settings.name.trim() || undefined,
    location: settings.location.trim() || undefined,
    preferredFormats: settings.preferredFormats.trim() || undefined,
    includeCurrentDate: settings.includeCurrentDate,
  };
}
