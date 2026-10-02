import { legacyUserPreferencesSchema } from "../../src/schemas/legacyUserPreferences";
import {
  type UserPreferences,
  type UserPreferencesPatch,
  userPreferencesPatchSchema,
  userPreferencesSchema,
} from "../../src/schemas/userPreferences";
import { userApiJson } from "../lib/api";
import { safeStorage } from "../lib/safeStorage";

let preferences = userPreferencesSchema.parse({});
export function getUserPreferences(): UserPreferences {
  return preferences;
}

export async function initializeUserPreferences(): Promise<void> {
  const saved: unknown = await userApiJson("/api/settings/user");
  if (saved !== null) {
    preferences = userPreferencesSchema.parse(saved);
  } else {
    const legacy = legacyUserPreferencesSchema.parse({
      settings: safeStorage.getJSON<unknown>("euler:userSettings", {}),
      appearance: safeStorage.getJSON<unknown>("euler:appearance", {}),
      layout: {
        sidebarCollapsed:
          safeStorage.getItem("euler:sidebarCollapsed") === "true",
        artifactWidth:
          Number(safeStorage.getItem("euler:artifactSidebarWidth")) || null,
        artifactState: safeStorage.getJSON<unknown>(
          "euler:artifactSidebarState",
          {},
        ),
      },
    });
    preferences = userPreferencesSchema.parse(
      await userApiJson("/api/settings/user", {
        method: "PUT",
        json: legacy,
      }),
    );
  }
  for (const key of [
    "euler:userSettings",
    "euler:appearance",
    "euler:sidebarCollapsed",
    "euler:artifactSidebarWidth",
    "euler:artifactSidebarState",
  ])
    safeStorage.removeItem(key);
}

let pending: Promise<unknown> = Promise.resolve();
export function updateUserPreferences(
  patch: UserPreferencesPatch,
): Promise<UserPreferences> {
  const validated = userPreferencesPatchSchema.parse(patch);
  const request = pending
    .catch(() => {})
    .then(async () => {
      const saved: unknown = await userApiJson("/api/settings/user", {
        method: "PATCH",
        json: validated,
      });
      preferences = userPreferencesSchema.parse(saved);
      return preferences;
    });
  pending = request;
  return request;
}
