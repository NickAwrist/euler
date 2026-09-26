import { Button } from "../Button";
import { Modal } from "../Modal";
import { SETTINGS_TABS } from "./constants";
import type { SettingChange } from "./types";

export function UnsavedChangesModal({
  title,
  changes,
  saving,
  onStay,
  onDiscard,
  onSaveAndLeave,
}: {
  title: string;
  changes: SettingChange[];
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  /** Omitted when the prompt only confirms discarding. */
  onSaveAndLeave?: () => void;
}) {
  return (
    <Modal
      title={title}
      eyebrow="Unsaved changes"
      closeLabel="Keep editing"
      onClose={onStay}
      busy={saving}
      maxWidthClass="max-w-[440px]"
      surfaceClassName="max-h-none grid-rows-1"
      onKeyDown={(event) => {
        if (event.key === "Enter" && onSaveAndLeave && !saving) {
          event.preventDefault();
          onSaveAndLeave();
        }
      }}
    >
      <div className="px-[18px] py-4 sm:px-3.5">
        <p className="m-0 text-[0.875rem] leading-[1.6] text-muted-foreground">
          These changes have not been saved yet:
        </p>
        <ul
          aria-label="Changed settings"
          className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[0.8125rem]"
        >
          {changes.map((change) => (
            <li
              key={`${change.tab}:${change.label}`}
              className="flex justify-between gap-3"
            >
              <span className="text-foreground">{change.label}</span>
              <span className="shrink-0 text-muted-foreground">
                {SETTINGS_TABS.find((tab) => tab.id === change.tab)?.label}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onStay} disabled={saving}>
            Keep editing
          </Button>
          <Button variant="secondary" onClick={onDiscard} disabled={saving}>
            Discard changes
          </Button>
          {onSaveAndLeave && (
            <Button
              variant="primary"
              onClick={onSaveAndLeave}
              disabled={saving}
              loading={saving}
            >
              {saving ? "Saving..." : "Save & leave"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
