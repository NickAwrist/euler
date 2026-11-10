import { Step_Kind } from "../../../src/gen/euler/v1/steps_pb";
import { toMillis } from "../../lib/timestamps";
import type { Step } from "../../types";

export function traceStepLabel(step: Step): string {
  switch (step.kind) {
    case Step_Kind.LLM_CALL:
      return "Model call";
    case Step_Kind.TOOL_CALL:
      return step.toolName ? `Tool: ${step.toolName}` : "Tool call";
    case Step_Kind.ERROR:
      return "Error";
    default:
      return "Complete";
  }
}

function timestamp(value: Step["startedAt"]): number | undefined {
  return value ? toMillis(value) : undefined;
}

export function traceStepDurationMs(step: Step): number | undefined {
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
  steps: Step[],
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
