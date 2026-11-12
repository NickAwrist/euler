import type { OllamaContextWindow } from "../../../src/gen/euler/v1/providers_pb";
import type { UserSettings } from "../../persist/userSettings";
import type {
  ComfyUIConfigPayload,
  ModelOption,
  OllamaConfigPayload,
  SettingsTab,
} from "../../types";

export type SettingChange = { tab: SettingsTab; label: string };

export type ConnectionTestState =
  | { status: "idle" }
  /** `holdLabel` keeps the last known connection visible while re-testing. */
  | { status: "loading"; holdLabel?: string }
  | { status: "ok"; label: string }
  | { status: "err"; message: string };

export type SettingsPageProps = {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  ollamaModels: ModelOption[];
  catalogLoaded: boolean;
  currentSettings: UserSettings;
  ollamaHost: string;
  ollamaContextWindow: OllamaContextWindow;
  ollamaConnected: boolean | null;
  comfyuiHost: string;
  comfyuiConnected: boolean | null;
  comfyuiDefaultModel: string;
  comfyuiDefaultWidth: number;
  comfyuiDefaultHeight: number;
  comfyuiNegativePrompt: string;
  onSave: (
    settings: Partial<UserSettings>,
    ollama?: OllamaConfigPayload,
    comfyui?: ComfyUIConfigPayload,
  ) => Promise<void>;
  chatgptCatalogError: string | null;
  onModelsChanged: () => Promise<void>;
  onBack: () => void;
};
