import type { MessageStep, TraceModalSelection } from "../../types";
import { traceStepsForDisplay } from "./normalizeTrace";

const TRACE_RESULT_SEP = "\n\n---\n\n";

/** All non-empty step `result` strings, matching the trace viewer filters. */
export function formatTraceResultsForCopy(steps: MessageStep[]): string {
  return traceStepsForDisplay(steps ?? [])
    .flatMap((step) => step.result?.trim() || [])
    .join(TRACE_RESULT_SEP);
}

/** Steps fed into the trace modal while SSE is active. */
function coalesceLiveTraceSteps(
  streamingSteps: MessageStep[],
  streamingStep: MessageStep | null,
): MessageStep[] {
  if (streamingSteps.length > 0) return streamingSteps;
  if (streamingStep) return [streamingStep];
  return [];
}

export function traceStepsForModal(
  stepsModalData: TraceModalSelection,
  streamingSteps: MessageStep[],
  streamingStep: MessageStep | null,
): MessageStep[] {
  if (stepsModalData === "live")
    return coalesceLiveTraceSteps(streamingSteps, streamingStep);
  if (stepsModalData == null) return [];
  return stepsModalData;
}

export function shouldShowStepsModal(
  stepsModalData: TraceModalSelection,
  streamingSteps: MessageStep[],
  streamingStep: MessageStep | null,
): boolean {
  if (stepsModalData == null) return false;
  return (
    traceStepsForDisplay(
      traceStepsForModal(stepsModalData, streamingSteps, streamingStep),
    ).length > 0
  );
}
