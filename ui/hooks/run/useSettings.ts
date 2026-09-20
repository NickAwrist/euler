import { useCallback, useRef, useState } from "react";
import {
  type UserSettings,
  loadUserSettings,
  updateUserSettings,
} from "../../persist/userSettings";
import type { ComfyUIConfigPayload, SearXNGConfigPayload } from "../../types";

type ComfyConfigResponse = {
  host?: string;
  defaultModel?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  negativePrompt?: string;
};

type SearXNGConfigResponse = {
  host?: string;
};

export function useSettings(
  setOllamaHost: (host: string) => void,
  fetchOllamaHealth: () => Promise<void>,
  refreshOllamaModels: () => Promise<void>,
  fetchComfyUIHealth: () => Promise<void>,
  applyComfyConfigResponse: (data: ComfyConfigResponse) => void,
  fetchSearXNGHealth: () => Promise<void>,
  applySearXNGConfigResponse: (data: SearXNGConfigResponse) => void,
) {
  const [userSettings, setUserSettings] = useState<UserSettings>(() =>
    loadUserSettings(),
  );
  const userSettingsRef = useRef(userSettings);
  userSettingsRef.current = userSettings;

  const saveUserSettings = useCallback(
    async (
      settings: UserSettings,
      ollamaHostToSave: string,
      comfyui?: ComfyUIConfigPayload,
      searxng?: SearXNGConfigPayload,
    ) => {
      const updated = updateUserSettings(settings);
      setUserSettings(updated);
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

      if (comfyui) {
        const cRes = await fetch("/api/comfyui/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(comfyui),
        });
        if (!cRes.ok) throw new Error("Failed to save ComfyUI settings");
        const cData = (await cRes.json()) as ComfyConfigResponse;
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
  };
}
