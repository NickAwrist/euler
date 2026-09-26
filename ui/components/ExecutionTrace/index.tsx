import type { MessageStep } from "../../types";
import { TraceStepBody } from "./TraceNodes";
import { traceStepsForDisplay } from "./normalizeTrace";
import { traceTimeline } from "./traceDisplay";
import {
  formatTraceResultsForCopy,
  shouldShowStepsModal,
  traceStepsForModal,
} from "./traceModalLogic";

export {
  traceStepsForDisplay,
  formatTraceResultsForCopy,
  traceStepsForModal,
  shouldShowStepsModal,
};

function traceStepKey(step: MessageStep): string {
  return [
    step.kind,
    step.status,
    step.toolName,
    step.agentName,
    step.result,
    step.error,
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(":");
}

/** Numbered root-level trace (same layout for live SSE and persisted message steps). */
export function ExecutionTraceList({
  steps,
  streamingThinking,
}: {
  steps: MessageStep[];
  streamingThinking?: string;
}) {
  const displaySteps = traceStepsForDisplay(steps ?? []);
  const lastIdx = displaySteps.length - 1;
  const timeline = traceTimeline(displaySteps, Date.now());
  return (
    <>
      {displaySteps.map((step, index) => (
        <TraceStepBody
          key={traceStepKey(step)}
          step={step}
          showIndex
          stepNumber={index + 1}
          streamingThinking={index === lastIdx ? streamingThinking : undefined}
          timeline={timeline[index]}
        />
      ))}
    </>
  );
}
