import { useCallback, useRef, useState } from "react";
import type { ComfyUIConfigResponse } from "../../../src/schemas/comfyui";
import { saveComfyUIConfig } from "../../persist/comfyui";
import { saveOllamaConfig } from "../../persist/services";
import {
  type UserSettings,
  loadUserSettings,
  updateUserSettings,
} from "../../persist/userSettings";
import type { ComfyUIConfigPayload, Personalization } from "../../types";

export function useSettings(
  setOllamaHost: (host: string) => void,
  fetchOllamaHealth: () => Promise<void>,
  refreshOllamaModels: () => Promise<void>,
  fetchComfyUIHealth: () => Promise<void>,
  applyComfyConfigResponse: (data: ComfyUIConfigResponse) => void,
) {
  const [userSettings, setUserSettings] = useState<UserSettings>(() =>
    loadUserSettings(),
  );
  const userSettingsRef = useRef(userSettings);
  userSettingsRef.current = userSettings;

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

  const saveComfyUISettings = useCallback(
    async (comfyui: ComfyUIConfigPayload) => {
      applyComfyConfigResponse(await saveComfyUIConfig(comfyui));
      void fetchComfyUIHealth();
    },
    [applyComfyConfigResponse, fetchComfyUIHealth],
  );

  const saveUserSettings = useCallback(
    async (
      settings: Partial<UserSettings>,
      ollamaHostToSave: string | undefined,
      comfyui?: ComfyUIConfigPayload,
    ) => {
      await savePreferences(settings);
      if (ollamaHostToSave !== undefined)
        await saveOllamaHost(ollamaHostToSave);
      if (comfyui) await saveComfyUISettings(comfyui);
    },
    [savePreferences, saveOllamaHost, saveComfyUISettings],
  );

  return {
    userSettings,
    userSettingsRef,
    saveUserSettings,
    saveOllamaHost,
    saveComfyUISettings,
    savePersonalization,
    savePreferences,
  };
}
