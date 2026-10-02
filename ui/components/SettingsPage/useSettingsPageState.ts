import { useCallback, useState } from "react";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import { changedFields } from "../../lib/changedFields";
import type { UserSettings } from "../../persist/userSettings";
import type { SettingsTab } from "../../types";
import type { SettingChange, SettingsPageProps } from "./types";
import { useAppearanceDraft } from "./useAppearanceDraft";
import { useComfyUIDraft, useOllamaDraft } from "./useProviderDrafts";

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
  ];
  const isDirty = changes.length > 0;

  const discardChanges = () => {
    appearance.reset();
    settings.reset();
    ollama.reset();
    comfy.reset();
    setError(null);
  };

  const handleSubmit = async (): Promise<boolean> => {
    if (!isDirty) return true;
    setIsSaving(true);
    setError(null);
    try {
      if (changes.some((change) => change.tab !== "appearance")) {
        await onSave(
          changedFields(settings.value, currentSettings),
          ollama.dirty ? ollama.host : undefined,
          comfy.changes.length > 0 ? comfy.patch : undefined,
        );
        settings.accept();
        ollama.accept();
        comfy.accept();
      }
      if (appearance.changes.length > 0) await appearance.save();
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
    isSaving,
    changes,
    isDirty,
    discardChanges,
    error,
    handleSubmit,
  };
}
