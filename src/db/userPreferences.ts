import {
  type UserPreferences,
  type UserPreferencesPatch,
  userPreferencesSchema,
} from "../schemas/userPreferences";
import { getDb } from "./connection";

export function getUserPreferences(ownerUuid: string): UserPreferences | null {
  const row = getDb()
    .query("SELECT value FROM user_preferences WHERE owner_uuid = ?")
    .get(ownerUuid) as { value: string } | null;
  return row ? userPreferencesSchema.parse(JSON.parse(row.value)) : null;
}

export function updateUserPreferences(
  ownerUuid: string,
  patch: UserPreferencesPatch,
): UserPreferences {
  return getDb().transaction(() => {
    const current = effectiveUserPreferences(ownerUuid);
    const updated = userPreferencesSchema.parse({
      image: { ...current.image, ...patch.image },
      settings: { ...current.settings, ...patch.settings },
      appearance: { ...current.appearance, ...patch.appearance },
      layout: { ...current.layout, ...patch.layout },
      capabilities: { ...current.capabilities, ...patch.capabilities },
      toolPermissions: { ...current.toolPermissions, ...patch.toolPermissions },
    });
    getDb().run(
      "INSERT INTO user_preferences (owner_uuid, value) VALUES (?, ?) ON CONFLICT(owner_uuid) DO UPDATE SET value = excluded.value",
      [ownerUuid, JSON.stringify(updated)],
    );
    return updated;
  })();
}

export function effectiveUserPreferences(ownerUuid: string): UserPreferences {
  return getUserPreferences(ownerUuid) ?? userPreferencesSchema.parse({});
}
