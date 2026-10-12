import { Check, Copy, Waypoints } from "lucide-react";
import { type ReactNode, useState } from "react";
import { copyTextToClipboard } from "../lib/copyTextToClipboard";
import type { MessageStep } from "../types";
import {
  ExecutionTraceList,
  formatTraceResultsForCopy,
} from "./ExecutionTrace";
import { TraceUsageTable } from "./ExecutionTrace/TraceUsageTable";
import { summarizeTraceMetrics } from "./ExecutionTrace/traceMetrics";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

export function StepsModal({
  steps,
  streamingThinking,
  title = "Execution Trace",
  subtitle,
  actions,
  children,
  onClose,
}: {
  steps: MessageStep[];
  streamingThinking?: string;
  title?: string;
  subtitle?: ReactNode;
  /** Extra header controls shown before the copy button. */
  actions?: ReactNode;
  /** Content shown above the trace. */
  children?: ReactNode;
  onClose: () => void;
}) {
  const [resultsCopied, setResultsCopied] = useState(false);
  const traceCopyText = formatTraceResultsForCopy(steps ?? []);
  const canCopyResults = traceCopyText.length > 0;
  const metrics = summarizeTraceMetrics(steps);

  const copyResults = async () => {
    if (!canCopyResults) return;
    const ok = await copyTextToClipboard(traceCopyText);
    if (ok) {
      setResultsCopied(true);
      window.setTimeout(() => setResultsCopied(false), 1500);
    }
  };

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      icon={Waypoints}
      ariaLabel={title}
      closeLabel="Close steps viewer"
      onClose={onClose}
      maxWidthClass="max-w-[42rem]"
      headerActions={
        <>
          {actions}
          <IconButton
            icon={resultsCopied ? Check : Copy}
            label={resultsCopied ? "Copied" : "Copy trace results"}
            disabled={!canCopyResults}
            onClick={() => void copyResults()}
            title={resultsCopied ? "Copied" : "Copy trace results"}
          />
        </>
      }
    >
      <div className="flex min-h-0 flex-col overflow-y-auto px-[18px] pb-5 pt-4 sm:px-3.5 sm:pb-3.5 sm:pt-3.5">
        {children}
        {metrics &&
          (metrics.inputTokens !== undefined ||
            metrics.outputTokens !== undefined) && (
            <TraceUsageTable metrics={metrics} />
          )}
        <ExecutionTraceList
          steps={steps}
          streamingThinking={streamingThinking}
        />
      </div>
    </Modal>
  );
}
