import { z } from "zod";
import { safeStorage } from "../lib/safeStorage";
import { getOrCreateUserId } from "./userIdentity";

const thinkingPreferencesSchema = z.record(z.string(), z.string().min(1));
export type ThinkingPreferences = z.infer<typeof thinkingPreferencesSchema>;

function storageKey(): string {
  return `euler:thinkingPreferences:${getOrCreateUserId()}`;
}

export function loadThinkingPreferences(): ThinkingPreferences {
  const result = thinkingPreferencesSchema.safeParse(
    safeStorage.getJSON<unknown>(storageKey(), {}),
  );
  return result.success ? result.data : {};
}

export function saveThinkingPreference(
  model: string,
  effort: string,
  inMemoryPreferences: ThinkingPreferences = {},
): ThinkingPreferences {
  const preferences = { ...loadThinkingPreferences(), [model]: effort };
  if (safeStorage.setJSON(storageKey(), preferences)) return preferences;
  return { ...preferences, ...inMemoryPreferences, [model]: effort };
}

export function subscribeThinkingPreferences(
  onChange: (preferences: ThinkingPreferences) => void,
): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key !== null && event.key !== storageKey()) return;
    onChange(loadThinkingPreferences());
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
