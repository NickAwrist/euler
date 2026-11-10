import { Step_Kind } from "../../../src/gen/euler/v1/steps_pb";
import type { Step } from "../../types";

/** The main agent's reasoning across a reply's model calls, with its total thinking time. */
export function replyThinking(
  steps: Step[] | undefined,
): { text: string; durationMs?: number } | null {
  const calls = (steps ?? []).filter(
    (step) => step.kind === Step_Kind.LLM_CALL && step.thinking?.trim(),
  );
  if (calls.length === 0) return null;
  const durations = calls.flatMap((step) =>
    step.metrics?.thinkingDurationMs === undefined
      ? []
      : [step.metrics.thinkingDurationMs],
  );
  return {
    text: calls.map((step) => step.thinking?.trim()).join("\n\n"),
    durationMs:
      durations.length > 0
        ? durations.reduce((total, ms) => total + ms, 0)
        : undefined,
  };
}
