import { useCallback, useRef, useState } from "react";
import type { ComfyUIConfigResponse } from "../../../src/schemas/comfyui";
import { saveComfyUIConfig } from "../../persist/comfyui";
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

type SearXNGConfigResponse = {
  host?: string;
};

export function useSettings(
  setOllamaHost: (host: string) => void,
  fetchOllamaHealth: () => Promise<void>,
  refreshOllamaModels: () => Promise<void>,
  fetchComfyUIHealth: () => Promise<void>,
  applyComfyConfigResponse: (data: ComfyUIConfigResponse) => void,
  fetchSearXNGHealth: () => Promise<void>,
  applySearXNGConfigResponse: (data: SearXNGConfigResponse) => void,
) {
  const [userSettings, setUserSettings] = useState<UserSettings>(() =>
    loadUserSettings(),
  );
  const userSettingsRef = useRef(userSettings);
  userSettingsRef.current = userSettings;

  const savePersonalization = useCallback(
    async (updates: Partial<Personalization>) => {
      setUserSettings(await updateUserSettings(updates));
    },
    [],
  );

  const saveUserSettings = useCallback(
    async (
      settings: Partial<UserSettings>,
      ollamaHostToSave: string | undefined,
      comfyui?: ComfyUIConfigPayload,
      searxng?: SearXNGConfigPayload,
    ) => {
      const updated = await updateUserSettings(settings);
      setUserSettings(updated);
      if (ollamaHostToSave !== undefined) {
        const res = await fetch("/api/ollama/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host: ollamaHostToSave }),
        });
        if (!res.ok) throw new Error("Failed to save Ollama URL");
        const data = (await res.json()) as { host?: string };
        if (typeof data.host === "string") setOllamaHost(data.host);
        void fetchOllamaHealth();
        void refreshOllamaModels();
      }

      if (comfyui) {
        const cData = await saveComfyUIConfig(comfyui);
        applyComfyConfigResponse(cData);
        void fetchComfyUIHealth();
      }

      if (searxng) {
        const sRes = await fetch("/api/searxng/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(searxng),
        });
        if (!sRes.ok) throw new Error("Failed to save SearXNG settings");
        const sData = (await sRes.json()) as SearXNGConfigResponse;
        applySearXNGConfigResponse(sData);
        void fetchSearXNGHealth();
      }
    },
    [
      setOllamaHost,
      fetchOllamaHealth,
      refreshOllamaModels,
      fetchComfyUIHealth,
      applyComfyConfigResponse,
      fetchSearXNGHealth,
      applySearXNGConfigResponse,
    ],
  );

  return {
    userSettings,
    userSettingsRef,
    saveUserSettings,
    savePersonalization,
  };
}
