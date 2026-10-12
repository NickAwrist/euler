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

export function saveThinkingPreferences(
  preferences: ThinkingPreferences,
): void {
  safeStorage.setJSON(storageKey(), preferences);
}
