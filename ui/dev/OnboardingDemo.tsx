import { useState } from "react";
import { Onboarding } from "../components/Onboarding";
import { saveComfyUIConfig } from "../persist/comfyui";
import { saveOllamaConfig } from "../persist/services";
import { loadUserSettings, updateUserSettings } from "../persist/userSettings";

export default function OnboardingDemo() {
  const [settings, setSettings] = useState(loadUserSettings);
  const [done, setDone] = useState(false);
  return done ? (
    <p>Setup complete</p>
  ) : (
    <Onboarding
      settings={settings}
      models={[
        {
          id: "qwen3:8b",
          name: "Qwen 3 8B",
          provider: "ollama",
          lab: "Qwen",
          inputCapabilities: ["text"],
        },
      ]}
      catalogLoaded
      ollama={{ host: "", connected: null }}
      comfyui={{
        host: "",
        defaultModel: "",
        defaultWidth: 1440,
        defaultHeight: 1440,
        negativePrompt: "",
        connected: null,
      }}
      onSavePreferences={async (updates) => {
        setSettings(await updateUserSettings(updates));
      }}
      onSaveOllamaHost={async (host) => {
        await saveOllamaConfig(host);
      }}
      onSaveComfyUI={async (config) => {
        await saveComfyUIConfig(config);
      }}
      onModelsChanged={async () => {}}
      onComplete={() => setDone(true)}
    />
  );
}
