import type { MessageStep, TraceModalOpenPayload } from "../../types";
import { ToolIcon } from "../ToolIcon";
import { getLiveStepMeta } from "./liveStepMeta";

type Props = {
  streamingStep: MessageStep | null;
  streamingSteps: MessageStep[];
  streamingContent: string;
  streamingThinking: string;
  onViewSteps: (payload: TraceModalOpenPayload) => void;
};

export function StreamingStatusRow({
  streamingStep,
  streamingSteps,
  streamingContent,
  streamingThinking,
  onViewSteps,
}: Props) {
  const liveMeta = getLiveStepMeta(
    streamingStep,
    streamingSteps.length,
    streamingContent,
    streamingThinking,
  );

  return (
    <div className="ui-animate-slide-up mt-0 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle bg-transparent py-[10px] pb-3 text-[0.8125rem] text-muted-foreground">
      {streamingSteps.length > 0 ? (
        <button
          type="button"
          className="flex min-w-0 max-w-full flex-wrap items-center gap-2.5 rounded-md border border-transparent px-1 py-0.5 text-left text-inherit transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          onClick={() => onViewSteps("live")}
          aria-label="View execution trace"
        >
          <div
            className="ui-live-status-dot size-1.5 shrink-0 rounded-full bg-accent"
            aria-hidden
          />
          <span className="font-medium text-foreground">{liveMeta.label}</span>
          {liveMeta.detail && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-transparent px-2 py-[3px] text-[0.6875rem] font-medium text-foreground">
              {streamingStep?.kind === "tool_call" && (
                <ToolIcon
                  name={streamingStep.toolName}
                  icons={streamingStep.toolIcons}
                  size={12}
                />
              )}
              {liveMeta.detail}
            </span>
          )}
        </button>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <div
            className="ui-live-status-dot size-1.5 shrink-0 rounded-full bg-accent"
            aria-hidden
          />
          <span className="font-medium">{liveMeta.label}</span>
          {liveMeta.detail && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-transparent px-2 py-[3px] text-[0.6875rem] font-medium text-foreground">
              {streamingStep?.kind === "tool_call" && (
                <ToolIcon
                  name={streamingStep.toolName}
                  icons={streamingStep.toolIcons}
                  size={12}
                />
              )}
              {liveMeta.detail}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
