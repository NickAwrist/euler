import { useState } from "react";
import { SettingsPage } from "../components/SettingsPage";
import type { UserSettings } from "../persist/userSettings";

// Browser tests intercept every API request; this route never seeds app data.
export default function SettingsDemo() {
  const [settings, setSettings] = useState<UserSettings>({
    name: "",
    preferredFormats: "",
    location: "",
    defaultModel: "",
    includeCurrentDate: true,
    showDebugButton: false,
  });
  return (
    <div className="h-dvh">
      <SettingsPage
        currentSettings={settings}
        ollamaModels={[]}
        ollamaHost="http://ollama.test"
        ollamaConnected={false}
        comfyuiHost="http://comfyui.test"
        comfyuiConnected={false}
        comfyuiDefaultModel=""
        comfyuiDefaultWidth={1440}
        comfyuiDefaultHeight={1440}
        comfyuiNegativePrompt=""
        searxngHost="http://searxng.test"
        searxngConnected={false}
        onSave={async (next) => setSettings(next)}
        onModelsChanged={async () => {}}
        onBack={() => {}}
      />
    </div>
  );
}
