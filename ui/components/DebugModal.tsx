import { Bug, Loader2 } from "lucide-react";
import { cx, debugBlock, eyebrowText } from "../styles";
import type { DebugData } from "../types";
import { Modal } from "./Modal";

function nextCallPayload(data: DebugData): string {
  const msgs = data.modelMessages ?? [];
  const payload = [{ role: "system", content: data.systemPrompt }, ...msgs];
  return JSON.stringify(payload, null, 2);
}

export function DebugModal({
  data,
  onClose,
}: {
  data: DebugData | null;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Debug"
      eyebrow="Internals"
      icon={Bug}
      ariaLabel="Debug"
      closeLabel="Close debug inspector"
      onClose={onClose}
      maxWidthClass="max-w-[960px]"
    >
      {data?.error ? (
        <p role="alert" className="p-4 text-sm text-red-400">
          {data.error}
        </p>
      ) : data ? (
        <div className="flex max-h-[min(70vh,640px)] flex-col overflow-y-auto px-[18px] pb-5 pt-4 sm:px-3.5 sm:pb-3.5 sm:pt-3.5">
          <section className="flex flex-col gap-2">
            <div className={eyebrowText}>System prompt preview</div>
            <pre className={debugBlock}>{data.systemPrompt}</pre>
          </section>

          <section className="mt-[18px] flex flex-col gap-2">
            <div className={eyebrowText}>Preview with stored history</div>
            <p className="mb-1 text-[0.75rem] leading-[1.45] text-muted-foreground">
              Uses current agent settings, date, and draft skill references.
              This is not a record of a previous request.
            </p>
            <pre
              className={cx(
                debugBlock,
                "max-h-[min(50vh,420px)] overflow-auto text-[0.75rem] leading-[1.5]",
              )}
            >
              {nextCallPayload(data)}
            </pre>
          </section>
        </div>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center gap-2.5 text-[0.875rem] text-muted-foreground">
          <Loader2 className="animate-spin" size={20} />
          Loading...
        </div>
      )}
    </Modal>
  );
}
