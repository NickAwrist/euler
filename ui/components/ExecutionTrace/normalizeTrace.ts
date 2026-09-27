import type { MessageStep } from "../../types";

/** `complete` steps mirror the final reply and add noise in the trace viewer. */
export function traceStepsForDisplay(steps: MessageStep[]): MessageStep[] {
  return steps.filter((s) => s.kind !== "complete");
}
