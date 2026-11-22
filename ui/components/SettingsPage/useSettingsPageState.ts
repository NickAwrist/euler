import { useState } from "react";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import { changedFields } from "../../lib/changedFields";
import { whileRunning } from "../../lib/whileRunning";
import type { UserSettings } from "../../persist/userSettings";
import type { SettingsTab } from "../../types";
import type { SettingChange, SettingsPageProps } from "./types";
import { useAppearanceDraft } from "./useAppearanceDraft";
import { useImageGenDraft } from "./useImageGenDraft";
import { useOllamaDraft } from "./useProviderDrafts";

type Args = Pick<
  SettingsPageProps,
  | "currentSettings"
  | "ollamaHost"
  | "ollamaContextWindow"
  | "ollamaConnected"
  | "onSave"
>;

export function useSettingsPageState({
  currentSettings,
  ollamaHost,
  ollamaContextWindow,
  ollamaConnected,
  onSave,
}: Args) {
  const appearance = useAppearanceDraft();
  const imageGen = useImageGenDraft();
  const settings = useSavedDraft(currentSettings);
  const ollama = useOllamaDraft(ollamaHost, ollamaConnected);
  const contextWindow = useSavedDraft(ollamaContextWindow);
  const contextWindowDirty = contextWindow.value !== ollamaContextWindow;
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = <K extends keyof UserSettings>(
    field: K,
    value: UserSettings[K],
  ) => {
    settings.setValue((prev) => ({ ...prev, [field]: value }));
  };

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
    ...tabChanges("ollama", [
      ...(ollama.dirty ? ["Ollama server URL"] : []),
      ...(contextWindowDirty ? ["Ollama context window"] : []),
    ]),
    ...tabChanges("image-generation", imageGen.changes),
  ];
  const isDirty = changes.length > 0;

  const discardChanges = () => {
    appearance.reset();
    imageGen.reset();
    settings.reset();
    ollama.reset();
    contextWindow.reset();
    setError(null);
  };

  const handleSubmit = async (): Promise<boolean> => {
    if (!isDirty) return true;
    const save = async () => {
      if (
        changes.some(
          (change) =>
            change.tab !== "appearance" && change.tab !== "image-generation",
        )
      ) {
        await onSave(changedFields(settings.value, currentSettings), {
          ...(ollama.dirty ? { host: ollama.host } : {}),
          ...(contextWindowDirty ? { contextWindow: contextWindow.value } : {}),
        });
        settings.accept();
        ollama.accept();
        contextWindow.accept();
      }
      if (appearance.changes.length > 0) await appearance.save();
      if (imageGen.changes.length > 0) await imageGen.save();
    };
    setError(null);
    return whileRunning(setIsSaving, () =>
      save().then(
        () => true,
        (err: unknown) => {
          setError(
            err instanceof Error ? err.message : "Failed to save settings",
          );
          return false;
        },
      ),
    );
  };

  return {
    appearance,
    imageGen,
    settings: settings.value,
    handleChange,
    ollama,
    contextWindow: contextWindow.value,
    setContextWindow: contextWindow.setValue,
    isSaving,
    changes,
    isDirty,
    discardChanges,
    error,
    handleSubmit,
  };
}
