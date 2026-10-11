import { Save } from "lucide-react";
import { useState } from "react";
import { cx } from "../../styles";
import { Button } from "../Button";
import { UnsavedChangesModal } from "../UnsavedChangesModal";
import { PersonalizationPanel } from "./PersonalizationPanel";
import type { PersonalizationDraft } from "./usePersonalizationDraft";

export function PersonalizationTab({
  active,
  draft,
}: {
  active: boolean;
  draft: PersonalizationDraft;
}) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  return (
    <div
      className={cx("flex min-h-0 flex-col", active ? "flex-1" : "shrink-0")}
    >
      {draft.error && (
        <div
          role="alert"
          className="shrink-0 border-b border-red-400/20 bg-red-400/5 px-5 py-2.5 text-[0.8125rem] text-red-400"
        >
          {draft.error}
        </div>
      )}
      <main className={active ? "flex-1 overflow-y-auto p-4 sm:p-6" : "hidden"}>
        <PersonalizationPanel
          settings={draft.settings}
          onChange={draft.update}
        />
      </main>
      {draft.changes.length > 0 && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-border-subtle px-4 py-3 sm:px-6">
          <p className="mr-auto text-[0.8125rem] text-muted-foreground">
            Unsaved changes in Personalization
          </p>
          <Button
            variant="secondary"
            disabled={draft.saving}
            onClick={() => setConfirmingDiscard(true)}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={draft.saving}
            loading={draft.saving}
            icon={Save}
            onClick={() => void draft.save()}
          >
            Save changes
          </Button>
        </footer>
      )}
      {confirmingDiscard && (
        <UnsavedChangesModal
          title="Discard changes?"
          changes={draft.changes}
          saving={draft.saving}
          onStay={() => setConfirmingDiscard(false)}
          onDiscard={() => {
            draft.discard();
            setConfirmingDiscard(false);
          }}
        />
      )}
    </div>
  );
}
