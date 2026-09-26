import type { MessageStep } from "../../types";

/** The main agent's reasoning across a reply's model calls, with its total thinking time. */
export function replyThinking(
  steps: MessageStep[] | undefined,
): { text: string; durationMs?: number } | null {
  const calls = (steps ?? []).filter(
    (step) => step.kind === "llm_call" && step.thinking?.trim(),
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
