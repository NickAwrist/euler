import { Button } from "./Button";
import { Modal } from "./Modal";

export function TruncateConfirmModal({
  title,
  description,
  confirmLabel = "Continue",
  busyConfirmLabel = "Please wait...",
  onConfirm,
  onClose,
  busy = false,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  busyConfirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      eyebrow="Warning"
      onClose={onClose}
      busy={busy}
      maxWidthClass="max-w-[400px]"
      surfaceClassName="max-h-none grid-rows-1"
      onKeyDown={(event) => {
        if (event.key === "Enter" && !busy) {
          event.preventDefault();
          void Promise.resolve(onConfirm());
        }
      }}
    >
      <div className="px-[18px] py-4 sm:px-3.5">
        <p className="m-0 text-[0.875rem] leading-[1.6] text-muted-foreground">
          {description}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void Promise.resolve(onConfirm())}
            disabled={busy}
            loading={busy}
          >
            {busy ? busyConfirmLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
