import { useCallback, useRef, useState } from "react";
import {
  saveComfyUIConfig,
  saveOllamaConfig,
  saveSearXNGConfig,
} from "../../persist/services";
import {
  type UserSettings,
  loadUserSettings,
  updateUserSettings,
} from "../../persist/userSettings";
import type {
  ComfyUIConfigPayload,
  Personalization,
  SearXNGConfigPayload,
} from "../../types";

export function useSettings(
  setOllamaHost: (host: string) => void,
  fetchOllamaHealth: () => Promise<void>,
  refreshOllamaModels: () => Promise<void>,
  fetchComfyUIHealth: () => Promise<void>,
  applyComfyConfigResponse: (data: ComfyUIConfigPayload) => void,
  fetchSearXNGHealth: () => Promise<void>,
  applySearXNGConfigResponse: (data: SearXNGConfigPayload) => void,
) {
  const [userSettings, setUserSettings] = useState<UserSettings>(() =>
    loadUserSettings(),
  );
  const userSettingsRef = useRef(userSettings);
  userSettingsRef.current = userSettings;

  const savePreferences = useCallback(
    async (updates: Partial<UserSettings>) => {
      setUserSettings(updateUserSettings(updates));
    },
    [],
  );
  const savePersonalization: (updates: Personalization) => Promise<void> =
    savePreferences;

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
      settings: UserSettings,
      ollamaHostToSave?: string,
      comfyui?: ComfyUIConfigPayload,
      searxng?: SearXNGConfigPayload,
    ) => {
      setUserSettings(updateUserSettings(settings));
      if (ollamaHostToSave !== undefined)
        await saveOllamaHost(ollamaHostToSave);
      if (comfyui) await saveComfyUISettings(comfyui);
      if (searxng) {
        applySearXNGConfigResponse(await saveSearXNGConfig(searxng));
        void fetchSearXNGHealth();
      }
    },
    [
      saveOllamaHost,
      saveComfyUISettings,
      fetchSearXNGHealth,
      applySearXNGConfigResponse,
    ],
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
