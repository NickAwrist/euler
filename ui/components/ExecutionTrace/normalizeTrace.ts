import { Step_Kind } from "../../../src/gen/euler/v1/steps_pb";
import type { Step } from "../../types";

/** `complete` steps mirror the final reply and add noise in the trace viewer. */
export function traceStepsForDisplay(steps: Step[]): Step[] {
  return steps.filter((s) => s.kind !== Step_Kind.COMPLETE);
}
