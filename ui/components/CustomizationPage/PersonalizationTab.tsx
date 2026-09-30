import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { cx } from "../../styles";
import type { Personalization } from "../../types";
import { Button } from "../Button";
import { UnsavedChangesModal } from "../UnsavedChangesModal";
import { PersonalizationPanel } from "./PersonalizationPanel";

const PERSONALIZATION_FIELDS = [
  { key: "systemPrompt", label: "System prompt" },
  { key: "includeCurrentDate", label: "Include current date" },
  { key: "name", label: "Name" },
  { key: "location", label: "Location" },
  { key: "preferredFormats", label: "Preferred response formats" },
] as const;

export function PersonalizationTab({
  active,
  currentSettings,
  onSave,
  onDirtyChange,
}: {
  active: boolean;
  currentSettings: Personalization;
  onSave: (settings: Personalization) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [settings, setSettings] = useState<Personalization>(currentSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSettings(currentSettings), [currentSettings]);
  const changes = PERSONALIZATION_FIELDS.filter(
    ({ key }) => settings[key] !== currentSettings[key],
  ).map(({ label }) => ({ label }));
  const isDirty = changes.length > 0;
  const { prompt, setPrompt, resolveLeave } = useUnsavedChanges(isDirty);
  const save = async () => {
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
      await onSave({
        systemPrompt,
        includeCurrentDate,
        name,
        location,
        preferredFormats,
      });
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
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const update = <K extends keyof Personalization>(
    key: K,
    value: Personalization[K],
  ) => setSettings((previous) => ({ ...previous, [key]: value }));
  return (
    <div
      className={cx("flex min-h-0 flex-col", active ? "flex-1" : "shrink-0")}
    >
      {error && (
        <div
          role="alert"
          className="shrink-0 border-b border-red-400/20 bg-red-400/5 px-5 py-2.5 text-[0.8125rem] text-red-400"
        >
          {error}
        </div>
      )}
      <main className={active ? "flex-1 overflow-y-auto p-4 sm:p-6" : "hidden"}>
        <PersonalizationPanel settings={settings} onChange={update} />
      </main>
      {isDirty && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-border-subtle px-4 py-3 sm:px-6">
          <p className="mr-auto text-[0.8125rem] text-muted-foreground">
            Unsaved changes in Personalization
          </p>
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setPrompt("discard")}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            loading={saving}
            icon={Save}
            onClick={() => void save()}
          >
            Save changes
          </Button>
        </footer>
      )}
      {prompt && (
        <UnsavedChangesModal
          title={
            prompt === "leave" ? "Leave customization?" : "Discard changes?"
          }
          changes={changes}
          saving={saving}
          onStay={() => resolveLeave(false)}
          onDiscard={() => {
            if (prompt === "leave") resolveLeave(true);
            else {
              setSettings(currentSettings);
              setError(null);
              setPrompt(null);
            }
          }}
          onSaveAndLeave={
            prompt === "leave"
              ? () =>
                  void save().then((saved) => {
                    if (saved) resolveLeave(true);
                  })
              : undefined
          }
        />
      )}
    </div>
  );
}
