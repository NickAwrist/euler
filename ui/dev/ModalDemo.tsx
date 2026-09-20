import { useRef, useState } from "react";
import { Modal } from "../components/Modal";

export default function ModalDemo() {
  const [standardOpen, setStandardOpen] = useState(false);
  const [busyOpen, setBusyOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [initialFocusOpen, setInitialFocusOpen] = useState(false);

  const focusInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="mb-4 text-xl font-bold">Modal Demo</h1>
      <div className="flex max-w-xs flex-col gap-4">
        <button
          type="button"
          id="open-standard-btn"
          className="rounded border border-border px-3 py-1.5"
          onClick={() => setStandardOpen(true)}
        >
          Open standard modal
        </button>

        <button
          type="button"
          id="open-busy-btn"
          className="rounded border border-border px-3 py-1.5"
          onClick={() => {
            setBusy(true);
            setBusyOpen(true);
          }}
        >
          Open busy modal
        </button>

        <button
          type="button"
          id="open-focus-btn"
          className="rounded border border-border px-3 py-1.5"
          onClick={() => setInitialFocusOpen(true)}
        >
          Open initial focus modal
        </button>
      </div>

      {standardOpen && (
        <Modal
          onClose={() => setStandardOpen(false)}
          title="Standard Dialog Title"
          eyebrow="Eyebrow text"
          closeLabel="Close standard modal"
        >
          <div className="p-4">
            <p>Standard modal content</p>
            <button
              type="button"
              id="inside-standard-btn"
              className="mt-2 rounded border border-border px-2 py-1"
              onClick={() => setStandardOpen(false)}
            >
              Close inside
            </button>
          </div>
        </Modal>
      )}

      {busyOpen && (
        <Modal
          onClose={() => setBusyOpen(false)}
          title="Busy Dialog Title"
          busy={busy}
          closeLabel="Close busy modal"
        >
          <div className="p-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={busy}
                onChange={(e) => setBusy(e.target.checked)}
              />
              Toggle busy state
            </label>
          </div>
        </Modal>
      )}

      {initialFocusOpen && (
        <Modal
          onClose={() => setInitialFocusOpen(false)}
          title="Initial Focus Title"
          initialFocusRef={focusInputRef}
          closeLabel="Close focus modal"
        >
          <div className="p-4">
            <input
              ref={focusInputRef}
              placeholder="Target input"
              className="rounded border border-border p-1 text-sm text-foreground"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
