import { Step_Status } from "../../src/gen/euler/v1/steps_pb";

/** How a step's status reads in the trace. */
export const STEP_STATUS_LABELS: Record<Step_Status, string> = {
  [Step_Status.UNSPECIFIED]: "",
  [Step_Status.RUNNING]: "running",
  [Step_Status.DONE]: "done",
  [Step_Status.ERROR]: "error",
};
