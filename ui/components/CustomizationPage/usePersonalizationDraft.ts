import { useState } from "react";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import { changedFields } from "../../lib/changedFields";
import type { Personalization } from "../../types";

const PERSONALIZATION_FIELDS = [
  { key: "systemPrompt", label: "System prompt" },
  { key: "includeCurrentDate", label: "Include current date" },
  { key: "name", label: "Name" },
  { key: "location", label: "Location" },
  { key: "preferredFormats", label: "Preferred response formats" },
] as const;

export function usePersonalizationDraft(
  currentSettings: Personalization,
  onSave: (settings: Partial<Personalization>) => Promise<void>,
) {
  const draft = useSavedDraft(currentSettings);
  const settings = draft.value;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = PERSONALIZATION_FIELDS.filter(
    ({ key }) => settings[key] !== currentSettings[key],
  ).map(({ label }) => ({ label }));

  /** Resolves to whether the draft has no unsaved changes afterward. */
  const save = async () => {
    if (changes.length === 0) return true;
    setSaving(true);
    setError(null);
    try {
      const {
        systemPrompt,
        includeCurrentDate,
        name,
        location,
        preferredFormats,
      } = settings;
      await onSave(
        changedFields(
          {
            systemPrompt,
            includeCurrentDate,
            name,
            location,
            preferredFormats,
          },
          currentSettings,
        ),
      );
      draft.accept();
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save customization",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof Personalization>(
    key: K,
    value: Personalization[K],
  ) => draft.setValue((previous) => ({ ...previous, [key]: value }));

  const discard = () => {
    draft.reset();
    setError(null);
  };

  return { settings, changes, saving, error, save, update, discard };
}

export type PersonalizationDraft = ReturnType<typeof usePersonalizationDraft>;
