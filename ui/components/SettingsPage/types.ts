import type { UserSettings } from "../../persist/userSettings";
import type {
  ComfyUIConfigPayload,
  ModelOption,
  SettingsTab,
} from "../../types";

export type SettingChange = { tab: SettingsTab; label: string };

export type ComfyUITestState =
  | { status: "idle" }
  | { status: "loading"; holdConnected?: boolean }
  | { status: "ok" }
  | { status: "err"; message: string };

export type OllamaTestState =
  | { status: "idle" }
  | {
      status: "loading";
      previousVersion?: string;
      holdSavedConnected?: boolean;
    }
  | { status: "ok"; version: string }
  | { status: "err"; message: string };

export type SettingsPageProps = {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  ollamaModels: ModelOption[];
  catalogLoaded: boolean;
  currentSettings: UserSettings;
  ollamaHost: string;
  ollamaConnected: boolean | null;
  comfyuiHost: string;
  comfyuiConnected: boolean | null;
  comfyuiDefaultModel: string;
  comfyuiDefaultWidth: number;
  comfyuiDefaultHeight: number;
  comfyuiNegativePrompt: string;
  onSave: (
    settings: UserSettings,
    ollamaHost: string,
    comfyui?: ComfyUIConfigPayload,
  ) => Promise<void>;
  onModelsChanged: () => Promise<void>;
  onBack: () => void;
};
