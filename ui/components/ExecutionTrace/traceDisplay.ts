import type { MessageStep } from "../../types";

export function traceStepLabel(step: MessageStep): string {
  switch (step.kind) {
    case "llm_call":
      return "Model call";
    case "tool_call":
      return step.toolName ? `Tool: ${step.toolName}` : "Tool call";
    case "error":
      return "Error";
    default:
      return step.kind;
  }
}

function timestamp(value: string | undefined): number | undefined {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

export function traceStepDurationMs(step: MessageStep): number | undefined {
  const start = timestamp(step.startedAt);
  const end = timestamp(step.endedAt);
  return start === undefined || end === undefined
    ? undefined
    : Math.max(0, end - start);
}

/** A step's start and length as fractions of the whole run. */
export type TimelineSpan = { offset: number; width: number };

/** Positions steps on a shared timeline. Steps still running extend to `now`. */
export function traceTimeline(
  steps: MessageStep[],
  now: number,
): Array<TimelineSpan | undefined> {
  const ranges = steps.map((step) => {
    const start = timestamp(step.startedAt);
    return start === undefined
      ? undefined
      : { start, end: timestamp(step.endedAt) ?? now };
  });
  const known = ranges.filter((range) => range !== undefined);
  if (known.length === 0) return steps.map(() => undefined);
  const runStart = Math.min(...known.map((range) => range.start));
  const total = Math.max(...known.map((range) => range.end)) - runStart;
  if (total <= 0) return steps.map(() => undefined);
  return ranges.map(
    (range) =>
      range && {
        offset: (range.start - runStart) / total,
        width: (range.end - range.start) / total,
      },
  );
}
