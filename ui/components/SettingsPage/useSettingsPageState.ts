import { useCallback, useState } from "react";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import type { UserSettings } from "../../persist/userSettings";
import type { SettingsTab } from "../../types";
import type { SettingChange, SettingsPageProps } from "./types";
import { useAppearanceDraft } from "./useAppearanceDraft";
import { useBraveSettings } from "./useBraveSettings";
import {
  useComfyUIDraft,
  useOllamaDraft,
  useSearXNGDraft,
} from "./useProviderDrafts";

type Args = Pick<
  SettingsPageProps,
  | "currentSettings"
  | "ollamaHost"
  | "ollamaConnected"
  | "comfyuiHost"
  | "comfyuiConnected"
  | "comfyuiDefaultModel"
  | "comfyuiDefaultWidth"
  | "comfyuiDefaultHeight"
  | "comfyuiNegativePrompt"
  | "searxngHost"
  | "searxngConnected"
  | "onSave"
>;

export function useSettingsPageState({
  currentSettings,
  ollamaHost,
  ollamaConnected,
  comfyuiHost,
  comfyuiConnected,
  comfyuiDefaultModel,
  comfyuiDefaultWidth,
  comfyuiDefaultHeight,
  comfyuiNegativePrompt,
  searxngHost,
  searxngConnected,
  onSave,
}: Args) {
  const appearance = useAppearanceDraft();
  const settings = useSavedDraft(currentSettings);
  const ollama = useOllamaDraft(ollamaHost, ollamaConnected);
  const comfy = useComfyUIDraft(
    {
      host: comfyuiHost,
      defaultModel: comfyuiDefaultModel,
      defaultWidth: comfyuiDefaultWidth,
      defaultHeight: comfyuiDefaultHeight,
      negativePrompt: comfyuiNegativePrompt,
    },
    comfyuiConnected,
  );
  const searxng = useSearXNGDraft(searxngHost, searxngConnected);
  const brave = useBraveSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback(
    <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
      settings.setValue((prev) => ({ ...prev, [field]: value }));
    },
    [settings.setValue],
  );

  const tabChanges = (tab: SettingsTab, labels: readonly string[]) =>
    labels.map((label): SettingChange => ({ tab, label }));
  const changes: SettingChange[] = [
    ...tabChanges("general", [
      ...(settings.value.defaultModel !== currentSettings.defaultModel
        ? ["Default model"]
        : []),
      ...(settings.value.showDebugButton !== currentSettings.showDebugButton
        ? ["Display debug button"]
        : []),
    ]),
    ...tabChanges("appearance", appearance.changes),
    ...tabChanges("ollama", ollama.dirty ? ["Ollama server URL"] : []),
    ...tabChanges("image-generation", comfy.changes),
    ...tabChanges("web-search", searxng.dirty ? ["SearXNG server URL"] : []),
  ];
  const isDirty = changes.length > 0;

  const discardChanges = () => {
    appearance.reset();
    settings.reset();
    ollama.reset();
    comfy.reset();
    searxng.reset();
    setError(null);
  };

  const handleSubmit = async (): Promise<boolean> => {
    if (!isDirty) return true;
    setIsSaving(true);
    setError(null);
    try {
      if (changes.some((change) => change.tab !== "appearance")) {
        await onSave(
          settings.value,
          ollama.dirty ? ollama.host : undefined,
          comfy.changes.length > 0 ? comfy.config : undefined,
          searxng.dirty ? { host: searxng.host } : undefined,
        );
        settings.accept();
        ollama.accept();
        comfy.accept();
        searxng.accept();
      }
      if (appearance.changes.length > 0) appearance.save();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return {
    appearance,
    settings: settings.value,
    handleChange,
    ollama,
    comfy,
    searxng,
    brave,
    isSaving,
    changes,
    isDirty,
    discardChanges,
    error,
    handleSubmit,
  };
}
