import { Button } from "../Button";
import { Modal } from "../Modal";

export function UnsavedChangesModal({
  saving,
  onStay,
  onDiscard,
  onSaveAndLeave,
}: {
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}) {
  return (
    <Modal
      title="Leave settings?"
      eyebrow="Unsaved changes"
      closeLabel="Keep editing"
      onClose={onStay}
      busy={saving}
      maxWidthClass="max-w-[440px]"
      surfaceClassName="max-h-none grid-rows-1"
      onKeyDown={(event) => {
        if (event.key === "Enter" && !saving) {
          event.preventDefault();
          onSaveAndLeave();
        }
      }}
    >
      <div className="px-[18px] py-4 sm:px-3.5">
        <p className="m-0 text-[0.875rem] leading-[1.6] text-muted-foreground">
          You have changes that have not been saved yet.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onStay} disabled={saving}>
            Keep editing
          </Button>
          <Button variant="secondary" onClick={onDiscard} disabled={saving}>
            Discard changes
          </Button>
          <Button
            variant="primary"
            onClick={onSaveAndLeave}
            disabled={saving}
            loading={saving}
          >
            {saving ? "Saving..." : "Save & leave"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
