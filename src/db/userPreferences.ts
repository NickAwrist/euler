import { legacyImagePreferencesSchema } from "../schemas/legacyUserPreferences";
import {
  type UserPreferences,
  type UserPreferencesPatch,
  userPreferencesSchema,
} from "../schemas/userPreferences";
import { getDb } from "./connection";
import {
  getComfyUIDefaultModel,
  getComfyUIImageSize,
  getComfyUINegativePrompt,
} from "./settings";

export function getUserPreferences(ownerUuid: string): UserPreferences | null {
  const row = getDb()
    .query("SELECT value FROM user_preferences WHERE owner_uuid = ?")
    .get(ownerUuid) as { value: string } | null;
  return row ? userPreferencesSchema.parse(JSON.parse(row.value)) : null;
}

export function updateUserPreferences(
  ownerUuid: string,
  patch: UserPreferencesPatch,
  initialize = false,
): UserPreferences {
  return getDb().transaction(() => {
    const saved = getUserPreferences(ownerUuid);
    if (initialize && saved) return saved;
    const current = saved ?? defaultUserPreferences();
    const updated = userPreferencesSchema.parse({
      image: { ...current.image, ...patch.image },
      settings: { ...current.settings, ...patch.settings },
      appearance: { ...current.appearance, ...patch.appearance },
      layout: { ...current.layout, ...patch.layout },
    });
    getDb().run(
      "INSERT INTO user_preferences (owner_uuid, value) VALUES (?, ?) ON CONFLICT(owner_uuid) DO UPDATE SET value = excluded.value",
      [ownerUuid, JSON.stringify(updated)],
    );
    return updated;
  })();
}

// Existing global image defaults seed new users during migration.
function defaultUserPreferences(): UserPreferences {
  const size = getComfyUIImageSize();
  return userPreferencesSchema.parse({
    image: legacyImagePreferencesSchema.parse({
      defaultModel: getComfyUIDefaultModel(),
      defaultWidth: size.width,
      defaultHeight: size.height,
      negativePrompt: getComfyUINegativePrompt(),
    }),
  });
}
export function effectiveUserPreferences(ownerUuid: string): UserPreferences {
  return getUserPreferences(ownerUuid) ?? defaultUserPreferences();
}
