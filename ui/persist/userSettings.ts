import type { RunBody } from "../../src/schemas/run";

const STORAGE_KEY = "euler:userSettings";

export interface UserSettings {
  name: string;
  preferredFormats: string;
  location: string;
  defaultModel: string;
  includeCurrentDate: boolean;
  showDebugButton: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  name: "",
  preferredFormats: "",
  location: "",
  defaultModel: "",
  includeCurrentDate: true,
  showDebugButton: false,
};

export function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      name: parsed.name || "",
      preferredFormats: parsed.preferredFormats || "",
      location: parsed.location || "",
      defaultModel: parsed.defaultModel || "",
      includeCurrentDate: parsed.includeCurrentDate ?? true,
      showDebugButton: parsed.showDebugButton === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveUserSettings(settings: UserSettings): void {
  try {
    const toSave: UserSettings = {
      name: settings.name || "",
      preferredFormats: settings.preferredFormats || "",
      location: settings.location || "",
      defaultModel: settings.defaultModel || "",
      includeCurrentDate: settings.includeCurrentDate ?? true,
      showDebugButton: settings.showDebugButton === true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Ignore storage errors
  }
}

export function updateUserSettings(
  updates: Partial<UserSettings>,
): UserSettings {
  const current = loadUserSettings();
  const updated = { ...current, ...updates };
  saveUserSettings(updated);
  return updated;
}

export function buildRunMetadata(
  settings: UserSettings,
): NonNullable<RunBody["metadata"]> {
  return {
    name: settings.name.trim() || undefined,
    location: settings.location.trim() || undefined,
    preferredFormats: settings.preferredFormats.trim() || undefined,
    includeCurrentDate: settings.includeCurrentDate,
  };
}
