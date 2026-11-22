import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { OllamaContextWindow } from "../../../src/gen/euler/v1/providers_pb";
import {
  saveOllamaConfig,
  saveOllamaContextWindow,
} from "../../persist/services";
import {
  type UserSettings,
  loadUserSettings,
  updateUserSettings,
} from "../../persist/userSettings";
import type { OllamaConfigPayload, Personalization } from "../../types";

export function useSettings(
  setOllamaHost: (host: string) => void,
  setOllamaContextWindow: (contextWindow: OllamaContextWindow) => void,
  fetchOllamaHealth: () => Promise<void>,
  refreshOllamaModels: () => Promise<void>,
) {
  const [userSettings, setUserSettings] = useState<UserSettings>(() =>
    loadUserSettings(),
  );
  const userSettingsRef = useRef(userSettings);
  useLayoutEffect(() => {
    userSettingsRef.current = userSettings;
  });

  const savePreferences = useCallback(
    async (updates: Partial<UserSettings>) => {
      setUserSettings(await updateUserSettings(updates));
    },
    [],
  );
  const savePersonalization: (
    updates: Partial<Personalization>,
  ) => Promise<void> = savePreferences;

  const saveOllamaHost = useCallback(
    async (host: string) => {
      setOllamaHost((await saveOllamaConfig(host)).host);
      void fetchOllamaHealth();
      void refreshOllamaModels();
    },
    [setOllamaHost, fetchOllamaHealth, refreshOllamaModels],
  );

  const saveUserSettings = useCallback(
    async (settings: Partial<UserSettings>, ollama?: OllamaConfigPayload) => {
      await savePreferences(settings);
      if (ollama?.host !== undefined) await saveOllamaHost(ollama.host);
      if (ollama?.contextWindow !== undefined)
        setOllamaContextWindow(
          await saveOllamaContextWindow(ollama.contextWindow),
        );
    },
    [savePreferences, saveOllamaHost, setOllamaContextWindow],
  );

  return {
    userSettings,
    userSettingsRef,
    saveUserSettings,
    saveOllamaHost,
    savePersonalization,
    savePreferences,
  };
}
