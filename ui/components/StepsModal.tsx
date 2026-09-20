import { Check, Coins, Copy, Gauge, Waypoints } from "lucide-react";
import { useState } from "react";
import { copyTextToClipboard } from "../lib/copyTextToClipboard";
import type { MessageStep } from "../types";
import {
  ExecutionTraceList,
  formatTraceResultsForCopy,
  traceStepsForDisplay,
} from "./ExecutionTrace";
import {
  formatCost,
  formatTokensPerSecond,
  summarizeTraceMetrics,
} from "./ExecutionTrace/traceMetrics";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

export function StepsModal({
  steps,
  streamingThinking,
  onClose,
}: {
  steps: MessageStep[];
  streamingThinking?: string;
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

  if (traceStepsForDisplay(steps ?? []).length === 0) return null;

  return (
    <Modal
      title="Execution Trace"
      icon={Waypoints}
      ariaLabel="Execution Trace"
      closeLabel="Close steps viewer"
      onClose={onClose}
      maxWidthClass="max-w-[42rem]"
      headerActions={
        <IconButton
          icon={resultsCopied ? Check : Copy}
          label={resultsCopied ? "Copied" : "Copy trace results"}
          disabled={!canCopyResults}
          onClick={() => void copyResults()}
          title={resultsCopied ? "Copied" : "Copy trace results"}
        />
      }
    >
      <div className="flex min-h-0 flex-col overflow-y-auto px-[18px] pb-5 pt-4 sm:px-3.5 sm:pb-3.5 sm:pt-3.5">
        {metrics &&
          (metrics.inputTokens !== undefined ||
            metrics.outputTokens !== undefined ||
            metrics.tokensPerSecond !== undefined ||
            metrics.cost !== undefined) && (
            <div
              className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border-subtle bg-muted/25 p-2.5 sm:grid-cols-4"
              aria-label="Execution metrics"
            >
              <TraceMetric
                label="Input"
                value={
                  metrics.inputTokens !== undefined
                    ? metrics.inputTokens.toLocaleString()
                    : "—"
                }
                suffix="tokens"
              />
              <TraceMetric
                label="Output"
                value={
                  metrics.outputTokens !== undefined
                    ? metrics.outputTokens.toLocaleString()
                    : "—"
                }
                suffix="tokens"
              />
              <TraceMetric
                icon={<Gauge size={13} />}
                label="Speed"
                value={
                  metrics.tokensPerSecond !== undefined
                    ? formatTokensPerSecond(metrics.tokensPerSecond)
                    : "—"
                }
                suffix="tok/s"
              />
              <TraceMetric
                icon={<Coins size={13} />}
                label="Cost"
                value={
                  metrics.cost !== undefined ? formatCost(metrics.cost) : "—"
                }
              />
            </div>
          )}
        <ExecutionTraceList
          steps={steps}
          streamingThinking={streamingThinking}
        />
      </div>
    </Modal>
  );
}

function TraceMetric({
  icon,
  label,
  value,
  suffix,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-background/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-[0.8125rem] font-semibold text-foreground">
        {value}
        {suffix && (
          <span className="ml-1 text-[0.6875rem] font-normal text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
